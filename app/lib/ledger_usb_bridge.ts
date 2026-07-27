/**
 * Ledger USB bridge — hardware wallet transport helpers:
 * WebUSB/WebHID transport availability detection, signature timeouts,
 * rejection handling, and network mismatch checks.
 */

import type { ToastType } from "@/app/context/ToastContext";

export const DEFAULT_SIGNATURE_TIMEOUT_MS = 60_000;

/** Official Ledger setup/support URL surfaced when the browser transport is unsupported. */
export const LEDGER_SETUP_URL = "https://support.ledger.com/article/4404389482525-connect-my-ledger-to-ledger-live";

/** Supported browsers list shown in setup instructions. */
export const LEDGER_SUPPORTED_BROWSERS = "Chrome, Edge, Brave, or Opera";

/** Fallback copy shown when WebUSB/WebHID transport is not available in the user's browser. */
export const LEDGER_SETUP_INSTRUCTION =
  "Your browser does not support connecting to Ledger hardware wallets. Ledger USB connections require WebUSB or WebHID support. Please switch to a supported browser (" +
  LEDGER_SUPPORTED_BROWSERS +
  ") and ensure your Ledger is connected via USB cable (not Bluetooth).";

export type LedgerTransportStatus = "available" | "unavailable" | "error";

export interface LedgerAvailabilityState {
  available: boolean;
  status: LedgerTransportStatus;
  /** Which transport API was detected (if any), for debug/context. */
  transportType: "webusb" | "webhid" | "both" | "none";
  /** User-facing setup instructions when the transport is missing. */
  setupInstruction: string | null;
  warningMessage: string | null;
}

export type LedgerNetwork = "mainnet" | "testnet";

export interface LedgerSignRequest {
  xdr: string;
  /** Sensitive buffer cleared on timeout / completion. */
  payload?: Uint8Array | null;
}

export interface LedgerSignResult {
  signedXdr: string;
}

export type LedgerToastHandler = (message: string, type: ToastType) => void;

export type LedgerTxPhase =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "success"
  | "error";

export interface LedgerTxTrackEntry {
  txId: string;
  phase: LedgerTxPhase;
  message: string;
  timestamp: number;
  stack?: string;
}

export interface LedgerConsoleWarningBlock {
  title: string;
  body: string;
  stack: string;
  txId?: string;
  phase?: LedgerTxPhase;
}

const WARN_PREFIX = "[ledger_usb_bridge]";

/**
 * Detects whether the current browser environment supports the required
 * transport APIs for Ledger hardware wallet connections (WebUSB or WebHID).
 * Accepts an optional detector override for tests / non-browser runtimes.
 *
 * Note: this only checks API availability, not whether a device is actually
 * plugged in. "Available transport ≠ device connected".
 */
export function detectLedgerTransport(
  detector?: () => { hasWebUsb: boolean; hasWebHid: boolean }
): { hasWebUsb: boolean; hasWebHid: boolean } {
  if (detector) {
    return detector();
  }
  if (typeof navigator === "undefined") {
    return { hasWebUsb: false, hasWebHid: false };
  }
  const nav = navigator as unknown as Record<string, unknown>;
  return {
    hasWebUsb: typeof nav["usb"] !== "undefined",
    hasWebHid: typeof nav["hid"] !== "undefined",
  };
}

/**
 * Normalizes the raw transport detection result into a single transport type
 * label used for debug/context in the availability state.
 */
export function classifyTransportType(
  hasWebUsb: boolean,
  hasWebHid: boolean
): LedgerAvailabilityState["transportType"] {
  if (hasWebUsb && hasWebHid) return "both";
  if (hasWebUsb) return "webusb";
  if (hasWebHid) return "webhid";
  return "none";
}

/**
 * Checks Ledger transport availability (WebUSB / WebHID browser support) and
 * returns fallback setup instructions when neither transport is available or
 * the check itself throws.
 *
 * Distinguishes three outcomes:
 *   - "available"   → at least one transport API present; safe to attempt connect
 *   - "unavailable" → no transport APIs; browser cannot talk to Ledger
 *   - "error"       → the detector itself threw unexpectedly
 */
