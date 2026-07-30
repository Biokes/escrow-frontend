/**
 * albedo_connector — formatted console warnings/errors and transaction
 * lifecycle tracking for Albedo popup wallet debugging, plus wallet
 * availability checks, network mismatch warnings, signature timeout
 * bounds, and graceful handling of user signature rejections.
 *
 * Never logs private keys, seeds, credentials, or full sensitive payloads.
 */

import type { ToastType } from "@/app/context/ToastContext";

export type AlbedoTxPhase =
  | "idle"
  | "building"
  | "assembling"
  | "popup"
  | "signing"
  | "signed"
  | "submitting"
  | "confirming"
  | "success"
  | "error"
  | "cancelled";

export interface AlbedoTxTrackEntry {
  txId: string;
  phase: AlbedoTxPhase;
  message: string;
  timestamp: number;
  network?: string;
  operationType?: string;
  txHash?: string;
  stack?: string;
}

export interface AlbedoConsoleBlock {
  title: string;
  body: string;
  stack: string;
  txId?: string;
  phase?: AlbedoTxPhase;
  network?: string;
  operationType?: string;
  txHash?: string;
}

export interface AlbedoLogContext {
  err?: unknown;
  txId?: string;
  phase?: AlbedoTxPhase;
  network?: string;
  operationType?: string;
  txHash?: string;
}

const WARN_PREFIX = "[albedo_connector]";

const SENSITIVE_KEY_PATTERN =
  /(secret|private[_-]?key|seed|mnemonic|password|credential|auth[_-]?token)/i;

/** Captures a normalized stack string from an error or the current call site. */
export function formatStackTrace(err?: unknown): string {
  if (err instanceof Error && err.stack) {
    return err.stack;
  }

  if (typeof err === "string" && err.includes("\n")) {
    return err;
  }

  const synthetic = new Error(
    typeof err === "string" ? err : "Albedo connector trace"
  );
  return synthetic.stack ?? "Error: Albedo connector trace";
}

/** Redacts accidental sensitive substrings from log bodies. */
export function sanitizeAlbedoLogText(text: string): string {
  return text
    .replace(/S[A-Z2-7]{55}/g, "[REDACTED_SECRET]")
    .replace(
      /(secret|privateKey|seed|mnemonic|password|token)\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]"
    );
}

function assertNoSensitiveFields(context?: AlbedoLogContext): void {
  if (!context) return;
  for (const key of Object.keys(context)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error(
        `${WARN_PREFIX} refused to log sensitive field "${key}"`
      );
    }
  }
}

/** Builds a multi-line console block for transaction debug tracking. */
export function formatConsoleWarningBlock(block: AlbedoConsoleBlock): string {
  const title = sanitizeAlbedoLogText(block.title);
  const body = sanitizeAlbedoLogText(block.body);
  const stack = sanitizeAlbedoLogText(block.stack);

  const lines = [
    `${WARN_PREFIX} ╔══════════════════════════════════════╗`,
    `${WARN_PREFIX} ║ ${title.padEnd(36).slice(0, 36)} ║`,
    `${WARN_PREFIX} ╚══════════════════════════════════════╝`,
    `${WARN_PREFIX} ${body}`,
  ];

  if (block.txId) {
    lines.push(`${WARN_PREFIX} txId: ${sanitizeAlbedoLogText(block.txId)}`);
  }
  if (block.txHash) {
    lines.push(
      `${WARN_PREFIX} txHash: ${sanitizeAlbedoLogText(block.txHash)}`
    );
  }
  if (block.phase) {
    lines.push(`${WARN_PREFIX} phase: ${block.phase}`);
  }
  if (block.network) {
    lines.push(
      `${WARN_PREFIX} network: ${sanitizeAlbedoLogText(block.network)}`
    );
  }
  if (block.operationType) {
    lines.push(
      `${WARN_PREFIX} operation: ${sanitizeAlbedoLogText(block.operationType)}`
    );
  }

  lines.push(`${WARN_PREFIX} --- stack trace ---`);
  for (const frame of stack.split("\n")) {
    lines.push(`${WARN_PREFIX} ${frame}`);
  }
  lines.push(`${WARN_PREFIX} --- end stack ---`);

  return lines.join("\n");
}

function buildBlock(
  title: string,
  body: string,
  options?: AlbedoLogContext
): { formatted: string; stack: string } {
  assertNoSensitiveFields(options);
  const stack = formatStackTrace(options?.err);
  const formatted = formatConsoleWarningBlock({
    title,
    body,
    stack,
    txId: options?.txId,
    phase: options?.phase,
    network: options?.network,
    operationType: options?.operationType,
    txHash: options?.txHash,
  });
  return { formatted, stack };
}

/** Logs a formatted warning block (including stack) via console.warn. */
export function logAlbedoWarning(
  title: string,
  body: string,
  options?: AlbedoLogContext
): string {
  const { formatted } = buildBlock(title, body, options);
  console.warn(formatted);
  return formatted;
}

