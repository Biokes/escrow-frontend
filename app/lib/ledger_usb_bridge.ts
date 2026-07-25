/**
 * Ledger USB bridge — hardware wallet transport helpers:
 * signature timeouts, rejection handling, and network mismatch checks.
 */

import {
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { ToastType } from "@/app/context/ToastContext";

export const DEFAULT_SIGNATURE_TIMEOUT_MS = 60_000;

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
    const result = await Promise.race([signFn(request.xdr), timeoutPromise]);
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

export interface LedgerMultiSigPart {
  signerPublicKey: string;
  signedXdr: string;
}

export interface LedgerTransactionStructure {
  sourceAccount: string;
  fee: string;
  operationCount: number;
  signatureCount: number;
}

export interface LedgerMultiSigAssemblyPlan {
  baseXdr: string;
  structure: LedgerTransactionStructure;
  pendingSigners: string[];
}

function readLedgerTransaction(
  transactionXdr: string,
  networkPassphrase: string
): Transaction {
  const envelope = TransactionBuilder.fromXDR(
    transactionXdr,
    networkPassphrase
  );
  if (envelope instanceof FeeBumpTransaction) {
    return envelope.innerTransaction;
  }
  return envelope as Transaction;
}

/** Parses a transaction envelope without mutating signing state. */
export function parseLedgerTransactionStructure(
  transactionXdr: string,
  networkPassphrase: string
): LedgerTransactionStructure {
  const tx = readLedgerTransaction(transactionXdr, networkPassphrase);
  return {
    sourceAccount: tx.source,
    fee: tx.fee,
    operationCount: tx.operations.length,
    signatureCount: tx.signatures.length,
  };
}

/** Validates that each partial signature envelope parses for the same network. */
export function validateMultiSigParts(
  parts: LedgerMultiSigPart[],
  networkPassphrase: string
): LedgerTransactionStructure[] {
  return parts.map((part) =>
    parseLedgerTransactionStructure(part.signedXdr, networkPassphrase)
  );
}

/**
 * Builds an assembly plan for co-signers that still need to sign the base XDR.
 */
export function createMultiSigAssemblyPlan(
  baseXdr: string,
  signerPublicKeys: string[],
  networkPassphrase: string
): LedgerMultiSigAssemblyPlan {
  const structure = parseLedgerTransactionStructure(
    baseXdr,
    networkPassphrase
  );
  return {
    baseXdr,
    structure,
    pendingSigners: [...signerPublicKeys],
  };
}

/**
 * Merges co-signer envelopes into a single multi-signature transaction XDR.
 */
export function assembleMultiSigTransaction(
  baseXdr: string,
  parts: LedgerMultiSigPart[],
  networkPassphrase: string
): string {
  validateMultiSigParts(parts, networkPassphrase);
  const merged = readLedgerTransaction(baseXdr, networkPassphrase);

  for (const part of parts) {
    const signed = readLedgerTransaction(part.signedXdr, networkPassphrase);
    for (const signature of signed.signatures) {
      const alreadyPresent = merged.signatures.some((existing) =>
        existing.signature().equals(signature.signature())
      );
      if (!alreadyPresent) {
        merged.signatures.push(signature);
      }
    }
  }

  return merged.toXDR();
}

/**
 * Splits a partially signed transaction into discrete signer parts for Ledger
 * co-signing workflows.
 */
export function splitMultiSigTransactionParts(
  signedXdr: string,
  signerPublicKeys: string[],
  networkPassphrase: string
): LedgerMultiSigPart[] {
  parseLedgerTransactionStructure(signedXdr, networkPassphrase);
  return signerPublicKeys.map((signerPublicKey) => ({
    signerPublicKey,
    signedXdr,
  }));
}
