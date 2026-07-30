/**
 * freighter_connector — Freighter browser wallet integration helpers:
 * extension availability detection, signature time limits, and graceful
 * handling of user signature rejections.
 */

import type { ToastType } from "@/app/context/ToastContext";
import { getAddress as getFreighterAddress, isConnected as isFreighterConnected } from "@stellar/freighter-api";

const LOG_PREFIX = "[freighter_connector]";

/** Install URL surfaced when no Freighter extension is detected. */
export const FREIGHTER_INSTALL_URL = "https://www.freighter.app/";

/** Fallback copy shown when the Freighter extension is missing. */
export const FREIGHTER_SETUP_INSTRUCTION =
  "Freighter wallet extension not detected. Install Freighter and refresh this page to continue.";

export type FreighterAvailabilityStatus = "available" | "unavailable" | "error";

export interface FreighterAvailabilityState {
  available: boolean;
  status: FreighterAvailabilityStatus;
  /** User-facing setup instructions when the extension is missing. */
  setupInstruction: string | null;
  warningMessage: string | null;
}

export type FreighterToastHandler = (message: string, type: ToastType) => void;

/** Default bound for Freighter signature requests. */
export const DEFAULT_FREIGHTER_SIGNATURE_TIMEOUT_MS = 60_000;

export interface FreighterSignRequest {
  xdr: string;
  /** Sensitive buffer cleared on timeout / completion. */
  payload?: Uint8Array | null;
}

export class FreighterSignatureTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Freighter signature timed out after ${timeoutMs}ms`);
    this.name = "FreighterSignatureTimeoutError";
  }
}

/** Zeroes and drops a sensitive buffer so it cannot be retained after abort. */
export function clearFreighterSensitiveMemory(
  request: FreighterSignRequest
): FreighterSignRequest {
  if (request.payload) {
    request.payload.fill(0);
  }
  request.payload = null;
  return request;
}

/**
 * Races a Freighter signature operation against a timeout clock. On timeout
 * the operation is aborted and any sensitive payload memory is cleared.
 */
export async function signFreighterWithTimeout<T>(
  request: FreighterSignRequest,
  signFn: (xdr: string) => Promise<T>,
  timeoutMs: number = DEFAULT_FREIGHTER_SIGNATURE_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      clearFreighterSensitiveMemory(request);
      reject(new FreighterSignatureTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([signFn(request.xdr), timeoutPromise]);
    clearFreighterSensitiveMemory(request);
    return result;
  } catch (err) {
    if (timedOut || err instanceof FreighterSignatureTimeoutError) {
      clearFreighterSensitiveMemory(request);
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Detects whether the Freighter browser extension is present. Accepts an
 * optional detector override for tests / non-browser runtimes.
 */
export function detectFreighterExtension(detector?: () => boolean): boolean {
  if (detector) {
    return detector();
  }
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as unknown as Record<string, unknown>;
  return !!(w["freighterApi"] || w["freighter"]);
}

/**
 * Checks Freighter extension availability and returns fallback setup
 * instructions when the extension is missing or the check itself throws.
 */
export function checkFreighterAvailability(
  detector?: () => boolean
): FreighterAvailabilityState {
  try {
    const available = detectFreighterExtension(detector);
    if (available) {
      return {
        available: true,
        status: "available",
        setupInstruction: null,
        warningMessage: null,
      };
    }
    return {
      available: false,
      status: "unavailable",
      setupInstruction: FREIGHTER_SETUP_INSTRUCTION,
      warningMessage: FREIGHTER_SETUP_INSTRUCTION,
    };
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} wallet availability check failed:`,
      err instanceof Error ? err.message : err
    );
    return {
      available: false,
      status: "error",
      setupInstruction: FREIGHTER_SETUP_INSTRUCTION,
      warningMessage: `Unable to verify wallet availability. ${FREIGHTER_SETUP_INSTRUCTION}`,
    };
  }
}

/**
 * Runs a Freighter availability check and surfaces a warning toast when the
 * extension is missing or the check errors.
 */
export function warnOnMissingFreighter(
  showToast: FreighterToastHandler,
  detector?: () => boolean
): FreighterAvailabilityState {
  const state = checkFreighterAvailability(detector);
  if (!state.available && state.warningMessage) {
    showToast(state.warningMessage, "warning");
  }
  return state;
}

