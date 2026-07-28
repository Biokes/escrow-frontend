/**
 * network_sync_checker — active network status validator:
 * alignment checks, wallet availability detection, signature time limits,
 * and graceful handling of wallet signature rejections during sync probes.
 */

import type { ToastType } from "@/app/context/ToastContext";

export type SyncNetwork = "mainnet" | "testnet";

export type SyncToastHandler = (message: string, type: ToastType) => void;

export type WalletAvailabilityStatus =
  | "available"
  | "unavailable"
  | "error";

export interface WalletAvailabilityState {
  available: boolean;
  status: WalletAvailabilityStatus;
  /** User-facing setup instructions when the wallet extension is missing. */
  setupInstruction: string | null;
  warningMessage: string | null;
}

const LOG_PREFIX = "[network_sync_checker]";

/** Default bound for wallet signature probes during network sync. */
export const DEFAULT_SIGNATURE_TIMEOUT_MS = 60_000;

/** Install URL for Freighter — the primary recommended Stellar extension. */
export const WALLET_INSTALL_URL = "https://www.freighter.app/";

/** Fallback copy shown when no supported wallet extension is detected. */
export const WALLET_SETUP_INSTRUCTION =
  "No wallet extension detected. Install a supported Stellar wallet (Freighter, Albedo, xBull, or Hana) and refresh this page to continue.";

export interface NetworkSyncState {
  synced: boolean;
  walletNetwork: SyncNetwork;
  appNetwork: SyncNetwork;
  warningMessage: string | null;
}

export interface NetworkSyncSignRequest {
  xdr: string;
  /** Sensitive buffer cleared on timeout / completion. */
  payload?: Uint8Array | null;
}

export interface NetworkSyncSignResult {
  signedXdr: string;
}

export class NetworkSyncSignatureTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Network sync signature timed out after ${timeoutMs}ms`);
    this.name = "NetworkSyncSignatureTimeoutError";
  }
}

export class NetworkSyncUserRejectedError extends Error {
  constructor(message = "user rejected transaction") {
    super(message);
    this.name = "NetworkSyncUserRejectedError";
  }
}

export function isNetworkSyncUserRejected(err: unknown): boolean {
  if (err instanceof NetworkSyncUserRejectedError) return true;
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
  request: NetworkSyncSignRequest
): NetworkSyncSignRequest {
  if (request.payload) {
    request.payload.fill(0);
  }
  request.payload = null;
  return request;
}

/**
 * Races a signature operation against a timeout clock. On timeout the
 * operation is considered aborted and any sensitive payload memory is cleared.
 */
export async function signWithTimeout(
  request: NetworkSyncSignRequest,
  signFn: (xdr: string) => Promise<NetworkSyncSignResult>,
  timeoutMs: number = DEFAULT_SIGNATURE_TIMEOUT_MS
): Promise<NetworkSyncSignResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      clearSensitiveMemory(request);
      reject(new NetworkSyncSignatureTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([signFn(request.xdr), timeoutPromise]);
    clearSensitiveMemory(request);
    return result;
  } catch (err) {
    if (timedOut || err instanceof NetworkSyncSignatureTimeoutError) {
      clearSensitiveMemory(request);
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function capitalizeNetwork(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Compares wallet and app networks for sync readiness. */
export function checkNetworkSync(
  walletNetwork: SyncNetwork,
  appNetwork: SyncNetwork
): NetworkSyncState {
  const synced = walletNetwork === appNetwork;
  return {
    synced,
    walletNetwork,
    appNetwork,
    warningMessage: synced
      ? null
      : `Network out of sync: your wallet is on ${capitalizeNetwork(walletNetwork)} but this app uses ${capitalizeNetwork(appNetwork)}. Switch networks to continue.`,
  };
}

/**
 * Runs a wallet signature step during network sync validation. Catches
 * "user rejected transaction" exceptions, logs them, and shows a warning toast.
 */
export async function runNetworkSyncSign<T>(
  signFn: () => Promise<T>,
  showToast: SyncToastHandler
): Promise<T | null> {
  try {
    return await signFn();
  } catch (err) {
    if (isNetworkSyncUserRejected(err)) {
      console.warn(
        `${LOG_PREFIX} signature rejected during network sync:`,
        err instanceof Error ? err.message : err
      );
      showToast(
        "Network sync cancelled — you rejected the signature in your wallet.",
        "warning"
      );
      return null;
    }
    throw err;
  }
}

/**
 * Validates network alignment before running a sync signature probe. When
 * networks match, delegates to {@link runNetworkSyncSign}.
 */
export async function validateNetworkSyncWithSignature<T>(
  walletNetwork: SyncNetwork,
  appNetwork: SyncNetwork,
  signFn: () => Promise<T>,
  showToast: SyncToastHandler
): Promise<T | null> {
  const state = checkNetworkSync(walletNetwork, appNetwork);
  if (!state.synced && state.warningMessage) {
    showToast(state.warningMessage, "warning");
    return null;
  }
  return runNetworkSyncSign(signFn, showToast);
}

/**
 * Detects whether a supported Stellar wallet extension is present in the
 * browser. Accepts an optional detector for tests / non-browser runtimes.
 */
export function detectWalletExtension(detector?: () => boolean): boolean {
  if (detector) {
    return detector();
  }
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as unknown as Record<string, unknown>;
  return !!(
    w["freighterApi"] ||
    w["freighter"] ||
    w["albedo"] ||
    w["xBullSDK"] ||
    w["hanaWallet"]
  );
}

/**
 * Checks wallet extension availability and returns fallback setup instructions
 * when the extension is missing or the check itself throws.
 */
export function checkWalletAvailability(
  detector?: () => boolean
): WalletAvailabilityState {
  try {
    const available = detectWalletExtension(detector);
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
      setupInstruction: WALLET_SETUP_INSTRUCTION,
      warningMessage: WALLET_SETUP_INSTRUCTION,
    };
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} wallet availability check failed:`,
      err instanceof Error ? err.message : err
    );
    return {
      available: false,
      status: "error",
      setupInstruction: WALLET_SETUP_INSTRUCTION,
      warningMessage: `Unable to verify wallet availability. ${WALLET_SETUP_INSTRUCTION}`,
    };
  }
}

