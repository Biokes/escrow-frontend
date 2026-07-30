import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlbedoUserRejectedError,
  isAlbedoUserRejected,
  runAlbedoSign,
} from "@/app/lib/albedo_connector";

describe("albedo_connector user rejection handling (#125)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("detects user rejected transaction exceptions", () => {
    expect(isAlbedoUserRejected(new AlbedoUserRejectedError())).toBe(true);
    expect(isAlbedoUserRejected(new Error("user rejected transaction"))).toBe(
      true
    );
    expect(isAlbedoUserRejected(new Error("User Declined the request"))).toBe(
      true
    );
    expect(isAlbedoUserRejected(new Error("request rejected"))).toBe(true);
    expect(isAlbedoUserRejected(new Error("denied by the user"))).toBe(true);
    expect(isAlbedoUserRejected(new Error("Rejected by user"))).toBe(true);
    expect(isAlbedoUserRejected(new Error("popup was canceled by user"))).toBe(
      true
    );
    expect(isAlbedoUserRejected(new Error("rpc timeout"))).toBe(false);
    expect(isAlbedoUserRejected("not an error")).toBe(false);
  });

  it("catches rejection during sign and shows a clean warning toast", async () => {
    const showToast = vi.fn();

    const result = await runAlbedoSign(async () => {
      throw new Error("Rejected by user");
    }, showToast);

    expect(result).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      "Signature cancelled — you rejected the request in Albedo.",
      "warning"
    );
  });

  it("logs a formatted albedo_connector warning block for rejections", async () => {
    const showToast = vi.fn();

    await runAlbedoSign(async () => {
      throw new Error("user rejected transaction");
    }, showToast);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[albedo_connector]");
    expect(logged).toContain("--- stack trace ---");
  });

  it("re-throws non-rejection errors without toasting", async () => {
    const showToast = vi.fn();

    await expect(
      runAlbedoSign(async () => {
        throw new Error("horizon unreachable");
      }, showToast)
    ).rejects.toThrow("horizon unreachable");

    expect(showToast).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns the signed payload when the user approves", async () => {
    const showToast = vi.fn();
    const result = await runAlbedoSign(async () => ({ hash: "abc123" }), showToast);

    expect(result).toEqual({ hash: "abc123" });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("AlbedoUserRejectedError has the correct name and default message", () => {
    const err = new AlbedoUserRejectedError();
    expect(err.name).toBe("AlbedoUserRejectedError");
    expect(err.message).toBe("user rejected transaction");
    expect(err).toBeInstanceOf(Error);
  });
});