export function checkLedgerAvailability(
  detector?: () => { hasWebUsb: boolean; hasWebHid: boolean }
): LedgerAvailabilityState {
  try {
    const { hasWebUsb, hasWebHid } = detectLedgerTransport(detector);
    const available = hasWebUsb || hasWebHid;
    const transportType = classifyTransportType(hasWebUsb, hasWebHid);

    if (available) {
      return {
        available: true,
        status: "available",
        transportType,
        setupInstruction: null,
        warningMessage: null,
      };
    }
    return {
      available: false,
      status: "unavailable",
      transportType,
      setupInstruction: LEDGER_SETUP_INSTRUCTION,
      warningMessage: LEDGER_SETUP_INSTRUCTION,
    };
  } catch (err) {
    console.warn(
      `${WARN_PREFIX} ledger transport availability check failed:`,
      err instanceof Error ? err.message : err
    );
    return {
      available: false,
      status: "error",
      transportType: "none",
      setupInstruction: LEDGER_SETUP_INSTRUCTION,
      warningMessage: `Unable to verify Ledger transport support. ${LEDGER_SETUP_INSTRUCTION}`,
    };
  }
}

/**
 * Runs a Ledger transport availability check and surfaces a warning toast
 * when the required browser APIs are missing or the check errors.
 */
export function warnOnMissingLedgerTransport(
  showToast: LedgerToastHandler,
  detector?: () => { hasWebUsb: boolean; hasWebHid: boolean }
): LedgerAvailabilityState {
  const state = checkLedgerAvailability(detector);
  if (!state.available && state.warningMessage) {
    showToast(state.warningMessage, "warning");
  }
  return state;
}

/** Captures a normalized stack string from an error or the current call site. */
export function formatStackTrace(err?: unknown): string {
  if (err instanceof Error && err.stack) {
    return err.stack;
  }

  if (typeof err === "string" && err.includes("\n")) {
    return err;
  }

  const synthetic = new Error(
    typeof err === "string" ? err : "Ledger USB bridge trace"
  );
  return synthetic.stack ?? "Error: Ledger USB bridge trace";
}

/** Builds a multi-line console warning block for transaction debug tracking. */
export function formatConsoleWarningBlock(
  block: LedgerConsoleWarningBlock
): string {
  const lines = [
    `${WARN_PREFIX} ╔══════════════════════════════════════╗`,
    `${WARN_PREFIX} ║ ${block.title.padEnd(36).slice(0, 36)} ║`,
    `${WARN_PREFIX} ╚══════════════════════════════════════╝`,
    `${WARN_PREFIX} ${block.body}`,
  ];

  if (block.txId) {
    lines.push(`${WARN_PREFIX} txId: ${block.txId}`);
  }
  if (block.phase) {
    lines.push(`${WARN_PREFIX} phase: ${block.phase}`);
  }

  lines.push(`${WARN_PREFIX} --- stack trace ---`);
  for (const frame of block.stack.split("\n")) {
    lines.push(`${WARN_PREFIX} ${frame}`);
  }
  lines.push(`${WARN_PREFIX} --- end stack ---`);

  return lines.join("\n");
}