/**
 * Runs a wallet availability check and surfaces a warning toast when the
 * extension is missing or the check errors.
 */
export function warnOnMissingWallet(
  showToast: SyncToastHandler,
  detector?: () => boolean
): WalletAvailabilityState {
  const state = checkWalletAvailability(detector);
  if (!state.available && state.warningMessage) {
    showToast(state.warningMessage, "warning");
  }
  return state;
}

// =============================================================
// Multi-signature transaction assembly helpers (#159)
// -------------------------------------------------------------
// Helpers that break a network-sync signature flow into per-signer
// "splits" and re-validate that the assembled envelope is structurally
// well-formed before submission. These helpers are intentionally
// transport-agnostic: callers feed in opaque base64 XDR strings and
// the helpers confirm those strings parse, that the splits combine
// into a unique-signer set, and that the assembly reaches whatever
// threshold the caller requires.
// =============================================================

/** Default minimum signature count required for a multi-sig assembly. */
export const DEFAULT_MULTISIG_MIN_SIGNATURES = 2;

/** Stable error codes carried on {@link NetworkSyncMultiSigStructureError}. */
export type NetworkSyncMultiSigErrorCode =
  | "empty_xdr"
  | "invalid_base64"
  | "malformed_envelope"
  | "missing_signatures"
  | "decorator_mismatch"
  | "insufficient_signatures"
  | "duplicate_signer";

/**
 * Raised whenever a multi-signature assembly or envelope fails one of the
 * structural checks performed by the helper hooks. Carries a stable
 * {@link code} on top of the human-readable message so callers can branch
 * on the failure mode without parsing strings.
 */
export class NetworkSyncMultiSigStructureError extends Error {
  readonly code: NetworkSyncMultiSigErrorCode;
  constructor(code: NetworkSyncMultiSigErrorCode, message: string) {
    super(message);
    this.name = "NetworkSyncMultiSigStructureError";
    this.code = code;
  }
}

/** One signer slot in a multi-sig envelope. */
export interface NetworkSyncMultiSigSigner {
  publicKey: string;
  hint: string;
}

/** Parsed structural view of a multi-sig transaction envelope. */
export interface NetworkSyncMultiSigEnvelopeShape {
  /** Round-trippable base64 XDR string. */
  baseXdr: string;
  /** Number of signature slots the envelope was parsed with. */
  signatures: number;
  /** Optional pre-parsed source account attached by the caller. */
  sourceAccount: string | null;
  /**
   * One entry per signature slot, recording the slot index (1..N). These are
   * positional slots within the parsed envelope, not signer descriptors; use
   * {@link NetworkSyncMultiSigSplit.signer} to attach a real signer to a slot.
   */
  signatureSlotIndices: number[];
}

/** Optional hooks for {@link parseMultiSigEnvelope}. */
export interface NetworkSyncMultiSigParseOptions {
  /**
   * Override the default structural signature-count heuristic. Production
   * wallets should typically inject a real XDR-aware extractor; the default
   * is a meaningful-but-conservative placeholder keyed on byte length.
   */
  countSignatures?: (bytes: Uint8Array) => number;
  /** Source account to attach to the parsed envelope shape. */
  sourceAccount?: string | null;
  /** Required signature slot count — mismatches throw `decorator_mismatch`. */
  expectedSignatures?: number;
}

