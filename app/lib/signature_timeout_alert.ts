/**
 * signature_timeout_alert — signature timeout display module.
 *
 * Provides four capabilities used across the wallet signing flow:
 *
 *  1. Secure persistent caching for active keys (#247)
 *     Serialises the active signing address to localStorage so the session
 *     survives page reloads.  State is version-tagged, validated on read, and
 *     the in-memory reference is returned as a defensive copy.
 *
 *  2. Graceful user-rejection handling (#245)
 *     Catches the "user rejected transaction" exceptions returned by every
 *     supported wallet extension, logs a structured warning block, and shows a
 *     clean "warning" toast instead of surfacing a raw error to the caller.
 *
 *  3. Transaction signature time-limit bounds (#244)
 *     Races a signing call against a configurable timeout clock.  If the
 *     wallet does not respond within the bound the operation is aborted,
 *     sensitive in-memory payload bytes are zeroed, and a typed
 *     SignatureTimeoutAlertError is thrown.
 *
 *  4. Wallet availability check (#243)
 *     Detects whether a supported wallet extension is installed.  When it is
 *     not the caller receives human-readable setup instructions and, if a
 *     toast handler is provided, a visible "warning" toast.
 *
 * All exported names are prefixed with "SignatureTimeoutAlert" so the module
 * is unambiguous when imported alongside the per-wallet connector modules.
 */

import type { ToastType } from "@/app/context/ToastContext";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[signature_timeout_alert]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatStack(err?: unknown): string {
  if (err instanceof Error && err.stack) return err.stack;
  if (typeof err === "string" && err.includes("\n")) return err;
  const synthetic = new Error(
    typeof err === "string" ? err : "signature_timeout_alert trace"
  );
  return synthetic.stack ?? "Error: signature_timeout_alert trace";
}

function emitWarning(title: string, body: string, err?: unknown): string {
  const stack = formatStack(err);
  const paddedTitle = title.padEnd(36).slice(0, 36);
  const lines = [
    `${LOG_PREFIX} ╔══════════════════════════════════════╗`,
    `${LOG_PREFIX} ║ ${paddedTitle} ║`,
    `${LOG_PREFIX} ╚══════════════════════════════════════╝`,
    `${LOG_PREFIX} ${body}`,
    `${LOG_PREFIX} --- stack trace ---`,
    ...stack.split("\n").map((f) => `${LOG_PREFIX} ${f}`),
    `${LOG_PREFIX} --- end stack ---`,
  ];
  const formatted = lines.join("\n");
  console.warn(formatted);
  return formatted;
}

// ---------------------------------------------------------------------------
// #244 — Transaction signature time-limit bounds
// ---------------------------------------------------------------------------

/** Default signing window before the alert aborts the operation (60 seconds). */
export const DEFAULT_SIGNATURE_TIMEOUT_MS = 60_000;

/**
 * Thrown when a wallet signing call does not return within the configured
 * time limit.  Carries the timeout value so UI layers can surface it.
 */
