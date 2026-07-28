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

function getSessionStorageAdapter(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const testKey = "__freighter_connector_storage_test__";
    window.sessionStorage.setItem(testKey, "1");
    window.sessionStorage.removeItem(testKey);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export class FreighterActiveAddressStore {
  private activeAddress: FreighterActiveAddress | null = null;
  private storage: Storage | null;

  constructor(storageOverride?: Storage | null) {
    this.storage =
      storageOverride !== undefined ? storageOverride : getSessionStorageAdapter();
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

  private rehydrate(): void {
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
      this.activeAddress = {
        address: parsed.address,
        network: parsed.network,
        connectedAt: parsed.connectedAt,
      };
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

  setActiveAddress(address: FreighterActiveAddress | null): void {
    if (address) {
      if (isValidFreighterActiveAddress(address)) {
        this.activeAddress = {
          address: address.address,
          network: address.network,
          connectedAt: address.connectedAt,
        };
      } else {
        this.activeAddress = null;
      }
    } else {
      this.activeAddress = null;
    }
    this.persist();
  }

  getActiveAddress(): FreighterActiveAddress | null {
    this.activeAddress = null;
    this.rehydrate();
    const addr = this.activeAddress as FreighterActiveAddress | null;
    return addr ? { address: addr.address, network: addr.network, connectedAt: addr.connectedAt } : null;
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
  getAddressFn: () => Promise<any> = getFreighterAddress,
  isConnectedFn: () => Promise<any> = isFreighterConnected
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
        ? (conn as any).isConnected
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
        ? (liveResult as any).address
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