/**
 * Logs a formatted error block via console.error while preserving the original
 * error object (and its stack) as a secondary argument when available.
 */
export function logAlbedoError(
  title: string,
  body: string,
  options?: AlbedoLogContext
): string {
  const { formatted } = buildBlock(title, body, options);
  if (options?.err instanceof Error) {
    console.error(formatted, options.err);
  } else if (options?.err !== undefined) {
    console.error(formatted, options.err);
  } else {
    console.error(formatted);
  }
  return formatted;
}

export class AlbedoTransactionTracker {
  private entries: AlbedoTxTrackEntry[] = [];

  track(
    txId: string,
    phase: AlbedoTxPhase,
    message: string,
    options?: Omit<AlbedoLogContext, "txId" | "phase"> & { err?: unknown }
  ): AlbedoTxTrackEntry {
    const stack = formatStackTrace(options?.err);
    const entry: AlbedoTxTrackEntry = {
      txId,
      phase,
      message: sanitizeAlbedoLogText(message),
      timestamp: Date.now(),
      network: options?.network,
      operationType: options?.operationType,
      txHash: options?.txHash,
      stack,
    };
    this.entries.push(entry);

    const title = `TX ${phase.toUpperCase()}`;
    const logOptions: AlbedoLogContext = {
      err: options?.err,
      txId,
      phase,
      network: options?.network,
      operationType: options?.operationType,
      txHash: options?.txHash,
    };

    if (phase === "error") {
      logAlbedoError(title, message, logOptions);
    } else {
      logAlbedoWarning(title, message, logOptions);
    }

    return entry;
  }

  getHistory(txId?: string): AlbedoTxTrackEntry[] {
    if (!txId) return [...this.entries];
    return this.entries.filter((e) => e.txId === txId);
  }

  clear(): void {
    this.entries = [];
  }
}

export const albedoTracker = new AlbedoTransactionTracker();

/**
 * Convenience helpers for common Albedo transaction lifecycle stages.
 * Avoids duplicate noisy logs by going through the shared tracker.
 */
export function trackAlbedoLifecycle(
  txId: string,
  phase: AlbedoTxPhase,
  message: string,
  options?: Omit<AlbedoLogContext, "txId" | "phase">
): AlbedoTxTrackEntry {
  return albedoTracker.track(txId, phase, message, options);
}

// ---------------------------------------------------------------------------
// Wallet availability checks (#123)
// ---------------------------------------------------------------------------

/** Install URL surfaced when no Albedo wallet is detected. */
export const ALBEDO_INSTALL_URL = "https://albedo.link/";

/** Fallback copy shown when the Albedo wallet is missing. */
export const ALBEDO_SETUP_INSTRUCTION =
  "Albedo wallet not detected. Install Albedo and refresh this page to continue.";

export type AlbedoAvailabilityStatus = "available" | "unavailable" | "error";

export interface AlbedoAvailabilityState {
  available: boolean;
  status: AlbedoAvailabilityStatus;
  /** User-facing setup instructions when the wallet is missing. */
  setupInstruction: string | null;
  warningMessage: string | null;
}

export type AlbedoToastHandler = (message: string, type: ToastType) => void;

/**
 * Detects whether the Albedo wallet is present. Accepts an optional detector
 * override for tests / non-browser runtimes.
 */
export function detectAlbedoExtension(detector?: () => boolean): boolean {
  if (detector) {
    return detector();
  }
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as unknown as Record<string, unknown>;
  return !!(w["albedo"] || w["albedoApi"]);
}

/**
 * Checks Albedo availability and returns fallback setup instructions when
 * the wallet is missing or the check itself throws.
 */
export function checkAlbedoAvailability(
  detector?: () => boolean
): AlbedoAvailabilityState {
  try {
    const available = detectAlbedoExtension(detector);
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
      setupInstruction: ALBEDO_SETUP_INSTRUCTION,
      warningMessage: ALBEDO_SETUP_INSTRUCTION,
    };
  } catch (err) {
    logAlbedoWarning("WALLET UNAVAILABLE", "wallet availability check failed", {
      err,
    });
    return {
      available: false,
      status: "error",
      setupInstruction: ALBEDO_SETUP_INSTRUCTION,
      warningMessage: `Unable to verify wallet availability. ${ALBEDO_SETUP_INSTRUCTION}`,
    };
  }
}

/**
 * Runs an Albedo availability check and surfaces a warning toast when the
 * wallet is missing or the check errors.
 */
export function warnOnMissingAlbedo(
  showToast: AlbedoToastHandler,
  detector?: () => boolean
): AlbedoAvailabilityState {
  const state = checkAlbedoAvailability(detector);
  if (!state.available && state.warningMessage) {
    showToast(state.warningMessage, "warning");
  }
  return state;
}

// ---------------------------------------------------------------------------
// Network mismatch warnings (#126)
// ---------------------------------------------------------------------------

/** Chains the Albedo wallet can be pointed at. */
export type AlbedoNetwork = "mainnet" | "testnet";

