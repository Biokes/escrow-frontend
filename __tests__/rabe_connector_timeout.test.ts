import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRabeSensitiveMemory,
  DEFAULT_RABE_SIGNATURE_TIMEOUT_MS,
  RabeSignatureTimeoutError,
  signRabeWithTimeout,
  type RabeSignRequest,
} from "@/app/lib/rabe_connector";

describe("rabe_connector signature timeout bounds (#134)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Happy-path: signature arrives before the clock fires
  // -------------------------------------------------------------------------

  it("resolves when the signature arrives before the timeout", async () => {
    const request: RabeSignRequest = {
      xdr: "AAAA...",
      payload: new Uint8Array([1, 2, 3, 4]),
    };

    const signFn = vi.fn(async () => "signed-xdr");

    const promise = signRabeWithTimeout(request, signFn, 5_000);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("signed-xdr");
  });

  it("clears sensitive payload memory after a successful signature", async () => {
    const payload = new Uint8Array([5, 6, 7, 8]);
    const request: RabeSignRequest = { xdr: "BBBB...", payload };

    const signFn = vi.fn(async () => "signed-xdr");

    const promise = signRabeWithTimeout(request, signFn, 5_000);
    await vi.runAllTimersAsync();
    await promise;

    expect(request.payload).toBeNull();
    expect(payload.every((byte) => byte === 0)).toBe(true);
  });

  it("forwards the XDR string from the request to the signFn", async () => {
    const request: RabeSignRequest = { xdr: "RABE-XDR-PAYLOAD" };
    const signFn = vi.fn(async (xdr: string) => xdr);

    const promise = signRabeWithTimeout(request, signFn, 5_000);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(signFn).toHaveBeenCalledWith("RABE-XDR-PAYLOAD");
    expect(result).toBe("RABE-XDR-PAYLOAD");
  });

  // -------------------------------------------------------------------------
  // Timeout: signature hangs past the deadline — memory cleared
  // -------------------------------------------------------------------------

  it("aborts the operation and clears memory when the signature times out", async () => {
    const payload = new Uint8Array([9, 8, 7, 6]);
    const request: RabeSignRequest = {
      xdr: "CCCC...",
      payload,
    };

    const signFn = vi.fn(
      () =>
        new Promise<string>(() => {
          /* never resolves — simulates hung wallet */
        })
    );

    const promise = signRabeWithTimeout(request, signFn, 1_000);
    const assertion = expect(promise).rejects.toBeInstanceOf(
      RabeSignatureTimeoutError
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(request.payload).toBeNull();
    expect(payload.every((byte) => byte === 0)).toBe(true);
  });

  it("nulls the payload reference and zeroes the buffer on timeout", async () => {
    const payload = new Uint8Array([1, 2, 3]);
    const request: RabeSignRequest = {
      xdr: "DDDD...",
      payload,
    };

    const signFn = vi.fn(() => new Promise<string>(() => {}));

    const promise = signRabeWithTimeout(request, signFn, 500);
    const assertion = expect(promise).rejects.toBeInstanceOf(
      RabeSignatureTimeoutError
    );

    await vi.advanceTimersByTimeAsync(500);
    await assertion;

    expect(request.payload).toBeNull();
    expect(payload.every((byte) => byte === 0)).toBe(true);
  });

  it("rejection error contains the timeout duration", async () => {
    const request: RabeSignRequest = { xdr: "EEEE...", payload: null };

    const signFn = vi.fn(() => new Promise<string>(() => {}));
    const promise = signRabeWithTimeout(request, signFn, 2_000);
    const assertion = expect(promise).rejects.toThrow("2000ms");

    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it("does not fire the timeout before the deadline", async () => {
    const request: RabeSignRequest = { xdr: "FFFF..." };

    // signFn resolves at 500 ms, timeout at 1000 ms — should resolve normally
    const signFn = vi.fn(
      () =>
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("ok"), 500)
        )
    );

    const promise = signRabeWithTimeout(request, signFn, 1_000);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
  });

  // -------------------------------------------------------------------------
  // Timer cleanup
  // -------------------------------------------------------------------------

  it("cancels the pending timeout timer after a successful resolution", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const request: RabeSignRequest = { xdr: "GGGG..." };
    const signFn = vi.fn(async () => "done");

    const promise = signRabeWithTimeout(request, signFn, 5_000);
    await vi.runAllTimersAsync();
    await promise;

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("cancels the pending timeout timer after a non-timeout rejection", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const request: RabeSignRequest = { xdr: "HHHH..." };
    const signFn = vi.fn(async () => {
      throw new Error("wallet error");
    });

    const promise = signRabeWithTimeout(request, signFn, 5_000);
    const assertion = expect(promise).rejects.toThrow("wallet error");

    await vi.runAllTimersAsync();
    await assertion;

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Non-timeout error propagation
  // -------------------------------------------------------------------------

  it("re-throws non-timeout errors from the sign function", async () => {
    const request: RabeSignRequest = { xdr: "IIII..." };
    const signFn = vi.fn(async () => {
      throw new Error("user rejected");
    });

    const promise = signRabeWithTimeout(request, signFn, 5_000);
    const assertion = expect(promise).rejects.toThrow("user rejected");

    await vi.runAllTimersAsync();
    await assertion;
  });

  it("non-timeout errors are not RabeSignatureTimeoutError", async () => {
    const request: RabeSignRequest = { xdr: "JJJJ..." };
    const signFn = vi.fn(async () => {
      throw new Error("device disconnected");
    });

    const promise = signRabeWithTimeout(request, signFn, 5_000);
    const assertion = expect(promise).rejects.not.toBeInstanceOf(
      RabeSignatureTimeoutError
    );

    await vi.runAllTimersAsync();
    await assertion;
  });

  // -------------------------------------------------------------------------
  // DEFAULT_RABE_SIGNATURE_TIMEOUT_MS constant
  // -------------------------------------------------------------------------

  it("DEFAULT_RABE_SIGNATURE_TIMEOUT_MS is 60 seconds", () => {
    expect(DEFAULT_RABE_SIGNATURE_TIMEOUT_MS).toBe(60_000);
  });

  // -------------------------------------------------------------------------
  // clearRabeSensitiveMemory helper
  // -------------------------------------------------------------------------

  it("clearRabeSensitiveMemory zeroes buffers and nulls the reference", () => {
    const payload = new Uint8Array([1, 1, 1]);
    const request: RabeSignRequest = { xdr: "x", payload };
    clearRabeSensitiveMemory(request);
    expect(payload.every((b) => b === 0)).toBe(true);
    expect(request.payload).toBeNull();
  });

  it("clearRabeSensitiveMemory handles a null payload without throwing", () => {
    const request: RabeSignRequest = { xdr: "x", payload: null };
    expect(() => clearRabeSensitiveMemory(request)).not.toThrow();
    expect(request.payload).toBeNull();
  });

  it("clearRabeSensitiveMemory handles an undefined payload without throwing", () => {
    const request: RabeSignRequest = { xdr: "x" };
    expect(() => clearRabeSensitiveMemory(request)).not.toThrow();
  });

  it("clearRabeSensitiveMemory returns the mutated request object", () => {
    const request: RabeSignRequest = {
      xdr: "x",
      payload: new Uint8Array([7]),
    };
    const returned = clearRabeSensitiveMemory(request);
    expect(returned).toBe(request);
  });

  it("clearRabeSensitiveMemory zeroes a larger buffer completely", () => {
    const payload = new Uint8Array(256).fill(0xff);
    const request: RabeSignRequest = { xdr: "x", payload };
    clearRabeSensitiveMemory(request);
    expect(payload.every((b) => b === 0)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // RabeSignatureTimeoutError class
  // -------------------------------------------------------------------------

  it("RabeSignatureTimeoutError has the correct name", () => {
    const err = new RabeSignatureTimeoutError(5_000);
    expect(err.name).toBe("RabeSignatureTimeoutError");
  });

  it("RabeSignatureTimeoutError message includes the timeout value", () => {
    const err = new RabeSignatureTimeoutError(3_000);
    expect(err.message).toContain("3000ms");
  });

  it("RabeSignatureTimeoutError is an instance of Error", () => {
    const err = new RabeSignatureTimeoutError(1_000);
    expect(err).toBeInstanceOf(Error);
  });

  // -------------------------------------------------------------------------
  // No payload on request
  // -------------------------------------------------------------------------

  it("resolves normally when the request has no payload field", async () => {
    const request: RabeSignRequest = { xdr: "KKKK..." };
    const signFn = vi.fn(async () => "result-no-payload");

    const promise = signRabeWithTimeout(request, signFn, 5_000);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("result-no-payload");
  });

  it("times out cleanly when the request has no payload", async () => {
    const request: RabeSignRequest = { xdr: "LLLL..." };
    const signFn = vi.fn(() => new Promise<string>(() => {}));

    const promise = signRabeWithTimeout(request, signFn, 500);
    const assertion = expect(promise).rejects.toBeInstanceOf(
      RabeSignatureTimeoutError
    );
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
});
