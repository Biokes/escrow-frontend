/**
 * Albedo popup wallet helper interface — formats console warnings, tracks
 * transaction lifecycle, and inspects simulation fee results to surface
 * gas estimation warning banners to the user.
 */

export type AlbedoTxPhase =
  | "idle"
  | "building"
  | "simulating"
  | "signing"
  | "submitting"
  | "success"
  | "error";

export interface AlbedoTxTrackEntry {
  txId: string;
  phase: AlbedoTxPhase;
  message: string;
  timestamp: number;
  stack?: string;
}

export interface AlbedoConsoleWarningBlock {
  title: string;
  body: string;
  stack: string;
  txId?: string;
  phase?: AlbedoTxPhase;
}

// ---------------------------------------------------------------------------
// Simulation / fee inspection types
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a Soroban simulation result that albedo_connector
 * understands for fee inspection. The full SDK type is structurally
 * compatible — pass it directly.
 */
export interface AlbedoSimulationResult {
  /** Estimated resource fee in stroops (string or number). */
  minResourceFee?: string | number;
  /** Classic base fee in stroops (string or number). */
  fee?: string | number;
  /** Present when simulation itself failed. */
  error?: string;
  /** Soroban error message embedded inside a failed simulation. */
  result?: { error?: string };
}

export interface AlbedoFeeWarningState {
  /** True when the estimated fee exceeds the configured bound. */
  exceeded: boolean;
  /** Estimated fee in stroops (0 when simulation has no fee data). */
  estimatedFeeStroops: number;
  /** The bound that was checked against (in stroops). */
  feeLimitStroops: number;
  /** Human-readable warning or null when the fee is within bounds. */
  warningMessage: string | null;
}

/**
 * Default upper bound for acceptable Soroban transaction fees.
 * 0.01 XLM = 1_000_000 stroops.  Transactions estimated above this
 * threshold trigger the fee warning banner.
 */
export const DEFAULT_FEE_LIMIT_STROOPS = 1_000_000;

// ---------------------------------------------------------------------------
// Console warning block machinery (mirrors rabe_connector / ledger_usb_bridge)
// ---------------------------------------------------------------------------

const WARN_PREFIX = "[albedo_connector]";

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

/** Builds a multi-line console warning block for transaction debug tracking. */
export function formatConsoleWarningBlock(
  block: AlbedoConsoleWarningBlock
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
export function logAlbedoWarning(
  title: string,
  body: string,
  options?: { err?: unknown; txId?: string; phase?: AlbedoTxPhase }
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
// Transaction tracker
// ---------------------------------------------------------------------------

export class AlbedoTransactionTracker {
  private entries: AlbedoTxTrackEntry[] = [];

  track(
    txId: string,
    phase: AlbedoTxPhase,
    message: string,
    err?: unknown
  ): AlbedoTxTrackEntry {
    const entry: AlbedoTxTrackEntry = {
      txId,
      phase,
      message,
      timestamp: Date.now(),
      stack: formatStackTrace(err),
    };
    this.entries.push(entry);

    logAlbedoWarning(`TX ${phase.toUpperCase()}`, message, {
      err,
      txId,
      phase,
    });

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

// ---------------------------------------------------------------------------
// Fee / gas estimation inspection
// ---------------------------------------------------------------------------

/**
 * Extracts the total estimated fee in stroops from a simulation result.
 * Soroban transactions carry a `minResourceFee`; classic transactions use
 * `fee`.  Both are accepted so callers need not branch on transaction type.
 */
export function extractEstimatedFee(
  simulation: AlbedoSimulationResult
): number {
  const raw = simulation.minResourceFee ?? simulation.fee;
  if (raw === undefined || raw === null) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Inspects a simulation result and produces a fee warning state.
 * A warning is triggered whenever the estimated fee exceeds `feeLimitStroops`.
 *
 * @param simulation  - Simulation result from the Soroban RPC / SDK.
 * @param feeLimitStroops - Upper bound in stroops. Defaults to {@link DEFAULT_FEE_LIMIT_STROOPS}.
 */
export function checkAlbedoFeeWarning(
  simulation: AlbedoSimulationResult,
  feeLimitStroops: number = DEFAULT_FEE_LIMIT_STROOPS
): AlbedoFeeWarningState {
  const estimatedFeeStroops = extractEstimatedFee(simulation);
  const exceeded = estimatedFeeStroops > feeLimitStroops;

  const xlmFee = (estimatedFeeStroops / 10_000_000).toFixed(7);
  const xlmLimit = (feeLimitStroops / 10_000_000).toFixed(7);

  return {
    exceeded,
    estimatedFeeStroops,
    feeLimitStroops,
    warningMessage: exceeded
      ? `High fee detected: estimated ${xlmFee} XLM (${estimatedFeeStroops} stroops) exceeds the ${xlmLimit} XLM limit. Review the transaction before signing.`
      : null,
  };
}

/**
 * Runs a fee check and, when the fee is exceeded, emits a formatted console
 * warning block via the shared albedo_connector debug machinery.
 */
export function warnOnAlbedoFeeExceeded(
  simulation: AlbedoSimulationResult,
  feeLimitStroops: number = DEFAULT_FEE_LIMIT_STROOPS
): AlbedoFeeWarningState {
  const state = checkAlbedoFeeWarning(simulation, feeLimitStroops);
  if (state.exceeded && state.warningMessage) {
    logAlbedoWarning("HIGH FEE WARNING", state.warningMessage, {
      err: new AlbedoFeeExceededError(
        state.estimatedFeeStroops,
        state.feeLimitStroops
      ),
      phase: "simulating",
    });
  }
  return state;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class AlbedoFeeExceededError extends Error {
  constructor(
    public readonly estimatedFeeStroops: number,
    public readonly feeLimitStroops: number
  ) {
    super(
      `Fee exceeded: estimated ${estimatedFeeStroops} stroops exceeds limit of ${feeLimitStroops} stroops`
    );
    this.name = "AlbedoFeeExceededError";
  }
}

export class AlbedoSimulationError extends Error {
  constructor(message: string) {
    super(`Albedo simulation failed: ${message}`);
    this.name = "AlbedoSimulationError";
  }
}
