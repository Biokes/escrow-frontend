import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFreighterSensitiveMemory,
  DEFAULT_FREIGHTER_SIGNATURE_TIMEOUT_MS,
  FreighterSignatureTimeoutError,
  signFreighterWithTimeout,
  type FreighterSignRequest,
} from "@/app/lib/freighter_connector";

describe("freighter_connector signature timeout bounds (#104)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the signature arrives before the timeout", async () => {
    const request: FreighterSignRequest = {
      xdr: "AAAA...",
      payload: new Uint8Array([1, 2, 3, 4]),
    };

    const signFn = vi.fn(async () => "signed-xdr");

    const promise = signFreighterWithTimeout(request, signFn, 5_000);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("signed-xdr");
    expect(request.payload).toBeNull();
  });

  it("aborts the operation and clears memory when the signature times out", async () => {
    const payload = new Uint8Array([9, 8, 7, 6]);
    const request: FreighterSignRequest = {
      xdr: "AAAA...",
      payload,
    };

    const signFn = vi.fn(
      () =>
        new Promise<string>(() => {
          /* never resolves — simulates hung wallet */
        })
    );

    const promise = signFreighterWithTimeout(request, signFn, 1_000);
    const assertion = expect(promise).rejects.toBeInstanceOf(
      FreighterSignatureTimeoutError
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(request.payload).toBeNull();
    expect(payload.every((byte) => byte === 0)).toBe(true);
  });

  it("uses the default signature timeout bound", () => {
    expect(DEFAULT_FREIGHTER_SIGNATURE_TIMEOUT_MS).toBe(60_000);
  });

  it("clearFreighterSensitiveMemory zeroes buffers and nulls the reference", () => {
    const payload = new Uint8Array([1, 1, 1]);
    const request: FreighterSignRequest = { xdr: "x", payload };
    clearFreighterSensitiveMemory(request);
    expect(payload.every((b) => b === 0)).toBe(true);
    expect(request.payload).toBeNull();
  });
});