export class FreighterUserRejectedError extends Error {
  constructor(message = "user rejected transaction") {
    super(message);
    this.name = "FreighterUserRejectedError";
  }
}

export function isFreighterUserRejected(err: unknown): boolean {
  if (err instanceof FreighterUserRejectedError) return true;
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user declined") ||
    message.includes("request rejected") ||
    message.includes("denied by the user")
  );
}

/**
 * Runs a Freighter signature step. Catches "user rejected transaction"
 * exceptions, logs them, and shows a warning toast instead of surfacing a
 * raw error to the caller.
 */
export async function runFreighterSign<T>(
  signFn: () => Promise<T>,
  showToast: FreighterToastHandler
): Promise<T | null> {
  try {
    return await signFn();
  } catch (err) {
    if (isFreighterUserRejected(err)) {
      console.warn(
        `${LOG_PREFIX} signature rejected by user:`,
        err instanceof Error ? err.message : err
      );
      showToast("Signature cancelled — you rejected the request in your wallet.", "warning");
      return null;
    }
    throw err;
  }
}

export const FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY = "freighter_connector_active_address";
export const FREIGHTER_ACTIVE_ADDRESS_SCHEMA_VERSION = 1;

export interface FreighterActiveAddress {
  address: string;
  network: string;
  connectedAt: number;
}

