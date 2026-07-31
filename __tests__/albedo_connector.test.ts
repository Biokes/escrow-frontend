import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  albedoTracker,
  AlbedoFeeExceededError,
  AlbedoSimulationError,
  AlbedoTransactionTracker,
  checkAlbedoFeeWarning,
  DEFAULT_FEE_LIMIT_STROOPS,
  extractEstimatedFee,
  formatConsoleWarningBlock,
  formatStackTrace,
  logAlbedoWarning,
  warnOnAlbedoFeeExceeded,
} from "@/app/lib/albedo_connector";

// ---------------------------------------------------------------------------
// Console warning block machinery
// ---------------------------------------------------------------------------

describe("albedo_connector console warning blocks", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    albedoTracker.clear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("formats stack traces from Error instances", () => {
    const err = new Error("albedo sign failed");
    const stack = formatStackTrace(err);

    expect(stack).toContain("Error: albedo sign failed");
    expect(stack).toMatch(/at /);
  });

  it("synthesizes a stack when no Error is provided", () => {
    const stack = formatStackTrace();
    expect(stack).toContain("Error:");
    expect(stack.split("\n").length).toBeGreaterThan(1);
  });

  it("synthesizes a stack from a plain string message", () => {
    const stack = formatStackTrace("something went wrong");
    expect(stack).toContain("something went wrong");
  });

  it("returns multi-line strings directly as stack traces", () => {
    const multiLine = "Error: custom\n  at foo (bar.ts:1:1)";
    const stack = formatStackTrace(multiLine);
    expect(stack).toBe(multiLine);
  });

  it("builds a console warning block with the albedo prefix and box", () => {
    const stack = formatStackTrace(new Error("fee debug"));
    const block = formatConsoleWarningBlock({
      title: "HIGH FEE WARNING",
      body: "Estimated fee exceeds limit",
      stack,
      txId: "tx-albedo-1",
      phase: "simulating",
    });

    expect(block).toContain("[albedo_connector]");
    expect(block).toContain("HIGH FEE WARNING");
    expect(block).toContain("Estimated fee exceeds limit");
    expect(block).toContain("txId: tx-albedo-1");
    expect(block).toContain("phase: simulating");
    expect(block).toContain("--- stack trace ---");
    expect(block).toContain("--- end stack ---");
    expect(block).toContain("Error: fee debug");
  });

  it("omits txId and phase lines when not provided", () => {
    const block = formatConsoleWarningBlock({
      title: "WARN",
      body: "body text",
      stack: formatStackTrace(),
    });

    expect(block).not.toContain("txId:");
    expect(block).not.toContain("phase:");
  });

  it("logs formatted warning blocks via console.warn", () => {
    const formatted = logAlbedoWarning("TX ERROR", "Submission failed", {
      err: new Error("network down"),
      txId: "tx-2",
      phase: "error",
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(formatted);
    expect(formatted).toMatch(/--- stack trace ---[\s\S]*Error: network down/);
  });

  it("tracks transaction phases and logs a warning block per phase", () => {
    const tracker = new AlbedoTransactionTracker();

    tracker.track("tx-10", "building", "Preparing XDR");
    tracker.track("tx-10", "simulating", "Running fee simulation");
    tracker.track(
      "tx-10",
      "error",
      "Albedo popup closed",
      new Error("popup closed")
    );

    const history = tracker.getHistory("tx-10");
    expect(history).toHaveLength(3);
    expect(history.map((e) => e.phase)).toEqual([
      "building",
      "simulating",
      "error",
    ]);
    expect(history[2].stack).toContain("Error: popup closed");
    expect(warnSpy).toHaveBeenCalledTimes(3);

    const lastCall = String(warnSpy.mock.calls[2][0]);
    expect(lastCall).toContain("[albedo_connector]");
    expect(lastCall).toContain("TX ERROR");
    expect(lastCall).toContain("--- stack trace ---");
  });

  it("isolates history by txId", () => {
    const tracker = new AlbedoTransactionTracker();
    tracker.track("a", "idle", "start");
    tracker.track("b", "success", "done");

    expect(tracker.getHistory("a")).toHaveLength(1);
    expect(tracker.getHistory("b")).toHaveLength(1);
    expect(tracker.getHistory()).toHaveLength(2);
  });

  it("clears all tracking state", () => {
    const tracker = new AlbedoTransactionTracker();
    tracker.track("a", "idle", "start");
    tracker.clear();
    expect(tracker.getHistory()).toHaveLength(0);
  });

  it("module-level albedoTracker is cleared between tests", () => {
    albedoTracker.track("x", "signing", "sign prompt");
    albedoTracker.clear();
    expect(albedoTracker.getHistory()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fee / gas estimation inspection
// ---------------------------------------------------------------------------

describe("albedo_connector fee inspection — extractEstimatedFee", () => {
  it("extracts minResourceFee as a number", () => {
    expect(extractEstimatedFee({ minResourceFee: 500_000 })).toBe(500_000);
  });

  it("extracts minResourceFee as a string", () => {
    expect(extractEstimatedFee({ minResourceFee: "750000" })).toBe(750_000);
  });

  it("falls back to fee when minResourceFee is absent", () => {
    expect(extractEstimatedFee({ fee: "100" })).toBe(100);
  });

  it("prefers minResourceFee over fee when both are present", () => {
    expect(extractEstimatedFee({ minResourceFee: 200, fee: "999" })).toBe(200);
  });

  it("returns 0 when neither field is present", () => {
    expect(extractEstimatedFee({})).toBe(0);
  });

  it("returns 0 for non-finite values", () => {
    expect(extractEstimatedFee({ minResourceFee: "NaN" })).toBe(0);
    expect(extractEstimatedFee({ fee: "Infinity" })).toBe(0);
  });
});

describe("albedo_connector fee inspection — checkAlbedoFeeWarning", () => {
  it("reports no warning when fee is within the default limit", () => {
    const state = checkAlbedoFeeWarning({ minResourceFee: 500_000 });

    expect(state.exceeded).toBe(false);
    expect(state.warningMessage).toBeNull();
    expect(state.estimatedFeeStroops).toBe(500_000);
    expect(state.feeLimitStroops).toBe(DEFAULT_FEE_LIMIT_STROOPS);
  });

  it("reports no warning when fee exactly equals the limit", () => {
    const state = checkAlbedoFeeWarning({
      minResourceFee: DEFAULT_FEE_LIMIT_STROOPS,
    });
    expect(state.exceeded).toBe(false);
    expect(state.warningMessage).toBeNull();
  });

  it("triggers a warning when fee exceeds the default limit by 1 stroop", () => {
    const state = checkAlbedoFeeWarning({
      minResourceFee: DEFAULT_FEE_LIMIT_STROOPS + 1,
    });

    expect(state.exceeded).toBe(true);
    expect(state.estimatedFeeStroops).toBe(DEFAULT_FEE_LIMIT_STROOPS + 1);
    expect(state.warningMessage).toMatch(/High fee detected/i);
    expect(state.warningMessage).toMatch(/XLM/);
    expect(state.warningMessage).toMatch(/stroops/);
  });

  it("triggers a warning for a substantially high fee", () => {
    const state = checkAlbedoFeeWarning({ minResourceFee: 5_000_000 });

    expect(state.exceeded).toBe(true);
    expect(state.warningMessage).toMatch(/5000000 stroops/);
    expect(state.warningMessage).toMatch(/Review the transaction/i);
  });

  it("uses a custom fee limit when provided", () => {
    const customLimit = 250_000;
    const stateUnder = checkAlbedoFeeWarning(
      { minResourceFee: 200_000 },
      customLimit
    );
    const stateOver = checkAlbedoFeeWarning(
      { minResourceFee: 300_000 },
      customLimit
    );

    expect(stateUnder.exceeded).toBe(false);
    expect(stateOver.exceeded).toBe(true);
    expect(stateOver.feeLimitStroops).toBe(customLimit);
  });

  it("falls back to fee field when minResourceFee is absent", () => {
    const state = checkAlbedoFeeWarning({
      fee: String(DEFAULT_FEE_LIMIT_STROOPS + 100),
    });
    expect(state.exceeded).toBe(true);
    expect(state.estimatedFeeStroops).toBe(DEFAULT_FEE_LIMIT_STROOPS + 100);
  });

  it("treats a simulation with no fee data as 0 stroops (no warning)", () => {
    const state = checkAlbedoFeeWarning({});
    expect(state.exceeded).toBe(false);
    expect(state.estimatedFeeStroops).toBe(0);
    expect(state.warningMessage).toBeNull();
  });
});

describe("albedo_connector fee inspection — warnOnAlbedoFeeExceeded", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs a formatted warning block when fee exceeds limit", () => {
    const state = warnOnAlbedoFeeExceeded({
      minResourceFee: DEFAULT_FEE_LIMIT_STROOPS + 500_000,
    });

    expect(state.exceeded).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[albedo_connector]");
    expect(logged).toContain("HIGH FEE WARNING");
    expect(logged).toContain("--- stack trace ---");
    expect(logged).toContain("AlbedoFeeExceededError");
  });

  it("does not log when fee is within limit", () => {
    const state = warnOnAlbedoFeeExceeded({ minResourceFee: 100_000 });

    expect(state.exceeded).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not log when simulation has no fee data", () => {
    const state = warnOnAlbedoFeeExceeded({});
    expect(state.exceeded).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("uses a custom limit and logs when exceeded", () => {
    const state = warnOnAlbedoFeeExceeded({ minResourceFee: 10_000 }, 5_000);
    expect(state.exceeded).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe("albedo_connector error classes", () => {
  it("AlbedoFeeExceededError carries fee metadata and correct name", () => {
    const err = new AlbedoFeeExceededError(2_000_000, 1_000_000);

    expect(err.name).toBe("AlbedoFeeExceededError");
    expect(err.estimatedFeeStroops).toBe(2_000_000);
    expect(err.feeLimitStroops).toBe(1_000_000);
    expect(err.message).toMatch(/Fee exceeded/i);
    expect(err.message).toContain("2000000");
    expect(err.message).toContain("1000000");
    expect(err instanceof Error).toBe(true);
  });

  it("AlbedoSimulationError has the correct name and message prefix", () => {
    const err = new AlbedoSimulationError("contract execution reverted");

    expect(err.name).toBe("AlbedoSimulationError");
    expect(err.message).toContain("Albedo simulation failed");
    expect(err.message).toContain("contract execution reverted");
    expect(err instanceof Error).toBe(true);
  });
});
