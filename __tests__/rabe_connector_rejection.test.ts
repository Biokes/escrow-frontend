import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRabeUserRejected,
  RabeUserRejectedError,
  runRabeSign,
} from "@/app/lib/rabe_connector";

describe("rabe_connector user rejection handling (#135)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // isRabeUserRejected — detection predicate
  // -------------------------------------------------------------------------

  describe("isRabeUserRejected", () => {
    it("returns true for a first-class RabeUserRejectedError instance", () => {
      expect(isRabeUserRejected(new RabeUserRejectedError())).toBe(true);
    });

    it("returns true for 'user rejected transaction' message", () => {
      expect(isRabeUserRejected(new Error("user rejected transaction"))).toBe(
        true
      );
    });

    it("returns true for 'User Declined the request' (case-insensitive)", () => {
      expect(
        isRabeUserRejected(new Error("User Declined the request"))
      ).toBe(true);
    });

    it("returns true for 'request rejected' message", () => {
      expect(isRabeUserRejected(new Error("request rejected"))).toBe(true);
    });

    it("returns true for 'denied by the user' message", () => {
      expect(isRabeUserRejected(new Error("denied by the user"))).toBe(true);
    });

    it("returns false for an unrelated error message", () => {
      expect(isRabeUserRejected(new Error("rpc timeout"))).toBe(false);
    });

    it("returns false for a network error", () => {
      expect(isRabeUserRejected(new Error("horizon unreachable"))).toBe(false);
    });

    it("returns false for a plain string (non-Error)", () => {
      expect(isRabeUserRejected("user rejected")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isRabeUserRejected(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isRabeUserRejected(undefined)).toBe(false);
    });

    it("returns false for a number", () => {
      expect(isRabeUserRejected(42)).toBe(false);
    });

    it("performs case-insensitive matching on all phrases", () => {
      expect(isRabeUserRejected(new Error("USER REJECTED"))).toBe(true);
      expect(isRabeUserRejected(new Error("REQUEST REJECTED"))).toBe(true);
      expect(isRabeUserRejected(new Error("DENIED BY THE USER"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // RabeUserRejectedError class shape
  // -------------------------------------------------------------------------

  describe("RabeUserRejectedError", () => {
    it("has the correct error name", () => {
      const err = new RabeUserRejectedError();
      expect(err.name).toBe("RabeUserRejectedError");
    });

    it("uses the default message when none is supplied", () => {
      const err = new RabeUserRejectedError();
      expect(err.message).toBe("user rejected transaction");
    });

    it("accepts a custom message", () => {
      const err = new RabeUserRejectedError("custom rejection message");
      expect(err.message).toBe("custom rejection message");
    });

    it("is an instance of Error", () => {
      expect(new RabeUserRejectedError()).toBeInstanceOf(Error);
    });

    it("is detected by isRabeUserRejected even with a custom message", () => {
      expect(
        isRabeUserRejected(new RabeUserRejectedError("something custom"))
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // runRabeSign — happy path
  // -------------------------------------------------------------------------

  describe("runRabeSign — happy path", () => {
    it("returns the signed payload when the user approves", async () => {
      const showToast = vi.fn();
      const result = await runRabeSign(
        async () => ({ hash: "abc123" }),
        showToast
      );

      expect(result).toEqual({ hash: "abc123" });
      expect(showToast).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("returns a string result when the sign function resolves with a string", async () => {
      const showToast = vi.fn();
      const result = await runRabeSign(async () => "signed-xdr", showToast);

      expect(result).toBe("signed-xdr");
      expect(showToast).not.toHaveBeenCalled();
    });

    it("returns null only on rejection, not on success", async () => {
      const showToast = vi.fn();
      const result = await runRabeSign(async () => "ok", showToast);

      expect(result).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // runRabeSign — rejection handling
  // -------------------------------------------------------------------------

  describe("runRabeSign — rejection handling", () => {
    it("catches rejection and returns null", async () => {
      const showToast = vi.fn();
      const result = await runRabeSign(async () => {
        throw new Error("user rejected transaction");
      }, showToast);

      expect(result).toBeNull();
    });

    it("shows a warning toast with the cancellation message on rejection", async () => {
      const showToast = vi.fn();
      await runRabeSign(async () => {
        throw new Error("user rejected transaction");
      }, showToast);

      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith(
        "Signature cancelled — you rejected the request in your wallet.",
        "warning"
      );
    });

    it("toast type is always 'warning' on rejection", async () => {
      const showToast = vi.fn();
      await runRabeSign(async () => {
        throw new RabeUserRejectedError();
      }, showToast);

      expect(showToast.mock.calls[0][1]).toBe("warning");
    });

    it("logs a structured rabe_connector warning block on rejection", async () => {
      const showToast = vi.fn();
      await runRabeSign(async () => {
        throw new Error("user rejected transaction");
      }, showToast);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = String(warnSpy.mock.calls[0][0]);
      expect(logged).toContain("[rabe_connector]");
    });

    it("warning block contains 'SIGNATURE REJECTED' title", async () => {
      const showToast = vi.fn();
      await runRabeSign(async () => {
        throw new Error("user rejected transaction");
      }, showToast);

      const logged = String(warnSpy.mock.calls[0][0]);
      expect(logged).toContain("SIGNATURE REJECTED");
    });

    it("warning block contains the body message about rejection", async () => {
      const showToast = vi.fn();
      await runRabeSign(async () => {
        throw new Error("user rejected transaction");
      }, showToast);

      const logged = String(warnSpy.mock.calls[0][0]);
      expect(logged).toContain("signature rejected by user");
    });

    it("warning block contains a stack trace section", async () => {
      const showToast = vi.fn();
      await runRabeSign(async () => {
        throw new Error("user rejected transaction");
      }, showToast);

      const logged = String(warnSpy.mock.calls[0][0]);
      expect(logged).toContain("--- stack trace ---");
      expect(logged).toContain("--- end stack ---");
    });

    it("handles RabeUserRejectedError instance correctly", async () => {
      const showToast = vi.fn();
      const result = await runRabeSign(async () => {
        throw new RabeUserRejectedError();
      }, showToast);

      expect(result).toBeNull();
      expect(showToast).toHaveBeenCalledWith(
        "Signature cancelled — you rejected the request in your wallet.",
        "warning"
      );
    });

    it("handles 'user declined' phrase", async () => {
      const showToast = vi.fn();
      const result = await runRabeSign(async () => {
        throw new Error("User Declined the request");
      }, showToast);

      expect(result).toBeNull();
      expect(showToast).toHaveBeenCalledTimes(1);
    });

    it("handles 'request rejected' phrase", async () => {
      const showToast = vi.fn();
      const result = await runRabeSign(async () => {
        throw new Error("request rejected");
      }, showToast);

      expect(result).toBeNull();
      expect(showToast).toHaveBeenCalledTimes(1);
    });

    it("handles 'denied by the user' phrase", async () => {
      const showToast = vi.fn();
      const result = await runRabeSign(async () => {
        throw new Error("denied by the user");
      }, showToast);

      expect(result).toBeNull();
      expect(showToast).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // runRabeSign — non-rejection error propagation
  // -------------------------------------------------------------------------

  describe("runRabeSign — non-rejection errors", () => {
    it("re-throws non-rejection errors without toasting", async () => {
      const showToast = vi.fn();

      await expect(
        runRabeSign(async () => {
          throw new Error("horizon unreachable");
        }, showToast)
      ).rejects.toThrow("horizon unreachable");

      expect(showToast).not.toHaveBeenCalled();
    });

    it("does not log a warning for non-rejection errors", async () => {
      const showToast = vi.fn();

      await expect(
        runRabeSign(async () => {
          throw new Error("network failure");
        }, showToast)
      ).rejects.toThrow();

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("preserves the original error type when re-throwing", async () => {
      const showToast = vi.fn();
      const original = new TypeError("bad XDR format");

      await expect(
        runRabeSign(async () => {
          throw original;
        }, showToast)
      ).rejects.toBe(original);
    });
  });
});
