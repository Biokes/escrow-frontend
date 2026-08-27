import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectWalletExtensionById,
  checkWalletAvailabilityById,
  disconnectWalletWithCheck,
} from "@/app/lib/wallet_disconnect_handler";

// ---------------------------------------------------------------------------
// detectWalletExtensionById
// ---------------------------------------------------------------------------

describe("wallet_disconnect_handler detectWalletExtensionById (#task-4)", () => {
  afterEach(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["freighterApi"];
    delete w["freighter"];
    delete w["albedo"];
    delete w["albedoApi"];
    delete w["xBullSDK"];
    delete w["hanaWallet"];
    delete w["hana"];
  });

  it("returns false when no wallet globals are present for freighter", () => {
    expect(detectWalletExtensionById("freighter")).toBe(false);
  });

  it("returns true when freighterApi is present", () => {
    (window as unknown as Record<string, unknown>)["freighterApi"] = {};
    expect(detectWalletExtensionById("freighter")).toBe(true);
  });

  it("returns true when freighter is present", () => {
    (window as unknown as Record<string, unknown>)["freighter"] = {};
    expect(detectWalletExtensionById("freighter")).toBe(true);
  });

  it("returns false when no wallet globals are present for albedo", () => {
    expect(detectWalletExtensionById("albedo")).toBe(false);
  });

  it("returns true when albedo is present", () => {
    (window as unknown as Record<string, unknown>)["albedo"] = {};
    expect(detectWalletExtensionById("albedo")).toBe(true);
  });

  it("returns true when albedoApi is present", () => {
    (window as unknown as Record<string, unknown>)["albedoApi"] = {};
    expect(detectWalletExtensionById("albedo")).toBe(true);
  });

  it("returns false when no wallet globals are present for xbull", () => {
    expect(detectWalletExtensionById("xbull")).toBe(false);
  });

  it("returns true when xBullSDK is present", () => {
    (window as unknown as Record<string, unknown>)["xBullSDK"] = {};
    expect(detectWalletExtensionById("xbull")).toBe(true);
  });

  it("returns false when no wallet globals are present for hana", () => {
    expect(detectWalletExtensionById("hana")).toBe(false);
  });

  it("returns true when hanaWallet is present", () => {
    (window as unknown as Record<string, unknown>)["hanaWallet"] = {};
    expect(detectWalletExtensionById("hana")).toBe(true);
  });

  it("returns true when hana is present", () => {
    (window as unknown as Record<string, unknown>)["hana"] = {};
    expect(detectWalletExtensionById("hana")).toBe(true);
  });

  it("honours an injected detector callback returning true", () => {
    expect(detectWalletExtensionById("freighter", () => true)).toBe(true);
  });

  it("honours an injected detector callback returning false", () => {
    expect(detectWalletExtensionById("freighter", () => false)).toBe(false);
  });

  it("uses the detector callback even when wallet globals are present", () => {
    (window as unknown as Record<string, unknown>)["freighterApi"] = {};
    expect(detectWalletExtensionById("freighter", () => false)).toBe(false);
  });

  it("propagates the error when the detector throws", () => {
    expect(() =>
      detectWalletExtensionById("freighter", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });

  it("returns false for an unknown wallet ID", () => {
    expect(detectWalletExtensionById("unknown-wallet")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkWalletAvailabilityById
// ---------------------------------------------------------------------------

describe("wallet_disconnect_handler checkWalletAvailabilityById (#task-4)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns available=true when wallet is present (freighter)", () => {
    const result = checkWalletAvailabilityById("freighter", () => true);
    expect(result.available).toBe(true);
    expect(result.setupInstruction).toBeNull();
    expect(result.installUrl).toBeNull();
  });

  it("returns available=true when wallet is present (albedo)", () => {
    const result = checkWalletAvailabilityById("albedo", () => true);
    expect(result.available).toBe(true);
    expect(result.setupInstruction).toBeNull();
    expect(result.installUrl).toBeNull();
  });

  it("returns available=false with setup instructions when wallet is missing (freighter)", () => {
    const result = checkWalletAvailabilityById("freighter", () => false);
    expect(result.available).toBe(false);
    expect(result.setupInstruction).not.toBeNull();
    expect(result.setupInstruction).toMatch(/freighter/i);
    expect(result.setupInstruction).toMatch(/install/i);
    expect(result.setupInstruction).toMatch(/refresh/i);
    expect(result.installUrl).toContain("freighter.app");
  });

  it("returns available=false with setup instructions when wallet is missing (albedo)", () => {
    const result = checkWalletAvailabilityById("albedo", () => false);
    expect(result.available).toBe(false);
    expect(result.setupInstruction).toMatch(/albedo/i);
    expect(result.installUrl).toContain("albedo.link");
  });

  it("returns available=false with setup instructions when wallet is missing (xbull)", () => {
    const result = checkWalletAvailabilityById("xbull", () => false);
    expect(result.available).toBe(false);
    expect(result.setupInstruction).toMatch(/xbull/i);
  });

  it("returns available=false with setup instructions when wallet is missing (hana)", () => {
    const result = checkWalletAvailabilityById("hana", () => false);
    expect(result.available).toBe(false);
    expect(result.setupInstruction).toMatch(/hana/i);
  });

  it("returns fallback instructions for an unknown wallet ID", () => {
    const result = checkWalletAvailabilityById("unknown-wallet", () => false);
    expect(result.available).toBe(false);
    expect(result.setupInstruction).toMatch(/wallet extension not found/i);
    expect(result.installUrl).toBeNull();
  });

  it("returns error status with fallback messages when the detector throws", () => {
    const result = checkWalletAvailabilityById("freighter", () => {
      throw new Error("detector boom");
    });
    expect(result.available).toBe(false);
    expect(result.setupInstruction).not.toBeNull();
    expect(result.installUrl).toContain("freighter.app");
    expect(warnSpy).toHaveBeenCalled();
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[wallet_disconnect_handler]");
  });

  it("does not log when the wallet is available", () => {
    checkWalletAvailabilityById("freighter", () => true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not log when the wallet is simply missing (unavailable)", () => {
    checkWalletAvailabilityById("freighter", () => false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// disconnectWalletWithCheck
// ---------------------------------------------------------------------------

describe("wallet_disconnect_handler disconnectWalletWithCheck (#task-4)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns success=true when wallet is available and disconnect succeeds", async () => {
    const disconnectFn = vi.fn(async () => {});
    const result = await disconnectWalletWithCheck(
      "freighter",
      disconnectFn,
      () => true,
    );
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.fallbackInstructions).toBeNull();
    expect(result.installUrl).toBeNull();
    expect(disconnectFn).toHaveBeenCalled();
  });

  it("returns fallbackInstructions when wallet is not installed", async () => {
    const disconnectFn = vi.fn(async () => {});
    const result = await disconnectWalletWithCheck(
      "freighter",
      disconnectFn,
      () => false,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeNull();
    expect(result.fallbackInstructions).not.toBeNull();
    expect(result.fallbackInstructions).toMatch(/freighter/i);
    expect(result.fallbackInstructions).toMatch(/install/i);
    expect(result.installUrl).toContain("freighter.app");
    expect(disconnectFn).not.toHaveBeenCalled();
  });

  it("skips disconnect for albedo when not installed", async () => {
    const disconnectFn = vi.fn(async () => {});
    const result = await disconnectWalletWithCheck(
      "albedo",
      disconnectFn,
      () => false,
    );
    expect(result.success).toBe(false);
    expect(result.fallbackInstructions).toMatch(/albedo/i);
    expect(result.installUrl).toContain("albedo.link");
    expect(disconnectFn).not.toHaveBeenCalled();
  });

  it("skips disconnect for xbull when not installed", async () => {
    const disconnectFn = vi.fn(async () => {});
    const result = await disconnectWalletWithCheck(
      "xbull",
      disconnectFn,
      () => false,
    );
    expect(result.success).toBe(false);
    expect(result.fallbackInstructions).toMatch(/xbull/i);
    expect(disconnectFn).not.toHaveBeenCalled();
  });

  it("skips disconnect for hana when not installed", async () => {
    const disconnectFn = vi.fn(async () => {});
    const result = await disconnectWalletWithCheck(
      "hana",
      disconnectFn,
      () => false,
    );
    expect(result.success).toBe(false);
    expect(result.fallbackInstructions).toMatch(/hana/i);
    expect(disconnectFn).not.toHaveBeenCalled();
  });

  it("returns error when disconnect function throws", async () => {
    const disconnectFn = vi.fn(async () => {
      throw new Error("extension crashed");
    });
    const result = await disconnectWalletWithCheck(
      "freighter",
      disconnectFn,
      () => true,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("extension crashed");
    expect(result.fallbackInstructions).toBeNull();
    expect(result.installUrl).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[wallet_disconnect_handler]");
    expect(logged).toContain("DISCONNECT FAILED");
  });

  it("returns error with non-Error thrown value", async () => {
    const disconnectFn = vi.fn(async () => {
      throw "string error";
    });
    const result = await disconnectWalletWithCheck(
      "freighter",
      disconnectFn,
      () => true,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown error during wallet disconnect.");
  });

  it("logs a warning when wallet is not installed", async () => {
    const disconnectFn = vi.fn(async () => {});
    await disconnectWalletWithCheck("freighter", disconnectFn, () => false);
    expect(warnSpy).toHaveBeenCalled();
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[wallet_disconnect_handler]");
    expect(logged).toContain("not installed");
  });
});
