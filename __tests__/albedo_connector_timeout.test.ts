import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAlbedoSensitiveMemory,
  DEFAULT_ALBEDO_SIGNATURE_TIMEOUT_MS,
  AlbedoSignatureTimeoutError,
  signAlbedoWithTimeout,
  type AlbedoSignRequest,
} from "@/app/lib/albedo_connector";

describe("albedo_connector signature timeout bounds (#124)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the signature arrives before the timeout", async () => {
    const request: AlbedoSignRequest = {
      xdr: "AAAA...",
      payload: new Uint8Array([1, 2, 3, 4]),
    };

    const signFn = vi.fn(async () => "signed-xdr");

    const promise = signAlbedoWithTimeout(request, signFn, 5_000);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("signed-xdr");
    expect(request.payload).toBeNull();
  });

  it("forwards the XDR string from the request to the signFn", async () => {
    const request: AlbedoSignRequest = { xdr: "ALBEDO-XDR-PAYLOAD" };
    const signFn = vi.fn(async (xdr: string) => xdr);

    const promise = signAlbedoWithTimeout(request, signFn, 5_000);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(signFn).toHaveBeenCalledWith("ALBEDO-XDR-PAYLOAD");
    expect(result).toBe("ALBEDO-XDR-PAYLOAD");
  });

  it("aborts the operation and clears memory when the signature times out", async () => {
    const payload = new Uint8Array([9, 8, 7, 6]);
    const request: AlbedoSignRequest = {
      xdr: "AAAA...",
      payload,
    };

    const signFn = vi.fn(
      () =>
        new Promise<string>(() => {
          /* never resolves — simulates hung wallet / closed popup */
        })
    );

    const promise = signAlbedoWithTimeout(request, signFn, 1_000);
    const assertion = expect(promise).rejects.toBeInstanceOf(
      AlbedoSignatureTimeoutError
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(request.payload).toBeNull();
    expect(payload.every((byte) => byte === 0)).toBe(true);
  });

  it("terminates the operation (rejects) and clears memory on timeout", async () => {
    const request: AlbedoSignRequest = { xdr: "BBBB...", payload: null };
    const signFn = vi.fn(() => new Promise<string>(() => {}));

    const promise = signAlbedoWithTimeout(request, signFn, 500);
    const assertion = expect(promise).rejects.toThrow("500ms");

    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("does not fire the timeout before the deadline", async () => {
    const request: AlbedoSignRequest = { xdr: "FFFF..." };

    const signFn = vi.fn(
      () =>
        new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 500))
    );

    const promise = signAlbedoWithTimeout(request, signFn, 1_000);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
  });

  it("cancels the pending timeout timer after a successful resolution", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const request: AlbedoSignRequest = { xdr: "GGGG..." };
    const signFn = vi.fn(async () => "done");

    const promise = signAlbedoWithTimeout(request, signFn, 5_000);
    await vi.runAllTimersAsync();
    await promise;

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("re-throws non-timeout errors from the sign function", async () => {
    const request: AlbedoSignRequest = { xdr: "IIII..." };
    const signFn = vi.fn(async () => {
      throw new Error("popup blocked");
    });

    const promise = signAlbedoWithTimeout(request, signFn, 5_000);
    const assertion = expect(promise).rejects.toThrow("popup blocked");

    await vi.runAllTimersAsync();
    await assertion;
  });

  it("uses the default signature timeout bound", () => {
    expect(DEFAULT_ALBEDO_SIGNATURE_TIMEOUT_MS).toBe(60_000);
  });

  it("clearAlbedoSensitiveMemory zeroes buffers and nulls the reference", () => {
    const payload = new Uint8Array([1, 1, 1]);
    const request: AlbedoSignRequest = { xdr: "x", payload };
    clearAlbedoSensitiveMemory(request);
    expect(payload.every((b) => b === 0)).toBe(true);
    expect(request.payload).toBeNull();
  });

  it("clearAlbedoSensitiveMemory handles a null/undefined payload without throwing", () => {
    const request: AlbedoSignRequest = { xdr: "x", payload: null };
    expect(() => clearAlbedoSensitiveMemory(request)).not.toThrow();
    expect(request.payload).toBeNull();
  });

  it("AlbedoSignatureTimeoutError has the correct name and message", () => {
    const err = new AlbedoSignatureTimeoutError(3_000);
    expect(err.name).toBe("AlbedoSignatureTimeoutError");
    expect(err.message).toContain("3000ms");
    expect(err).toBeInstanceOf(Error);
  });
});
