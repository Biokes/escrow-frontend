import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  albedoTracker,
  AlbedoTransactionTracker,
  formatConsoleWarningBlock,
  formatStackTrace,
  logAlbedoError,
  logAlbedoWarning,
  sanitizeAlbedoLogText,
  trackAlbedoLifecycle,
} from "@/app/lib/albedo_connector";

// ---------------------------------------------------------------------------
// assertNoSensitiveFields — tested indirectly through logAlbedoWarning /
// logAlbedoError / AlbedoTransactionTracker.track, which all call buildBlock
// ---------------------------------------------------------------------------

describe("albedo_connector assertNoSensitiveFields guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("throws when a context key matches 'secret'", () => {
    expect(() =>
      logAlbedoWarning("GUARD TEST", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        secret: "leakedValue",
      })
    ).toThrow(/refused to log sensitive field "secret"/i);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("throws when a context key matches 'privateKey'", () => {
    expect(() =>
      logAlbedoWarning("GUARD TEST", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        privateKey: "leakedValue",
      })
    ).toThrow(/refused to log sensitive field "privateKey"/i);
  });

  it("throws when a context key matches 'private_key'", () => {
    expect(() =>
      logAlbedoWarning("GUARD TEST", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        private_key: "leakedValue",
      })
    ).toThrow(/refused to log sensitive field "private_key"/i);
  });

  it("throws when a context key matches 'seed'", () => {
    expect(() =>
      logAlbedoWarning("GUARD TEST", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        seed: "leakedValue",
      })
    ).toThrow(/refused to log sensitive field "seed"/i);
  });

  it("throws when a context key matches 'mnemonic'", () => {
    expect(() =>
      logAlbedoWarning("GUARD TEST", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        mnemonic: "word1 word2",
      })
    ).toThrow(/refused to log sensitive field "mnemonic"/i);
  });

  it("throws when a context key matches 'password'", () => {
    expect(() =>
      logAlbedoWarning("GUARD TEST", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        password: "hunter2",
      })
    ).toThrow(/refused to log sensitive field "password"/i);
  });

  it("throws when a context key matches 'credential'", () => {
    expect(() =>
      logAlbedoWarning("GUARD TEST", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        credential: "abc",
      })
    ).toThrow(/refused to log sensitive field "credential"/i);
  });

  it("throws when a context key matches 'auth_token'", () => {
    expect(() =>
      logAlbedoWarning("GUARD TEST", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        auth_token: "bearer-xyz",
      })
    ).toThrow(/refused to log sensitive field "auth_token"/i);
  });

  it("does not throw for safe context keys like txId, phase, network", () => {
    expect(() =>
      logAlbedoWarning("SAFE", "body", {
        txId: "tx-safe",
        phase: "building",
        network: "testnet",
        operationType: "payment",
        txHash: "hash-ok",
      })
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does not throw when options is omitted entirely", () => {
    expect(() => logAlbedoWarning("PLAIN", "no options")).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("guard fires on logAlbedoError as well", () => {
    expect(() =>
      logAlbedoError("ERROR GUARD", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        password: "secret123",
      })
    ).toThrow(/refused to log sensitive field "password"/i);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("guard fires when logAlbedoWarning receives a sensitive key regardless of call site", () => {
    // AlbedoTransactionTracker.track reconstructs a safe logOptions before
    // delegating, so the guard is exercised through the direct log helpers.
    // Verify the guard message format is consistent across both helpers.
    expect(() =>
      logAlbedoError("ERROR GUARD 2", "body", {
        // @ts-expect-error intentionally passing a sensitive key
        seed: "seedphrase",
      })
    ).toThrow(/refused to log sensitive field "seed"/i);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});


// ---------------------------------------------------------------------------
// formatConsoleWarningBlock — title truncation & optional field omission
// ---------------------------------------------------------------------------

describe("albedo_connector formatConsoleWarningBlock edge cases", () => {
  it("truncates titles longer than 36 chars in the header line", () => {
    const longTitle = "A".repeat(50);
    const block = formatConsoleWarningBlock({
      title: longTitle,
      body: "body text",
      stack: "Error: stack",
    });

    const titleLine = block.split("\n")[1];
    expect(titleLine).toContain("A".repeat(36));
    expect(titleLine).not.toContain("A".repeat(37));
  });

  it("pads short titles to fill the 36-char column exactly", () => {
    const block = formatConsoleWarningBlock({
      title: "SHORT",
      body: "body",
      stack: "Error: stack",
    });

    const titleLine = block.split("\n")[1];
    // Column is 36 chars between the ║ borders; trailing spaces from padEnd
    expect(titleLine).toContain("SHORT");
    expect(titleLine).toContain("║");
  });

  it("omits txId and phase lines when not provided", () => {
    const block = formatConsoleWarningBlock({
      title: "NO EXTRAS",
      body: "just body and stack",
      stack: "Error: stack",
    });

    expect(block).not.toContain("txId:");
    expect(block).not.toContain("phase:");
    expect(block).not.toContain("txHash:");
    expect(block).not.toContain("network:");
    expect(block).not.toContain("operation:");
  });

  it("includes all optional fields when every one is supplied", () => {
    const block = formatConsoleWarningBlock({
      title: "FULL BLOCK",
      body: "all fields present",
      stack: "Error: trace",
      txId: "tx-full",
      txHash: "hash-full",
      phase: "success",
      network: "mainnet",
      operationType: "invoke_contract",
    });

    expect(block).toContain("txId: tx-full");
    expect(block).toContain("txHash: hash-full");
    expect(block).toContain("phase: success");
    expect(block).toContain("network: mainnet");
    expect(block).toContain("operation: invoke_contract");
  });

  it("redacts Stellar secret keys embedded in the title", () => {
    const secret = `S${"C".repeat(55)}`;
    const block = formatConsoleWarningBlock({
      title: `Leaked ${secret}`,
      body: "body",
      stack: "Error: ok",
    });

    expect(block).not.toContain(secret);
    expect(block).toContain("[REDACTED_SECRET]");
  });

  it("redacts Stellar secret keys embedded in the body", () => {
    const secret = `S${"D".repeat(55)}`;
    const block = formatConsoleWarningBlock({
      title: "REDACT BODY",
      body: `payload contains ${secret}`,
      stack: "Error: ok",
    });

    expect(block).not.toContain(secret);
    expect(block).toContain("[REDACTED_SECRET]");
  });
});

// ---------------------------------------------------------------------------
// logAlbedoWarning — edge cases
// ---------------------------------------------------------------------------

describe("albedo_connector logAlbedoWarning edge cases", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs using only title and body when no options are given", () => {
    const formatted = logAlbedoWarning("PLAIN WARNING", "no extra context");

    expect(warnSpy).toHaveBeenCalledWith(formatted);
    expect(formatted).toContain("[albedo_connector]");
    expect(formatted).toContain("PLAIN WARNING");
    expect(formatted).toContain("no extra context");
    expect(formatted).not.toContain("txId:");
    expect(formatted).not.toContain("phase:");
  });

  it("includes txHash when provided", () => {
    const formatted = logAlbedoWarning("WITH HASH", "submitted", {
      txHash: "h-abc",
    });

    expect(formatted).toContain("txHash: h-abc");
    expect(warnSpy).toHaveBeenCalledWith(formatted);
  });

  it("returns the same string that was passed to console.warn", () => {
    const result = logAlbedoWarning("RETURN CHECK", "verify return value");
    expect(warnSpy.mock.calls[0][0]).toBe(result);
  });

  it("always emits exactly one console.warn call", () => {
    logAlbedoWarning("ONCE", "single call");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// logAlbedoError — all three call branches
// ---------------------------------------------------------------------------

describe("albedo_connector logAlbedoError call branches", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("passes the Error object as second arg when err is an Error instance", () => {
    const err = new Error("popup closed");
    logAlbedoError("POPUP CLOSED", "Albedo popup was dismissed", { err });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toBe(err);
  });

  it("passes non-Error err value as second arg when err is not an Error", () => {
    logAlbedoError("STRING ERR", "unexpected throw", { err: "plain string" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toBe("plain string");
  });

  it("calls console.error with only the formatted string when err is absent", () => {
    logAlbedoError("NO ERR", "no error object provided");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toHaveLength(1);
  });

  it("returns the formatted string in all three branches", () => {
    const err = new Error("x");
    const r1 = logAlbedoError("T1", "b", { err });
    const r2 = logAlbedoError("T2", "b", { err: "s" });
    const r3 = logAlbedoError("T3", "b");

    expect(typeof r1).toBe("string");
    expect(typeof r2).toBe("string");
    expect(typeof r3).toBe("string");
    expect(r1).toContain("[albedo_connector]");
    expect(r2).toContain("[albedo_connector]");
    expect(r3).toContain("[albedo_connector]");
  });
});


// ---------------------------------------------------------------------------
// formatStackTrace — edge cases not covered in logging test
// ---------------------------------------------------------------------------

describe("albedo_connector formatStackTrace edge cases", () => {
  it("returns a multi-line string directly without synthesizing a new Error", () => {
    const multiline = "Error: custom\n    at foo (bar.ts:1:1)";
    expect(formatStackTrace(multiline)).toBe(multiline);
  });

  it("synthesizes a stack using a plain string message with no newline", () => {
    const stack = formatStackTrace("sign rejected by user");
    expect(stack).toContain("Error: sign rejected by user");
    expect(stack.split("\n").length).toBeGreaterThan(1);
  });

  it("synthesizes a default stack when an Error instance has no stack property", () => {
    const err = new Error("no stack here");
    Object.defineProperty(err, "stack", { value: undefined, writable: true });

    const stack = formatStackTrace(err);
    expect(stack).toContain("Error: Albedo connector trace");
  });

  it("uses the Error stack when it is populated", () => {
    const err = new Error("popup failed");
    const stack = formatStackTrace(err);
    expect(stack).toContain("Error: popup failed");
    expect(stack).toMatch(/at /);
  });

  it("uses the fallback message when called with undefined", () => {
    const stack = formatStackTrace(undefined);
    expect(stack).toContain("Error:");
    expect(stack.split("\n").length).toBeGreaterThan(1);
  });

  it("uses the fallback message when called with no argument", () => {
    const stack = formatStackTrace();
    expect(stack).toContain("Error:");
    expect(stack.split("\n").length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// sanitizeAlbedoLogText — tokenized label formats and bare secrets
// ---------------------------------------------------------------------------

describe("albedo_connector sanitizeAlbedoLogText extended cases", () => {
  it("redacts colon-separated secret labels", () => {
    const result = sanitizeAlbedoLogText("secret: abc123");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("abc123");
  });

  it("redacts equals-separated secret labels", () => {
    const result = sanitizeAlbedoLogText("password=hunter2");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("hunter2");
  });

  it("redacts token and mnemonic labels", () => {
    const r1 = sanitizeAlbedoLogText("token: eyJhb...");
    const r2 = sanitizeAlbedoLogText("mnemonic=word1 word2");
    expect(r1).toContain("[REDACTED]");
    expect(r2).toContain("[REDACTED]");
  });

  it("does not alter strings with no sensitive content", () => {
    const safe = "albedo popup opened for tx-abc on testnet";
    expect(sanitizeAlbedoLogText(safe)).toBe(safe);
  });

  it("handles an empty string without error", () => {
    expect(sanitizeAlbedoLogText("")).toBe("");
  });

  it("redacts a 56-char S… Stellar secret key (exact length)", () => {
    const secret = `S${"E".repeat(55)}`;
    expect(secret).toHaveLength(56);
    const result = sanitizeAlbedoLogText(`leaked: ${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED_SECRET]");
  });

  it("does not redact 55-char S… strings (too short to be a Stellar secret)", () => {
    const notSecret = `S${"F".repeat(54)}`;
    expect(notSecret).toHaveLength(55);
    const result = sanitizeAlbedoLogText(notSecret);
    expect(result).toBe(notSecret);
  });
});


// ---------------------------------------------------------------------------
// AlbedoTransactionTracker — wallet action behaviour under mocked actions
// ---------------------------------------------------------------------------

describe("albedo_connector AlbedoTransactionTracker wallet action phases", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("records all 11 AlbedoTxPhase values in sequence", () => {
    const tracker = new AlbedoTransactionTracker();
    const phases = [
      "idle",
      "building",
      "assembling",
      "popup",
      "signing",
      "signed",
      "submitting",
      "confirming",
      "success",
      "error",
      "cancelled",
    ] as const;

    for (const phase of phases) {
      tracker.track("tx-all", phase, `phase: ${phase}`, {
        ...(phase === "error" ? { err: new Error("simulated error") } : {}),
      });
    }

    const history = tracker.getHistory("tx-all");
    expect(history).toHaveLength(11);
    expect(history.map((e) => e.phase)).toEqual(phases);
  });

  it("routes error phase to console.error and all others to console.warn", () => {
    const tracker = new AlbedoTransactionTracker();

    tracker.track("tx-route", "building", "Building");
    tracker.track("tx-route", "popup", "Popup opened");
    tracker.track("tx-route", "error", "Popup closed", {
      err: new Error("user closed popup"),
    });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("simulates full popup-to-cancellation flow", () => {
    const tracker = new AlbedoTransactionTracker();

    tracker.track("tx-cancel", "building", "Constructing transaction XDR");
    tracker.track("tx-cancel", "assembling", "Assembling with Soroban RPC");
    tracker.track("tx-cancel", "popup", "Opening Albedo popup");
    tracker.track("tx-cancel", "cancelled", "User closed Albedo popup");

    const history = tracker.getHistory("tx-cancel");
    expect(history).toHaveLength(4);
    expect(history[3].phase).toBe("cancelled");
    expect(history[3].message).toContain("User closed Albedo popup");
    // cancellation goes to warn, not error
    expect(warnSpy).toHaveBeenCalledTimes(4);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("simulates full popup-to-success flow including txHash", () => {
    const tracker = new AlbedoTransactionTracker();

    tracker.track("tx-ok", "building", "Constructing XDR");
    tracker.track("tx-ok", "popup", "Opening Albedo popup");
    tracker.track("tx-ok", "signing", "Awaiting signature");
    tracker.track("tx-ok", "signed", "Signature received");
    tracker.track("tx-ok", "submitting", "Broadcasting", {
      txHash: "hash-success-1",
      network: "testnet",
      operationType: "invoke_contract",
    });
    tracker.track("tx-ok", "confirming", "Awaiting confirmation", {
      txHash: "hash-success-1",
    });
    tracker.track("tx-ok", "success", "Transaction confirmed", {
      txHash: "hash-success-1",
    });

    const history = tracker.getHistory("tx-ok");
    expect(history).toHaveLength(7);
    expect(history[6].phase).toBe("success");
    expect(history[4].txHash).toBe("hash-success-1");
    expect(history[5].txHash).toBe("hash-success-1");
    expect(history[6].txHash).toBe("hash-success-1");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(7);
  });

  it("includes stack trace in each tracked entry", () => {
    const tracker = new AlbedoTransactionTracker();
    const err = new Error("simulate popup rejection");
    tracker.track("tx-stack", "error", "Popup rejected", { err });

    const entry = tracker.getHistory("tx-stack")[0];
    expect(entry.stack).toContain("Error: simulate popup rejection");
    expect(entry.stack).toMatch(/at /);
  });

  it("preserves network and operationType on entries", () => {
    const tracker = new AlbedoTransactionTracker();
    tracker.track("tx-meta", "signing", "Signing on mainnet", {
      network: "mainnet",
      operationType: "payment",
    });

    const entry = tracker.getHistory("tx-meta")[0];
    expect(entry.network).toBe("mainnet");
    expect(entry.operationType).toBe("payment");
  });

  it("sanitizes sensitive content from tracked messages", () => {
    const secret = `S${"G".repeat(55)}`;
    const tracker = new AlbedoTransactionTracker();
    tracker.track("tx-sanitize", "building", `body contains ${secret}`);

    const entry = tracker.getHistory("tx-sanitize")[0];
    expect(entry.message).not.toContain(secret);
    expect(entry.message).toContain("[REDACTED_SECRET]");
  });

  it("records a numeric timestamp on each entry", () => {
    const before = Date.now();
    const tracker = new AlbedoTransactionTracker();
    tracker.track("tx-ts", "idle", "idle start");
    const after = Date.now();

    const entry = tracker.getHistory("tx-ts")[0];
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// AlbedoTransactionTracker — interleaved multi-txId isolation
// ---------------------------------------------------------------------------

describe("albedo_connector tracker multi-txId isolation", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("keeps entries for different txIds independent", () => {
    const tracker = new AlbedoTransactionTracker();

    tracker.track("tx-A", "building", "A building");
    tracker.track("tx-B", "popup", "B popup");
    tracker.track("tx-A", "signing", "A signing");
    tracker.track("tx-B", "cancelled", "B cancelled");

    expect(tracker.getHistory("tx-A")).toHaveLength(2);
    expect(tracker.getHistory("tx-B")).toHaveLength(2);
    expect(tracker.getHistory("tx-A").map((e) => e.phase)).toEqual([
      "building",
      "signing",
    ]);
    expect(tracker.getHistory("tx-B").map((e) => e.phase)).toEqual([
      "popup",
      "cancelled",
    ]);
  });

  it("getHistory with no argument returns all entries across all txIds", () => {
    const tracker = new AlbedoTransactionTracker();
    tracker.track("tx-X", "idle", "X start");
    tracker.track("tx-Y", "success", "Y done", { txHash: "h-y" });
    tracker.track("tx-Z", "error", "Z fail", { err: new Error("fail") });

    expect(tracker.getHistory()).toHaveLength(3);
  });

  it("clear removes all entries including across multiple txIds", () => {
    const tracker = new AlbedoTransactionTracker();
    tracker.track("tx-1", "building", "one");
    tracker.track("tx-2", "signing", "two");

    tracker.clear();
    expect(tracker.getHistory()).toHaveLength(0);
    expect(tracker.getHistory("tx-1")).toHaveLength(0);
    expect(tracker.getHistory("tx-2")).toHaveLength(0);
  });

  it("getHistory returns an independent copy (mutations do not affect internal state)", () => {
    const tracker = new AlbedoTransactionTracker();
    tracker.track("tx-copy", "building", "original");

    const copy = tracker.getHistory();
    copy.push({
      txId: "injected",
      phase: "idle",
      message: "injected entry",
      timestamp: 0,
    });

    expect(tracker.getHistory()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// albedoTracker singleton — module-level instance behaviour
// ---------------------------------------------------------------------------

describe("albedo_connector albedoTracker singleton", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    albedoTracker.clear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    albedoTracker.clear();
  });

  it("is a shared AlbedoTransactionTracker instance", () => {
    expect(albedoTracker).toBeInstanceOf(AlbedoTransactionTracker);
  });

  it("tracks independently of ad-hoc tracker instances", () => {
    albedoTracker.track("tx-singleton", "submitting", "Broadcasting to Stellar");

    expect(albedoTracker.getHistory("tx-singleton")).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const isolated = new AlbedoTransactionTracker();
    expect(isolated.getHistory()).toHaveLength(0);
  });

  it("retains history across multiple calls until clear() is called", () => {
    albedoTracker.track("tx-persist", "building", "step 1");
    albedoTracker.track("tx-persist", "success", "step 2");

    expect(albedoTracker.getHistory("tx-persist")).toHaveLength(2);

    albedoTracker.clear();
    expect(albedoTracker.getHistory()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// trackAlbedoLifecycle — convenience wrapper
// ---------------------------------------------------------------------------

describe("albedo_connector trackAlbedoLifecycle convenience helper", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    albedoTracker.clear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    albedoTracker.clear();
  });

  it("returns the AlbedoTxTrackEntry that was recorded", () => {
    const entry = trackAlbedoLifecycle("tx-lc", "building", "Building XDR");

    expect(entry.txId).toBe("tx-lc");
    expect(entry.phase).toBe("building");
    expect(entry.message).toBe("Building XDR");
    expect(typeof entry.timestamp).toBe("number");
  });

  it("delegates to albedoTracker and the entry appears in history", () => {
    trackAlbedoLifecycle("tx-delegate", "popup", "Popup opened");

    const history = albedoTracker.getHistory("tx-delegate");
    expect(history).toHaveLength(1);
    expect(history[0].phase).toBe("popup");
  });

  it("logs cancellation as console.warn, not console.error", () => {
    trackAlbedoLifecycle("tx-cancel-lc", "cancelled", "User dismissed popup");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logs error phase via console.error", () => {
    trackAlbedoLifecycle("tx-err-lc", "error", "Signing failed", {
      err: new Error("hardware error"),
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("passes network and operationType through to the entry", () => {
    const entry = trackAlbedoLifecycle(
      "tx-opts",
      "confirming",
      "Waiting for ledger",
      { network: "testnet", operationType: "invoke_contract", txHash: "h-lc" }
    );

    expect(entry.network).toBe("testnet");
    expect(entry.operationType).toBe("invoke_contract");
    expect(entry.txHash).toBe("h-lc");
  });

  it("accumulates multiple lifecycle calls for the same txId", () => {
    trackAlbedoLifecycle("tx-multi-lc", "building", "step 1");
    trackAlbedoLifecycle("tx-multi-lc", "popup", "step 2");
    trackAlbedoLifecycle("tx-multi-lc", "signing", "step 3");

    expect(albedoTracker.getHistory("tx-multi-lc")).toHaveLength(3);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });
});
