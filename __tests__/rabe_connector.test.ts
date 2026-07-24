import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatConsoleWarningBlock,
  formatStackTrace,
  logRabeWarning,
  RabeTransactionTracker,
  rabeTracker,
} from "@/app/lib/rabe_connector";

describe("rabe_connector console warning blocks", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    rabeTracker.clear();
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

  it("builds a console warning block that includes the stack trace format", () => {
    const stack = formatStackTrace(new Error("tx debug"));
    const block = formatConsoleWarningBlock({
      title: "TX SIGNING",
      body: "Awaiting wallet signature",
      stack,
      txId: "tx-abc",
      phase: "signing",
    });

    expect(block).toContain("[rabe_connector]");
    expect(block).toContain("TX SIGNING");
    expect(block).toContain("Awaiting wallet signature");
    expect(block).toContain("txId: tx-abc");
    expect(block).toContain("phase: signing");
    expect(block).toContain("--- stack trace ---");
    expect(block).toContain("--- end stack ---");
    expect(block).toContain("Error: tx debug");
  });

  it("logs formatted warning blocks (with stack) via console.warn", () => {
    const formatted = logRabeWarning("TX ERROR", "Submission failed", {
      err: new Error("network down"),
      txId: "tx-1",
      phase: "error",
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(formatted);
    expect(formatted).toMatch(/--- stack trace ---[\s\S]*Error: network down/);
  });

  it("tracks transaction phases and logs a warning block per phase", () => {
    const tracker = new RabeTransactionTracker();

    tracker.track("tx-42", "building", "Preparing XDR");
    tracker.track("tx-42", "signing", "Prompting Rabe wallet");
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
    const tracker = new RabeTransactionTracker();
    tracker.track("a", "idle", "start");
    tracker.track("b", "success", "done");

    expect(tracker.getHistory("a")).toHaveLength(1);
    expect(tracker.getHistory()).toHaveLength(2);

    tracker.clear();
    expect(tracker.getHistory()).toHaveLength(0);
  });
});
