import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSimulationFeeWarning,
  formatConsoleWarningBlock,
  formatStackTrace,
  FreighterTransactionTracker,
  freighterTracker,
  HIGH_FEE_THRESHOLD_STROOPS,
  logFreighterWarning,
  warnOnSimulationFee,
  type FreighterSimulationResult,
} from "@/app/lib/freighter_connector";

// ---------------------------------------------------------------------------
// #110 — gas estimation error warning banners
// ---------------------------------------------------------------------------

describe("freighter_connector gas estimation warnings (#110)", () => {
  it("returns no warning for a normal fee", () => {
    const result: FreighterSimulationResult = { fee: 100 };
    const state = checkSimulationFeeWarning(result);

    expect(state.hasWarning).toBe(false);
    expect(state.highFee).toBe(false);
    expect(state.simulationError).toBe(false);
    expect(state.warningMessage).toBeNull();
  });

  it("warns when fee exceeds the high-fee threshold", () => {
    const result: FreighterSimulationResult = {
      fee: HIGH_FEE_THRESHOLD_STROOPS + 1,
    };
    const state = checkSimulationFeeWarning(result);

    expect(state.hasWarning).toBe(true);
    expect(state.highFee).toBe(true);
    expect(state.simulationError).toBe(false);
    expect(state.warningMessage).toMatch(/unusually high/i);
    expect(state.warningMessage).toContain(String(HIGH_FEE_THRESHOLD_STROOPS + 1));
  });

  it("warns exactly at the threshold boundary (fee === threshold + 1)", () => {
    const state = checkSimulationFeeWarning({
      fee: HIGH_FEE_THRESHOLD_STROOPS + 1,
    });
    expect(state.highFee).toBe(true);
  });

  it("does not warn at exactly the threshold (fee === threshold)", () => {
    const state = checkSimulationFeeWarning({
      fee: HIGH_FEE_THRESHOLD_STROOPS,
    });
    expect(state.highFee).toBe(false);
    expect(state.hasWarning).toBe(false);
  });

  it("warns on simulation error string", () => {
    const result: FreighterSimulationResult = {
      fee: 100,
      error: "HostError: value out of range",
    };
    const state = checkSimulationFeeWarning(result);

    expect(state.hasWarning).toBe(true);
    expect(state.simulationError).toBe(true);
    expect(state.highFee).toBe(false);
    expect(state.warningMessage).toMatch(/simulation failed/i);
    expect(state.warningMessage).toContain("HostError: value out of range");
  });

  it("warns on simulationError object even when fee is normal", () => {
    const result: FreighterSimulationResult = {
      fee: 50,
      simulationError: { code: -1, message: "contract trap" },
    };
    const state = checkSimulationFeeWarning(result);

    expect(state.hasWarning).toBe(true);
    expect(state.simulationError).toBe(true);
    expect(state.warningMessage).toMatch(/simulation failed/i);
  });

  it("simulation error takes precedence over high fee", () => {
    const result: FreighterSimulationResult = {
      fee: HIGH_FEE_THRESHOLD_STROOPS + 999,
      error: "HostError",
    };
    const state = checkSimulationFeeWarning(result);

    // simulationError flag wins; highFee is not set
    expect(state.simulationError).toBe(true);
    expect(state.highFee).toBe(false);
  });

  it("includes XLM equivalent in the high-fee warning message", () => {
    const fee = 5_000_000; // 0.5 XLM
    const state = checkSimulationFeeWarning({ fee });

    expect(state.warningMessage).toContain("5000000");
    expect(state.warningMessage).toContain("XLM");
  });
});

// ---------------------------------------------------------------------------
// #110 — warnOnSimulationFee emits console warning block
// ---------------------------------------------------------------------------

