import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FreighterUserRejectedError,
  isFreighterUserRejected,
  runFreighterSign,
} from "@/app/lib/freighter_connector";

describe("freighter_connector user rejection handling (#105)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("detects user rejected transaction exceptions", () => {
    expect(isFreighterUserRejected(new FreighterUserRejectedError())).toBe(true);
    expect(isFreighterUserRejected(new Error("user rejected transaction"))).toBe(
      true
    );
    expect(isFreighterUserRejected(new Error("User Declined the request"))).toBe(
      true
    );
    expect(isFreighterUserRejected(new Error("request rejected"))).toBe(true);
    expect(isFreighterUserRejected(new Error("denied by the user"))).toBe(true);
    expect(isFreighterUserRejected(new Error("rpc timeout"))).toBe(false);
  });

  it("catches rejection during sign and shows a warning toast", async () => {
    const showToast = vi.fn();

    const result = await runFreighterSign(async () => {
      throw new Error("user rejected transaction");
    }, showToast);

    expect(result).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      "Signature cancelled — you rejected the request in your wallet.",
      "warning"
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[freighter_connector]");
    expect(logged).toContain("signature rejected by user");
  });

  it("re-throws non-rejection errors without toasting", async () => {
    const showToast = vi.fn();

    await expect(
      runFreighterSign(async () => {
        throw new Error("horizon unreachable");
      }, showToast)
    ).rejects.toThrow("horizon unreachable");

    expect(showToast).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns the signed payload when the user approves", async () => {
    const showToast = vi.fn();
    const result = await runFreighterSign(async () => ({ hash: "abc123" }), showToast);

    expect(result).toEqual({ hash: "abc123" });
    expect(showToast).not.toHaveBeenCalled();
  });
});