/** Logs a formatted warning block (including stack) to the console. */
export function logLedgerWarning(
  title: string,
  body: string,
  options?: { err?: unknown; txId?: string; phase?: LedgerTxPhase }
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

export class LedgerTransactionTracker {
  private entries: LedgerTxTrackEntry[] = [];

  track(
    txId: string,
    phase: LedgerTxPhase,
    message: string,
    err?: unknown
  ): LedgerTxTrackEntry {
    const entry: LedgerTxTrackEntry = {
      txId,
      phase,
      message,
      timestamp: Date.now(),
      stack: formatStackTrace(err),
    };
    this.entries.push(entry);

    logLedgerWarning(`TX ${phase.toUpperCase()}`, message, {
      err,
      txId,
      phase,
    });

    return entry;
  }

  getHistory(txId?: string): LedgerTxTrackEntry[] {
    if (!txId) return [...this.entries];
    return this.entries.filter((e) => e.txId === txId);
  }

  clear(): void {
    this.entries = [];
  }
}

export const ledgerTracker = new LedgerTransactionTracker();

export class LedgerSignatureTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Ledger signature timed out after ${timeoutMs}ms`);
    this.name = "LedgerSignatureTimeoutError";
  }
}

export class LedgerUserRejectedError extends Error {
  constructor(message = "user rejected transaction") {
    super(message);
    this.name = "LedgerUserRejectedError";
  }
}

export class LedgerNetworkMismatchError extends Error {
  constructor(
    public readonly walletNetwork: LedgerNetwork,
    public readonly appNetwork: LedgerNetwork
  ) {
    super(
      `Network mismatch: wallet is on ${walletNetwork}, app expects ${appNetwork}`
    );
    this.name = "LedgerNetworkMismatchError";
  }
}

export function isUserRejectedError(err: unknown): boolean {
  if (err instanceof LedgerUserRejectedError) return true;
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user declined") ||
    message.includes("request rejected") ||
    message.includes("denied by the user")
  );
}

/** Zeroes and drops a sensitive buffer so it cannot be retained after abort. */
export function clearSensitiveMemory(
  request: LedgerSignRequest
): LedgerSignRequest {
  if (request.payload) {
    request.payload.fill(0);
  }
  request.payload = null;
  return request;
}

// Global tracking of active ledger_usb_bridge operations to support concurrency
let activeOperationsCount = 0;
const listeners = new Set<(isLoading: boolean) => void>();

export function isLedgerLoading(): boolean {
  return activeOperationsCount > 0;
}

export function subscribeToLedgerLoading(
  listener: (isLoading: boolean) => void
): () => void {
  listeners.add(listener);
  // Initial emit
  listener(activeOperationsCount > 0);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(): void {
  const loading = activeOperationsCount > 0;
  listeners.forEach((l) => l(loading));
}

export function startLedgerOperation(): void {
  activeOperationsCount++;
  notifyListeners();
}

export function endLedgerOperation(): void {
  activeOperationsCount = Math.max(0, activeOperationsCount - 1);
  notifyListeners();
}

export function resetLedgerOperations(): void {
  activeOperationsCount = 0;
  notifyListeners();
}

/**
 * Executes an async ledger operation wrapped in the loading overlay lifecycle.
 * Uses a try/finally pattern to ensure the loader is hidden even on errors.
 */
export async function withLedgerLoader<T>(fn: () => Promise<T>): Promise<T> {
  startLedgerOperation();
  try {
    return await fn();
  } finally {
    endLedgerOperation();
  }
}

/**
 * Mock/Placeholder for connect operation wrapped in the loader lifecycle.
 */
export async function connectLedgerDevice(delayMs = 50): Promise<void> {
  return withLedgerLoader(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  });
}

/**
 * Mock/Placeholder for app open operation wrapped in the loader lifecycle.
 */
export async function openLedgerApp(delayMs = 50): Promise<void> {
  return withLedgerLoader(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  });
}

/**
 * Mock/Placeholder for getting public address wrapped in the loader lifecycle.
 */
export async function getLedgerAddress(delayMs = 50): Promise<string> {
  return withLedgerLoader(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return "G...";
  });
}

/**
 * Races a signature operation against a timeout clock. On timeout the
 * operation is considered aborted and any sensitive payload memory is cleared.
 */
export async function signWithTimeout(
  request: LedgerSignRequest,
  signFn: (xdr: string) => Promise<LedgerSignResult>,
  timeoutMs: number = DEFAULT_SIGNATURE_TIMEOUT_MS
): Promise<LedgerSignResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      clearSensitiveMemory(request);
      reject(new LedgerSignatureTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await withLedgerLoader(() =>
      Promise.race([signFn(request.xdr), timeoutPromise])
    );
    clearSensitiveMemory(request);
    return result;
  } catch (err) {
    if (timedOut || err instanceof LedgerSignatureTimeoutError) {
      clearSensitiveMemory(request);
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Catches wallet "user rejected transaction" exceptions and surfaces a clean
 * warning toast instead of a raw error dump.
 */
export async function signCatchingRejection(
  signFn: () => Promise<LedgerSignResult>,
  showToast: LedgerToastHandler
): Promise<LedgerSignResult | null> {
  return withLedgerLoader(async () => {
    try {
      return await signFn();
    } catch (err) {
      if (isUserRejectedError(err)) {
        logLedgerWarning(
          "SIGNATURE REJECTED",
          err instanceof Error ? err.message : String(err),
          { err, phase: "signing" }
        );
        showToast(
          "Transaction cancelled — you rejected the signature on your Ledger.",
          "warning"
        );
        return null;
      }
      throw err;
    }
  });
}

export interface NetworkMismatchState {
  mismatched: boolean;
  walletNetwork: LedgerNetwork;
  appNetwork: LedgerNetwork;
  warningMessage: string | null;
}

export function checkNetworkMatch(
  walletNetwork: LedgerNetwork,
  appNetwork: LedgerNetwork
): NetworkMismatchState {
  const mismatched = walletNetwork !== appNetwork;
  return {
    mismatched,
    walletNetwork,
    appNetwork,
    warningMessage: mismatched
      ? `Network mismatch: your Ledger is on ${capitalize(walletNetwork)} but this app uses ${capitalize(appNetwork)}. Switch networks to continue.`
      : null,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Runs a network match check and, on mismatch, emits a formatted console
 * warning block (with stack) for Ledger transaction debug tracking.
 */
export function warnOnLedgerNetworkMismatch(
  walletNetwork: LedgerNetwork,
  appNetwork: LedgerNetwork
): NetworkMismatchState {
  const state = checkNetworkMatch(walletNetwork, appNetwork);
  if (state.mismatched && state.warningMessage) {
    logLedgerWarning("NETWORK MISMATCH", state.warningMessage, {
      err: new LedgerNetworkMismatchError(walletNetwork, appNetwork),
    });
  }
  return state;
}

/** Simulation / fee estimation result as returned by Soroban RPC. */
export interface LedgerSimulationResult {
  /** Estimated fee in stroops (1 XLM = 10_000_000 stroops). */
  fee: number;
  /** Optional error string from the simulation response. */
  error?: string;
  /** Raw simulation error object when the RPC reports a failure. */
  simulationError?: unknown;
}

export interface LedgerGasWarningState {
  hasWarning: boolean;
  highFee: boolean;
  simulationError: boolean;
  warningMessage: string | null;
}

/**
 * Fee ceiling above which a high-fee warning is emitted.
 * 1_000_000 stroops = 0.1 XLM.
 */
export const HIGH_FEE_THRESHOLD_STROOPS = 1_000_000;

/**
 * Inspects a simulation result and produces a user-facing warning state
 * when fee limits exceed standard bounds or the simulation reported an error.
 */
export function checkSimulationFeeWarning(
  result: LedgerSimulationResult
): LedgerGasWarningState {
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

/**
 * Inspects a simulation result and, when a warning applies, emits a
 * formatted console warning block via ledger_usb_bridge debug machinery.
 */
export function warnOnSimulationFee(
  result: LedgerSimulationResult,
  options?: { txId?: string }
): LedgerGasWarningState {
  const state = checkSimulationFeeWarning(result);

  if (state.hasWarning && state.warningMessage) {
    const title = state.simulationError ? "SIMULATION ERROR" : "HIGH FEE WARNING";
    logLedgerWarning(title, state.warningMessage, {
      err: new Error(state.warningMessage),
      txId: options?.txId,
      phase: "building",
    });
  }

  return state;
}
