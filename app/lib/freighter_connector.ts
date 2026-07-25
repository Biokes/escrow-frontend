/**
 * freighter_connector — Freighter browser wallet integration helpers:
 * gas/fee estimation warnings, console debug tracking, and transaction
 * lifecycle logging.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** Simulation / fee estimation result as returned by Soroban RPC. */
export interface FreighterSimulationResult {
  /** Estimated fee in stroops (1 XLM = 10 000 000 stroops). */
  fee: number;
  /** Optional error string from the simulation response. */
  error?: string;
  /** Raw simulation error object when the RPC reports a failure. */
  simulationError?: unknown;
}

export interface FreighterGasWarningState {
  /** True when any fee-related warning should be displayed. */
  hasWarning: boolean;
  /** True when the fee exceeds the HIGH_FEE_THRESHOLD_STROOPS ceiling. */
  highFee: boolean;
  /** True when the simulation itself reported an error. */
  simulationError: boolean;
  /** Human-readable warning message, or null when no warning applies. */
  warningMessage: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WARN_PREFIX = "[freighter_connector]";

/**
 * Fee ceiling above which a high-fee warning is emitted.
 * 1 000 000 stroops = 0.1 XLM — conservative upper bound for typical
 * Soroban contract invocations on Testnet / Mainnet.
 */
export const HIGH_FEE_THRESHOLD_STROOPS = 1_000_000;

// ---------------------------------------------------------------------------
// Stack trace helpers
// ---------------------------------------------------------------------------

/** Captures a normalized stack string from an error or the current call site. */
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

// ---------------------------------------------------------------------------
// Console warning block helpers
// ---------------------------------------------------------------------------

/** Builds a multi-line console warning block for transaction debug tracking. */
export function formatConsoleWarningBlock(
  block: FreighterConsoleWarningBlock
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

// ---------------------------------------------------------------------------
// Gas / fee estimation warning
// ---------------------------------------------------------------------------

/**
 * Inspects a simulation result and produces a user-facing warning state
 * when fee limits exceed standard bounds or the simulation reported an error.
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

/**
 * Inspects a simulation result and, when a warning applies, emits a
 * formatted console warning block with a stack trace via the shared
 * freighter_connector debug machinery.
 */
export function warnOnSimulationFee(
  result: FreighterSimulationResult,
  options?: { txId?: string }
): FreighterGasWarningState {
  const state = checkSimulationFeeWarning(result);

  if (state.hasWarning && state.warningMessage) {
    const title = state.simulationError ? "SIMULATION ERROR" : "HIGH FEE WARNING";
    logFreighterWarning(title, state.warningMessage, {
      err: new Error(state.warningMessage),
      txId: options?.txId,
      phase: "simulating",
    });
  }

  return state;
}

// ---------------------------------------------------------------------------
// Transaction tracker
// ---------------------------------------------------------------------------

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