describe("freighter_connector warnOnSimulationFee console output (#110)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs a HIGH FEE WARNING block via console.warn when fee is too high", () => {
    const state = warnOnSimulationFee(
      { fee: HIGH_FEE_THRESHOLD_STROOPS + 100 },
      { txId: "tx-fee-1" }
    );

    expect(state.hasWarning).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[freighter_connector]");
    expect(logged).toContain("HIGH FEE WARNING");
    expect(logged).toContain("--- stack trace ---");
    expect(logged).toContain("txId: tx-fee-1");
    expect(logged).toContain("phase: simulating");
  });

  it("logs a SIMULATION ERROR block via console.warn when simulation fails", () => {
    const state = warnOnSimulationFee(
      { fee: 0, error: "HostError: value out of range" },
      { txId: "tx-sim-err" }
    );

    expect(state.simulationError).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("SIMULATION ERROR");
    expect(logged).toContain("--- stack trace ---");
  });

  it("does not log when fee is within bounds and no simulation error", () => {
    warnOnSimulationFee({ fee: 200 });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #111 — console warning block format and stack trace logging
// ---------------------------------------------------------------------------

describe("freighter_connector console warning blocks (#111)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    freighterTracker.clear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("formats stack traces from Error instances", () => {
    const err = new Error("sign failed");
    const stack = formatStackTrace(err);

    expect(stack).toContain("Error: sign failed");
    expect(stack).toMatch(/at /);
  });

  it("synthesizes a stack when no Error is provided", () => {
    const stack = formatStackTrace();
    expect(stack).toContain("Error:");
    expect(stack.split("\n").length).toBeGreaterThan(1);
  });

  it("uses a string message as the synthetic error description", () => {
    const stack = formatStackTrace("custom error text");
    expect(stack).toContain("custom error text");
  });

  it("builds a console warning block that includes the stack trace format", () => {
    const stack = formatStackTrace(new Error("tx debug"));
    const block = formatConsoleWarningBlock({
      title: "TX SIGNING",
      body: "Awaiting Freighter wallet signature",
      stack,
      txId: "tx-abc",
      phase: "signing",
    });

    expect(block).toContain("[freighter_connector]");
    expect(block).toContain("TX SIGNING");
    expect(block).toContain("Awaiting Freighter wallet signature");
    expect(block).toContain("txId: tx-abc");
    expect(block).toContain("phase: signing");
    expect(block).toContain("--- stack trace ---");
    expect(block).toContain("--- end stack ---");
    expect(block).toContain("Error: tx debug");
  });

  it("omits txId and phase lines when not supplied", () => {
    const block = formatConsoleWarningBlock({
      title: "WARN",
      body: "body text",
      stack: formatStackTrace(),
    });

    expect(block).not.toContain("txId:");
    expect(block).not.toContain("phase:");
  });

  it("logs formatted warning blocks (with stack) via console.warn", () => {
    const formatted = logFreighterWarning("TX ERROR", "Submission failed", {
      err: new Error("network down"),
      txId: "tx-1",
      phase: "error",
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(formatted);
    expect(formatted).toMatch(/--- stack trace ---[\s\S]*Error: network down/);
  });

  it("includes all six phase values in the block when provided", () => {
    const phases = [
      "idle",
      "building",
      "simulating",
      "signing",
      "submitting",
      "success",
      "error",
    ] as const;

    for (const phase of phases) {
      const block = formatConsoleWarningBlock({
        title: "PHASE TEST",
        body: "testing phase",
        stack: formatStackTrace(),
        phase,
      });
      expect(block).toContain(`phase: ${phase}`);
    }
  });

  it("tracks transaction phases and logs a warning block per phase", () => {
    const tracker = new FreighterTransactionTracker();

    tracker.track("tx-42", "building", "Preparing XDR");
    tracker.track("tx-42", "signing", "Prompting Freighter wallet");
    tracker.track(
      "tx-42",
      "error",
      "Wallet returned failure",
      new Error("device busy")
    );

    const history = tracker.getHistory("tx-42");
    expect(history).toHaveLength(3);
    expect(history.map((e) => e.phase)).toEqual([
      "building",
      "signing",
      "error",
    ]);
    expect(history[2].stack).toContain("Error: device busy");
    expect(warnSpy).toHaveBeenCalledTimes(3);

    const lastCall = String(warnSpy.mock.calls[2][0]);
    expect(lastCall).toContain("TX ERROR");
    expect(lastCall).toContain("--- stack trace ---");
  });

  it("isolates history by txId and clears tracking state", () => {
    const tracker = new FreighterTransactionTracker();
    tracker.track("a", "idle", "start");
    tracker.track("b", "success", "done");

    expect(tracker.getHistory("a")).toHaveLength(1);
    expect(tracker.getHistory()).toHaveLength(2);

    tracker.clear();
    expect(tracker.getHistory()).toHaveLength(0);
  });

  it("each track entry captures a timestamp and stack string", () => {
    const before = Date.now();
    const tracker = new FreighterTransactionTracker();
    const entry = tracker.track("tx-ts", "submitting", "sending to network");
    const after = Date.now();

    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
    expect(typeof entry.stack).toBe("string");
    expect(entry.stack!.length).toBeGreaterThan(0);
  });

  it("stores error stack when an Error is passed to track()", () => {
    const tracker = new FreighterTransactionTracker();
    const err = new Error("freighter offline");
    const entry = tracker.track("tx-err", "error", "signing failed", err);

    expect(entry.stack).toContain("Error: freighter offline");
  });

  it("the shared freighterTracker singleton accumulates entries across calls", () => {
    freighterTracker.track("shared-1", "building", "msg 1");
    freighterTracker.track("shared-1", "success", "msg 2");

    expect(freighterTracker.getHistory("shared-1")).toHaveLength(2);
  });
});