interface FreighterActiveAddressSerializedV1 {
  version: 1;
  address: string;
  network: string;
  connectedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidFreighterActiveAddress(value: unknown): value is FreighterActiveAddress {
  if (!isRecord(value)) return false;
  if (typeof value.address !== "string" || value.address.length === 0) return false;
  if (typeof value.network !== "string") return false;
  if (typeof value.connectedAt !== "number" || !Number.isFinite(value.connectedAt)) return false;
  return true;
}

function sanitizeFreighterActiveAddress(
  value: unknown
): FreighterActiveAddress | null {
  if (!isValidFreighterActiveAddress(value)) return null;
  return {
    address: value.address,
    network: value.network,
    connectedAt: value.connectedAt,
  };
}

function isValidSerializedPayload(
  value: unknown
): value is FreighterActiveAddressSerializedV1 {
  if (!isRecord(value)) return false;
  if (value.version !== FREIGHTER_ACTIVE_ADDRESS_SCHEMA_VERSION) return false;
  if (typeof value.address !== "string" || value.address.length === 0) return false;
  if (typeof value.network !== "string") return false;
  if (typeof value.connectedAt !== "number" || !Number.isFinite(value.connectedAt)) return false;
  return true;
}

function getStorageAdapter(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const testKey = "__freighter_connector_storage_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

export class FreighterActiveAddressStore {
  private activeAddress: FreighterActiveAddress | null = null;
  private storage: Storage | null;

  constructor(storageOverride?: Storage | null) {
    this.storage =
      storageOverride !== undefined ? storageOverride : getStorageAdapter();
    this.rehydrate();
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      if (this.activeAddress) {
        const payload: FreighterActiveAddressSerializedV1 = {
          version: FREIGHTER_ACTIVE_ADDRESS_SCHEMA_VERSION,
          address: this.activeAddress.address,
          network: this.activeAddress.network,
          connectedAt: this.activeAddress.connectedAt,
        };
        this.storage.setItem(
          FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY,
          JSON.stringify(payload)
        );
      } else {
        this.storage.removeItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY);
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} PERSIST FAILED`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /**
   * Re-reads persisted state from storage into memory. Public because
   * simulating a reload (which triggers rehydration) is a legitimate
   * externally-verifiable behavior: consumers and tests both need to
   * confirm that a freshly-bootstrapped store correctly restores its
   * state from whatever is in storage right now.
   */
  rehydrate(): void {
    this.activeAddress = null;
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!isValidSerializedPayload(parsed)) {
        console.warn(
          `${LOG_PREFIX} REHYDRATE SCHEMA MISMATCH`,
          "Persisted active address data failed validation, falling back to clean state."
        );
        this.storage.removeItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY);
        return;
      }
      this.activeAddress = sanitizeFreighterActiveAddress(parsed);
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} REHYDRATE FAILED`,
        err instanceof Error ? err.message : String(err)
      );
      try {
        this.storage.removeItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY);
      } catch {
        // no-op — best effort cleanup
      }
    }
  }

  /**
   * Replaces the storage backend used by this store instance and
   * immediately re-reads state from the new backend. Intended as a
   * narrow test-support seam so tests can supply an in-memory Storage
   * mock without reaching into the private `storage` field. Safe to
   * call at runtime as well (e.g. to swap to sessionStorage in a
   * security-sensitive mode).
   */
  overrideStorage(nextStorage: Storage | null): void {
    this.storage = nextStorage;
    this.rehydrate();
  }

  setActiveAddress(address: FreighterActiveAddress | null): void {
    this.activeAddress = address ? sanitizeFreighterActiveAddress(address) : null;
    this.persist();
  }

  getActiveAddress(): FreighterActiveAddress | null {
    if (!this.activeAddress) return null;
    return {
      address: this.activeAddress.address,
      network: this.activeAddress.network,
      connectedAt: this.activeAddress.connectedAt,
    };
  }

  clear(): void {
    this.activeAddress = null;
    if (this.storage) {
      try {
        this.storage.removeItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY);
      } catch (err) {
        console.warn(
          `${LOG_PREFIX} CLEAR STORAGE FAILED`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }
}

export const freighterActiveAddress = new FreighterActiveAddressStore();

/**
 * Re-verifies a persisted active address against Freighter's actual live API state.
 * If Freighter is locked, switched account, or has no active address, updates/clears storage.
 * Returns the verified address if valid, or null if verification failed or state mismatch.
 */
export async function verifyAndRehydrateFreighterAddress(
  getAddressFn: () => Promise<unknown> = getFreighterAddress,
  isConnectedFn: () => Promise<unknown> = isFreighterConnected
): Promise<string | null> {
  const persisted = freighterActiveAddress.getActiveAddress();
  if (!persisted) {
    return null;
  }

  try {
    const conn = await isConnectedFn();
    const isConnected =
      typeof conn === "boolean"
        ? conn
        : (conn && typeof conn === "object" && "isConnected" in conn)
        ? Boolean((conn as { isConnected?: unknown }).isConnected)
        : false;

    if (!isConnected) {
      freighterActiveAddress.clear();
      return null;
    }

    const liveResult = await getAddressFn();
    const liveAddress =
      typeof liveResult === "string"
        ? liveResult
        : (liveResult && typeof liveResult === "object" && "address" in liveResult)
        ? String((liveResult as { address?: unknown }).address ?? "")
        : "";

    if (!liveAddress) {
      freighterActiveAddress.clear();
      return null;
    }

    if (liveAddress === persisted.address) {
      return liveAddress;
    } else {
      freighterActiveAddress.clear();
      return null;
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} verification check failed, clearing persisted state`, err);
    freighterActiveAddress.clear();
    return null;
  }
}

/**
 * Lifecycle phases a Freighter transaction moves through. `simulating` covers
 * the fee-estimation step that runs before the wallet is asked to sign.
 */
export type FreighterTxPhase =
  | "idle"
  | "building"
  | "simulating"
  | "signing"
  | "submitting"
  | "success"
  | "error";

export interface FreighterTxTrackEntry {
  txId: string;
  phase: FreighterTxPhase;
  message: string;
  timestamp: number;
  stack?: string;
}

export interface FreighterConsoleWarningBlock {
  title: string;
  body: string;
  stack: string;
  txId?: string;
  phase?: FreighterTxPhase;
}

/**
 * Normalise anything throwable into a printable stack trace. Multi-line strings
 * are assumed to already be traces; everything else gets a synthetic Error so
 * there is always a call site to read.
 */
export function formatStackTrace(err?: unknown): string {
  if (err instanceof Error && err.stack) {
    return err.stack;
  }

  if (typeof err === "string" && err.includes("\n")) {
    return err;
  }

  const synthetic = new Error(
    typeof err === "string" ? err : "Freighter connector trace"
  );
  return synthetic.stack ?? "Error: Freighter connector trace";
}

/** Render a boxed, prefixed console block with the stack trace appended. */
export function formatConsoleWarningBlock(
  block: FreighterConsoleWarningBlock
): string {
  const lines = [
    `${LOG_PREFIX} ╔══════════════════════════════════════╗`,
    `${LOG_PREFIX} ║ ${block.title.padEnd(36).slice(0, 36)} ║`,
    `${LOG_PREFIX} ╚══════════════════════════════════════╝`,
    `${LOG_PREFIX} ${block.body}`,
  ];

  if (block.txId) {
    lines.push(`${LOG_PREFIX} txId: ${block.txId}`);
  }
  if (block.phase) {
    lines.push(`${LOG_PREFIX} phase: ${block.phase}`);
  }

  lines.push(`${LOG_PREFIX} --- stack trace ---`);
  for (const frame of block.stack.split("\n")) {
    lines.push(`${LOG_PREFIX} ${frame}`);
  }
  lines.push(`${LOG_PREFIX} --- end stack ---`);

  return lines.join("\n");
}

/** Emit a formatted warning block to console.warn and return what was logged. */
export function logFreighterWarning(
  title: string,
  body: string,
  options?: { err?: unknown; txId?: string; phase?: FreighterTxPhase }
): string {
  const stack = formatStackTrace(options?.err);
  const formatted = formatConsoleWarningBlock({
    title,
    body,
    stack,
    txId: options?.txId,
    phase: options?.phase,
  });
  console.warn(formatted);
  return formatted;
}

/**
 * Records each phase transition of a Freighter transaction and logs a warning
 * block per entry, so a failed signing flow leaves a readable console trail.
 */
export class FreighterTransactionTracker {
  private entries: FreighterTxTrackEntry[] = [];

  track(
    txId: string,
    phase: FreighterTxPhase,
    message: string,
    err?: unknown
  ): FreighterTxTrackEntry {
    const entry: FreighterTxTrackEntry = {
      txId,
      phase,
      message,
      timestamp: Date.now(),
      stack: formatStackTrace(err),
    };
    this.entries.push(entry);

    logFreighterWarning(`TX ${phase.toUpperCase()}`, message, {
      err,
      txId,
      phase,
    });

    return entry;
  }

  getHistory(txId?: string): FreighterTxTrackEntry[] {
    if (!txId) return [...this.entries];
    return this.entries.filter((e) => e.txId === txId);
  }

  clear(): void {
    this.entries = [];
  }
}

export const freighterTracker = new FreighterTransactionTracker();

export interface FreighterSimulationResult {
  /** Estimated fee in stroops (1 XLM = 10_000_000 stroops). */
  fee: number;
  /** Optional error string from the simulation response. */
  error?: string;
  /** Raw simulation error object when the RPC reports a failure. */
  simulationError?: unknown;
}

export interface FreighterGasWarningState {
  hasWarning: boolean;
  highFee: boolean;
  simulationError: boolean;
  warningMessage: string | null;
}

export const HIGH_FEE_THRESHOLD_STROOPS = 1_000_000;

/**
 * Classify a simulation result. A simulation failure takes precedence over a
 * high fee, since the fee is meaningless when the contract rejected the call.
 */
export function checkSimulationFeeWarning(
  result: FreighterSimulationResult
): FreighterGasWarningState {
  if (result.error || result.simulationError) {
    const message =
      typeof result.error === "string" && result.error
        ? `Transaction simulation failed: ${result.error}`
        : "Transaction simulation failed. The contract may have rejected this operation.";

    return {
      hasWarning: true,
      highFee: false,
      simulationError: true,
      warningMessage: message,
    };
  }

  if (result.fee > HIGH_FEE_THRESHOLD_STROOPS) {
    const xlm = (result.fee / 10_000_000).toFixed(7);
    return {
      hasWarning: true,
      highFee: true,
      simulationError: false,
      warningMessage: `Estimated fee is unusually high (${result.fee} stroops / ${xlm} XLM). Review before signing.`,
    };
  }

  return {
    hasWarning: false,
    highFee: false,
    simulationError: false,
    warningMessage: null,
  };
}

/** Check a simulation result and log a console block when it warrants a warning. */
export function warnOnSimulationFee(
  result: FreighterSimulationResult,
  options?: { txId?: string }
): FreighterGasWarningState {
  const state = checkSimulationFeeWarning(result);

  if (state.hasWarning && state.warningMessage) {
    const title = state.simulationError
      ? "SIMULATION ERROR"
      : "HIGH FEE WARNING";
    logFreighterWarning(title, state.warningMessage, {
      err: new Error(state.warningMessage),
      txId: options?.txId,
      phase: "simulating",
    });
  }

  return state;
}