/** Options for {@link validateMultiSigAssembly}. */
export interface NetworkSyncMultiSigAssemblyOptions {
  minRequired?: number;
  parseOptions?: NetworkSyncMultiSigParseOptions;
}

/** One signed slice of a multi-sig flow belonging to a single signer. */
export interface NetworkSyncMultiSigSplit {
  baseXdr: string;
  signer: NetworkSyncMultiSigSigner;
  /** Signed placeholder — callers overwrite once the wallet signs. */
  signedXdr: string;
}

function decodeBase64Envelope(input: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(input, "base64"));
  }
  try {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (err) {
    throw new NetworkSyncMultiSigStructureError(
      "invalid_base64",
      err instanceof Error
        ? `Multi-sig envelope XDR is not valid base64: ${err.message}`
        : "Multi-sig envelope XDR is not valid base64."
    );
  }
}

function encodeBase64Envelope(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function normalizeBase64(value: string): string {
  return value.replace(/=+$/, "").replace(/\s+/g, "");
}

/**
 * Default structural extractor. Yields a conservative signature slot count
 * based on envelope byte length when no real XDR parser has been injected.
 * Callers building production multi-sig flows should pass an XDR-aware
 * extractor through {@link NetworkSyncMultiSigParseOptions.countSignatures}.
 */
const DEFAULT_SIGNATURE_SLOT_EXTRACTOR = (bytes: Uint8Array): number => {
  if (bytes.length === 0) return 0;
  return Math.max(1, Math.floor(bytes.length / 80));
};

/**
 * Parses a multi-sig transaction envelope and returns its structural shape.
 * Performs the validation checks required by the issue (#159):
 * - the XDR string is non-empty;
 * - the XDR string is valid base64 (verified by a round-trip);
 * - the decoded byte payload carries at least one signature slot.
 */
export function parseMultiSigEnvelope(
  baseXdr: string,
  options: NetworkSyncMultiSigParseOptions = {}
): NetworkSyncMultiSigEnvelopeShape {
  if (typeof baseXdr !== "string") {
    throw new NetworkSyncMultiSigStructureError(
      "empty_xdr",
      "Multi-sig envelope XDR must be a string."
    );
  }
  const trimmed = baseXdr.trim();
  if (trimmed.length === 0) {
    throw new NetworkSyncMultiSigStructureError(
      "empty_xdr",
      "Multi-sig envelope XDR is empty."
    );
  }
  const bytes = decodeBase64Envelope(trimmed);
  if (bytes.length === 0) {
    throw new NetworkSyncMultiSigStructureError(
      "malformed_envelope",
      "Multi-sig envelope XDR decodes to an empty byte payload."
    );
  }
  const original = normalizeBase64(trimmed);
  const reEncoded = normalizeBase64(encodeBase64Envelope(bytes));
  if (original !== reEncoded) {
    throw new NetworkSyncMultiSigStructureError(
      "invalid_base64",
      "Multi-sig envelope XDR round-trip mismatch — input is not valid base64."
    );
  }
  const extractor = options.countSignatures ?? DEFAULT_SIGNATURE_SLOT_EXTRACTOR;
  const signatures = extractor(bytes);
  if (signatures < 1) {
    throw new NetworkSyncMultiSigStructureError(
      "missing_signatures",
      "Multi-sig envelope contains zero signature slots."
    );
  }
  if (
    typeof options.expectedSignatures === "number" &&
    signatures !== options.expectedSignatures
  ) {
    throw new NetworkSyncMultiSigStructureError(
      "decorator_mismatch",
      `Multi-sig envelope has ${signatures} signature slot(s); expected ${options.expectedSignatures}.`
    );
  }
  const sourceAccount =
    Object.hasOwn(options, "sourceAccount")
      ? options.sourceAccount ?? null
      : null;
  return {
    baseXdr: trimmed,
    signatures,
    sourceAccount,
    signatureSlotIndices: Array.from(
      { length: signatures },
      (_, i) => i + 1
    ),
  };
}

/**
 * Slices a base multi-sig XDR into a per-signer {@link NetworkSyncMultiSigSplit}.
 * The split's `signedXdr` is initialised to the base XDR so callers can pass it
 * directly to a wallet extension for signing, then overwrite once the wallet
 * returns its own signed XDR.
 */
export function createMultiSigSplit(
  baseXdr: string,
  signer: NetworkSyncMultiSigSigner
): NetworkSyncMultiSigSplit {
  if (typeof baseXdr !== "string" || baseXdr.trim().length === 0) {
    throw new NetworkSyncMultiSigStructureError(
      "empty_xdr",
      "Multi-sig split cannot be created from an empty XDR."
    );
  }
  if (
    !signer ||
    typeof signer.publicKey !== "string" ||
    signer.publicKey.length === 0 ||
    typeof signer.hint !== "string" ||
    signer.hint.length === 0
  ) {
    throw new NetworkSyncMultiSigStructureError(
      "malformed_envelope",
      "Multi-sig split requires both a non-empty publicKey and a non-empty hint."
    );
  }
  return {
    baseXdr: baseXdr.trim(),
    signer: { publicKey: signer.publicKey, hint: signer.hint },
    signedXdr: baseXdr.trim(),
  };
}

/**
 * Records the wallet-signed XDR onto a {@link NetworkSyncMultiSigSplit}'s
 * `signedXdr` slot. Mutates the supplied split in place and returns the
 * same reference so call sites can chain further updates.
 */
export function applyMultiSigSignature(
  split: NetworkSyncMultiSigSplit,
  signedXdr: string
): NetworkSyncMultiSigSplit {
  if (typeof signedXdr !== "string" || signedXdr.trim().length === 0) {
    throw new NetworkSyncMultiSigStructureError(
      "empty_xdr",
      "Multi-sig split signed XDR is empty."
    );
  }
  split.signedXdr = signedXdr.trim();
  return split;
}

/**
 * Projects a {@link NetworkSyncMultiSigSplit} into a
 * {@link NetworkSyncSignRequest} so existing single-signer helpers such as
 * {@link signWithTimeout} and {@link runNetworkSyncSign} can sign the slice
 * without a wallet-specific adapter.
 */
export function toNetworkSyncSignRequest(
  split: NetworkSyncMultiSigSplit
): NetworkSyncSignRequest {
  return { xdr: split.baseXdr, payload: null };
}

/**
 * Builds a deterministic key for a signer so duplicate detection does not
 * depend on object identity.
 */
function signerKey(signer: NetworkSyncMultiSigSigner): string {
  return `${signer.publicKey}:${signer.hint ?? ""}`;
}

/**
 * Tolerant reducer over a list of splits: counts unique signers and
 * surfaces any duplicates (matched on `publicKey` + `hint`). Silently
 * skips splits whose `signer.publicKey` is empty — this is the count-only
 * preview; strict structural checks are performed by
 * {@link validateMultiSigAssembly} which always runs first.
 */
export function simulateMultiSigAssembly(
  splits: NetworkSyncMultiSigSplit[]
): { uniqueSigners: number; duplicates: NetworkSyncMultiSigSigner[] } {
  const seen = new Set<string>();
  const duplicates: NetworkSyncMultiSigSigner[] = [];
  for (const split of splits ?? []) {
    if (!split?.signer?.publicKey) continue;
    const key = signerKey(split.signer);
    if (seen.has(key)) {
      duplicates.push({
        publicKey: split.signer.publicKey,
        hint: split.signer.hint ?? "",
      });
    } else {
      seen.add(key);
    }
  }
  return { uniqueSigners: seen.size, duplicates };
}

/** Summary returned by {@link validateMultiSigAssembly} on success. */
export interface NetworkSyncMultiSigAssemblyResult {
  uniqueSigners: number;
  splitsValidated: number;
}

/**
 * Validates a collection of multi-sig splits as a coherent assembly. Every
 * split's baseXDR is parsed, duplicate signers are flagged, and the unique
 * signer count is compared against {@link DEFAULT_MULTISIG_MIN_SIGNATURES}
 * (or the caller-supplied {@link NetworkSyncMultiSigAssemblyOptions.minRequired}).
 */
export function validateMultiSigAssembly(
  splits: NetworkSyncMultiSigSplit[],
  options: NetworkSyncMultiSigAssemblyOptions = {}
): NetworkSyncMultiSigAssemblyResult {
  const min = options.minRequired ?? DEFAULT_MULTISIG_MIN_SIGNATURES;
  const safeSplits = Array.isArray(splits) ? splits : [];
  for (const split of safeSplits) {
    parseMultiSigEnvelope(split.baseXdr, options.parseOptions ?? {});
  }
  const sim = simulateMultiSigAssembly(safeSplits);
  if (sim.duplicates.length > 0) {
    throw new NetworkSyncMultiSigStructureError(
      "duplicate_signer",
      `Multi-sig assembly contains duplicate signer(s): ${sim.duplicates
        .map((s) => s.publicKey)
        .join(", ")}.`
    );
  }
  if (sim.uniqueSigners < min) {
    throw new NetworkSyncMultiSigStructureError(
      "insufficient_signatures",
      `Multi-sig assembly has ${sim.uniqueSigners} unique signature(s); minimum required is ${min}.`
    );
  }
  return {
    uniqueSigners: sim.uniqueSigners,
    splitsValidated: safeSplits.length,
  };
}