export interface AlbedoNetworkMismatchState {
  mismatched: boolean;
  walletNetwork: AlbedoNetwork;
  appNetwork: AlbedoNetwork;
  warningMessage: string | null;
}

export class AlbedoNetworkMismatchError extends Error {
  constructor(
    public readonly walletNetwork: AlbedoNetwork,
    public readonly appNetwork: AlbedoNetwork
  ) {
    super(
      `Network mismatch: Albedo wallet is on ${walletNetwork}, app expects ${appNetwork}`
    );
    this.name = "AlbedoNetworkMismatchError";
  }
}

function capitalizeNetwork(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Compares the network the Albedo wallet is pointed at against the network
 * the app expects and produces a user-facing warning message when they diverge.
 */
export function checkAlbedoNetworkMatch(
  walletNetwork: AlbedoNetwork,
  appNetwork: AlbedoNetwork
): AlbedoNetworkMismatchState {
  const mismatched = walletNetwork !== appNetwork;
  return {
    mismatched,
    walletNetwork,
    appNetwork,
    warningMessage: mismatched
      ? `Network mismatch: your Albedo wallet is on ${capitalizeNetwork(walletNetwork)} but this app uses ${capitalizeNetwork(appNetwork)}. Switch networks in Albedo to continue.`
      : null,
  };
}

/**
 * Runs a network match check and, on mismatch, emits a formatted console
 * warning block (with stack) via the shared albedo_connector debug machinery.
 */
export function warnOnAlbedoNetworkMismatch(
  walletNetwork: AlbedoNetwork,
  appNetwork: AlbedoNetwork
): AlbedoNetworkMismatchState {
  const state = checkAlbedoNetworkMatch(walletNetwork, appNetwork);
  if (state.mismatched && state.warningMessage) {
    logAlbedoWarning("NETWORK MISMATCH", state.warningMessage, {
      err: new AlbedoNetworkMismatchError(walletNetwork, appNetwork),
      network: walletNetwork,
    });
  }
  return state;
}

// ---------------------------------------------------------------------------
// Transaction signature time limit bounds (#124)
// ---------------------------------------------------------------------------

/** Default bound for Albedo signature requests (milliseconds). */
export const DEFAULT_ALBEDO_SIGNATURE_TIMEOUT_MS = 60_000;

export interface AlbedoSignRequest {
  xdr: string;
  /** Sensitive buffer cleared on timeout / completion. */
  payload?: Uint8Array | null;
}

export class AlbedoSignatureTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Albedo signature timed out after ${timeoutMs}ms`);
    this.name = "AlbedoSignatureTimeoutError";
  }
}

/**
 * Zeroes and drops a sensitive buffer so it cannot be retained after the
 * operation is aborted or completes.
 */
export function clearAlbedoSensitiveMemory(
  request: AlbedoSignRequest
): AlbedoSignRequest {
  if (request.payload) {
    request.payload.fill(0);
  }
  request.payload = null;
  return request;
}

/**
 * Races an Albedo signature operation against a timeout clock. On timeout
 * the operation is aborted and any sensitive payload memory is cleared.
 */
export async function signAlbedoWithTimeout<T>(
  request: AlbedoSignRequest,
  signFn: (xdr: string) => Promise<T>,
  timeoutMs: number = DEFAULT_ALBEDO_SIGNATURE_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      clearAlbedoSensitiveMemory(request);
      reject(new AlbedoSignatureTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([signFn(request.xdr), timeoutPromise]);
    clearAlbedoSensitiveMemory(request);
    return result;
  } catch (err) {
    if (timedOut || err instanceof AlbedoSignatureTimeoutError) {
      clearAlbedoSensitiveMemory(request);
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// User signature rejection handling (#125)
// ---------------------------------------------------------------------------

export class AlbedoUserRejectedError extends Error {
  constructor(message = "user rejected transaction") {
    super(message);
    this.name = "AlbedoUserRejectedError";
  }
}

/** Detects "user rejected the signature request" style errors from Albedo. */
export function isAlbedoUserRejected(err: unknown): boolean {
  if (err instanceof AlbedoUserRejectedError) return true;
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user declined") ||
    message.includes("request rejected") ||
    message.includes("denied by the user") ||
    message.includes("rejected by user") ||
    message.includes("canceled by user") ||
    message.includes("cancelled by user")
  );
}

/**
 * Runs an Albedo signature step. Catches "user rejected transaction"
 * exceptions, logs them, and shows a clean warning toast instead of
 * surfacing a raw error to the caller.
 */
export async function runAlbedoSign<T>(
  signFn: () => Promise<T>,
  showToast: AlbedoToastHandler
): Promise<T | null> {
  try {
    return await signFn();
  } catch (err) {
    if (isAlbedoUserRejected(err)) {
      logAlbedoWarning("SIGNATURE REJECTED", "signature rejected by user", {
        err,
      });
      showToast(
        "Signature cancelled — you rejected the request in Albedo.",
        "warning"
      );
      return null;
    }
    throw err;
  }
}