export class SignatureTimeoutAlertError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Signature timed out after ${timeoutMs}ms`);
    this.name = "SignatureTimeoutAlertError";
  }
}

export interface SignatureTimeoutAlertRequest {
  xdr: string;
  /**
   * Optional sensitive byte buffer.  It is zeroed and nulled on both
   * successful completion and timeout/error so it cannot be leaked.
   */
  payload?: Uint8Array | null;
}

/** Zeroes the payload bytes and sets the reference to null. */
export function clearSignatureAlertMemory(
  request: SignatureTimeoutAlertRequest
): SignatureTimeoutAlertRequest {
  if (request.payload) {
    request.payload.fill(0);
  }
  request.payload = null;
  return request;
}

/**
 * Races a wallet signing call against a timeout clock.
 *
 * - Resolves with the value returned by `signFn` when the wallet responds in
 *   time.
 * - Clears sensitive payload memory on both success and failure paths.
 * - Throws {@link SignatureTimeoutAlertError} when the clock fires first.
 * - Re-throws any other error from `signFn` unchanged.
 */
export async function runSignatureWithTimeout<T>(
  request: SignatureTimeoutAlertRequest,
  signFn: (xdr: string) => Promise<T>,
  timeoutMs: number = DEFAULT_SIGNATURE_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      clearSignatureAlertMemory(request);
      reject(new SignatureTimeoutAlertError(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([signFn(request.xdr), timeoutPromise]);
    clearSignatureAlertMemory(request);
    return result;
  } catch (err) {
    if (timedOut || err instanceof SignatureTimeoutAlertError) {
      clearSignatureAlertMemory(request);
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// #245 — Graceful user-rejection handling
// ---------------------------------------------------------------------------

/**
 * First-class error for explicit user refusals.  Callers may throw this
 * directly; it is also detected by {@link isSignatureRejectedByUser}.
 */
export class SignatureRejectedByUserError extends Error {
  constructor(message = "user rejected transaction") {
    super(message);
    this.name = "SignatureRejectedByUserError";
  }
}

/**
 * Returns `true` when `err` represents a deliberate user refusal:
 * - First-class {@link SignatureRejectedByUserError} instance.
 * - Any `Error` whose lowercase message contains a common rejection phrase.
 *
 * Non-`Error` values always return `false`.
 */
export function isSignatureRejectedByUser(err: unknown): boolean {
  if (err instanceof SignatureRejectedByUserError) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user declined") ||
    msg.includes("request rejected") ||
    msg.includes("denied by the user") ||
    msg.includes("rejected by user") ||
    msg.includes("canceled by user") ||
    msg.includes("cancelled by user")
  );
}

export type SignatureAlertToastHandler = (
  message: string,
  type: ToastType
) => void;

/**
 * Executes `signFn`.  If the wallet returns a user-rejection error the
 * function:
 *  - logs a structured warning block (via `console.warn`), and
 *  - calls `showToast` with a clean "warning" message,
 *  - returns `null` so the caller can treat it as a no-op.
 *
 * All other errors are re-thrown unchanged.
 */
export async function runSignatureWithRejectionHandling<T>(
  signFn: () => Promise<T>,
  showToast: SignatureAlertToastHandler
): Promise<T | null> {
  try {
    return await signFn();
  } catch (err) {
    if (isSignatureRejectedByUser(err)) {
      emitWarning(
        "SIGNATURE REJECTED",
        "signature rejected by user",
        err
      );
      showToast(
        "Signature cancelled — you rejected the request in your wallet.",
        "warning"
      );
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// #243 — Wallet availability check
// ---------------------------------------------------------------------------

/** Install page URL shown when no supported wallet extension is detected. */
export const SIGNATURE_ALERT_INSTALL_URL = "https://www.freighter.app/";

/** Default setup copy shown to users when no wallet extension is installed. */
export const SIGNATURE_ALERT_SETUP_INSTRUCTION =
  "No supported wallet extension detected. " +
  "Install Freighter (freighter.app) and refresh this page to continue.";

export type SignatureAlertAvailabilityStatus =
  | "available"
  | "unavailable"
  | "error";

export interface SignatureAlertAvailabilityState {
  available: boolean;
  status: SignatureAlertAvailabilityStatus;
  /** Human-readable setup instructions when the wallet is missing or errored. */
  setupInstruction: string | null;
  /** Message surfaced as a toast when the wallet is missing or errored. */
  warningMessage: string | null;
}

/**
 * Detects whether a supported wallet extension is present.  Checks for
 * `window.freighterApi`, `window.freighter`, `window.albedo`, and
 * `window.rabeApi` — the four extensions used by this app.
 *
 * Accepts an optional `detector` override so tests and non-browser runtimes
 * can inject their own check without touching `window`.
 */
export function detectSignatureAlertWallet(
  detector?: () => boolean
): boolean {
  if (detector) return detector();
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(
    w["freighterApi"] ||
    w["freighter"] ||
    w["albedo"] ||
    w["albedoApi"] ||
    w["rabeApi"] ||
    w["rabe"]
  );
}

/**
 * Checks wallet availability and returns a state object with setup
 * instructions when no extension is found or the check itself throws.
 */
export function checkSignatureAlertAvailability(
  detector?: () => boolean
): SignatureAlertAvailabilityState {
  try {
    const available = detectSignatureAlertWallet(detector);
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
      setupInstruction: SIGNATURE_ALERT_SETUP_INSTRUCTION,
      warningMessage: SIGNATURE_ALERT_SETUP_INSTRUCTION,
    };
  } catch (err) {
    emitWarning(
      "WALLET UNAVAILABLE",
      "wallet availability check failed",
      err
    );
    return {
      available: false,
      status: "error",
      setupInstruction: SIGNATURE_ALERT_SETUP_INSTRUCTION,
      warningMessage: `Unable to verify wallet availability. ${SIGNATURE_ALERT_SETUP_INSTRUCTION}`,
    };
  }
}

/**
 * Runs a wallet availability check and calls `showToast` with a "warning"
 * toast when the extension is missing or the check errors.  Returns the full
 * availability state so callers can branch on it.
 */
export function warnOnMissingSignatureAlertWallet(
  showToast: SignatureAlertToastHandler,
  detector?: () => boolean
): SignatureAlertAvailabilityState {
  const state = checkSignatureAlertAvailability(detector);
  if (!state.available && state.warningMessage) {
    showToast(state.warningMessage, "warning");
  }
  return state;
}

// ---------------------------------------------------------------------------
// #247 — Secure persistent caching for active keys
// ---------------------------------------------------------------------------

export const SIGNATURE_ALERT_STORAGE_KEY =
  "signature_timeout_alert_active_address";
export const SIGNATURE_ALERT_SCHEMA_VERSION = 1 as const;

export interface SignatureAlertActiveAddress {
  address: string;
  network: string;
  connectedAt: number;
}

interface SignatureAlertSerializedV1 {
  version: typeof SIGNATURE_ALERT_SCHEMA_VERSION;
  address: string;
  network: string;
  connectedAt: number;
}

function isValidActiveAddress(
  value: unknown
): value is SignatureAlertActiveAddress {
  if (!isRecord(value)) return false;
  if (typeof value.address !== "string" || value.address.length === 0)
    return false;
  if (typeof value.network !== "string") return false;
  if (
    typeof value.connectedAt !== "number" ||
    !Number.isFinite(value.connectedAt)
  )
    return false;
  return true;
}

function sanitizeActiveAddress(
  value: unknown
): SignatureAlertActiveAddress | null {
  if (!isValidActiveAddress(value)) return null;
  return {
    address: value.address,
    network: value.network,
    connectedAt: value.connectedAt,
  };
}

function isValidSerializedPayload(
  value: unknown
): value is SignatureAlertSerializedV1 {
  if (!isRecord(value)) return false;
  if (value.version !== SIGNATURE_ALERT_SCHEMA_VERSION) return false;
  if (typeof value.address !== "string" || value.address.length === 0)
    return false;
  if (typeof value.network !== "string") return false;
  if (
    typeof value.connectedAt !== "number" ||
    !Number.isFinite(value.connectedAt)
  )
    return false;
  return true;
}

function getStorageAdapter(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const testKey = "__signature_timeout_alert_storage_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Versioned localStorage store for the active signing address.
 *
 * - Persists `{ address, network, connectedAt }` under a versioned key so
 *   the session survives page reloads.
 * - Validates the persisted shape on read; silently clears corrupt entries.
 * - Exposes `overrideStorage()` so tests can inject an in-memory adapter
 *   without touching `window.localStorage`.
 */
export class SignatureAlertActiveAddressStore {
  private activeAddress: SignatureAlertActiveAddress | null = null;
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
        const payload: SignatureAlertSerializedV1 = {
          version: SIGNATURE_ALERT_SCHEMA_VERSION,
          address: this.activeAddress.address,
          network: this.activeAddress.network,
          connectedAt: this.activeAddress.connectedAt,
        };
        this.storage.setItem(
          SIGNATURE_ALERT_STORAGE_KEY,
          JSON.stringify(payload)
        );
      } else {
        this.storage.removeItem(SIGNATURE_ALERT_STORAGE_KEY);
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} PERSIST FAILED`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /**
   * Re-reads persisted state from storage into memory.  Public so tests can
   * simulate a page reload (bootstrapping a fresh store from existing storage)
   * without constructing a new instance.
   */
  rehydrate(): void {
    this.activeAddress = null;
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(SIGNATURE_ALERT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!isValidSerializedPayload(parsed)) {
        console.warn(
          `${LOG_PREFIX} REHYDRATE SCHEMA MISMATCH`,
          "Persisted active address failed validation, clearing."
        );
        this.storage.removeItem(SIGNATURE_ALERT_STORAGE_KEY);
        return;
      }
      this.activeAddress = sanitizeActiveAddress(parsed);
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} REHYDRATE FAILED`,
        err instanceof Error ? err.message : String(err)
      );
      try {
        this.storage.removeItem(SIGNATURE_ALERT_STORAGE_KEY);
      } catch {
        // best-effort cleanup
      }
    }
  }

  /**
   * Replaces the storage backend and immediately re-reads state from it.
   * Intended as a test seam; safe to call at runtime too.
   */
  overrideStorage(nextStorage: Storage | null): void {
    this.storage = nextStorage;
    this.rehydrate();
  }

  setActiveAddress(address: SignatureAlertActiveAddress | null): void {
    this.activeAddress = address ? sanitizeActiveAddress(address) : null;
    this.persist();
  }

  /** Returns a defensive copy so callers cannot mutate the stored reference. */
  getActiveAddress(): SignatureAlertActiveAddress | null {
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
        this.storage.removeItem(SIGNATURE_ALERT_STORAGE_KEY);
      } catch (err) {
        console.warn(
          `${LOG_PREFIX} CLEAR STORAGE FAILED`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }
}

/** Singleton store used by the signing flow. */
export const signatureAlertActiveAddress =
  new SignatureAlertActiveAddressStore();
