import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkFreighterAvailability,
  detectFreighterExtension,
  FREIGHTER_INSTALL_URL,
  FREIGHTER_SETUP_INSTRUCTION,
  warnOnMissingFreighter,
} from "@/app/lib/freighter_connector";

describe("freighter_connector wallet availability (#103)", () => {
  afterEach(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["freighterApi"];
    delete w["freighter"];
  });

  it("detectFreighterExtension returns false when no wallet globals are present", () => {
    expect(detectFreighterExtension()).toBe(false);
  });

  it("detectFreighterExtension returns true when freighterApi is present", () => {
    (window as unknown as Record<string, unknown>)["freighterApi"] = {};
    expect(detectFreighterExtension()).toBe(true);
  });

  it("detectFreighterExtension returns true when freighter is present", () => {
    (window as unknown as Record<string, unknown>)["freighter"] = {};
    expect(detectFreighterExtension()).toBe(true);
  });

  it("honours an injected detector callback", () => {
    expect(detectFreighterExtension(() => true)).toBe(true);
    expect(detectFreighterExtension(() => false)).toBe(false);
  });

  it("checkFreighterAvailability returns setup instructions when wallet is missing", () => {
    const state = checkFreighterAvailability(() => false);
    expect(state.available).toBe(false);
    expect(state.status).toBe("unavailable");
    expect(state.setupInstruction).toBe(FREIGHTER_SETUP_INSTRUCTION);
    expect(state.warningMessage).toBe(FREIGHTER_SETUP_INSTRUCTION);
    expect(state.setupInstruction).toMatch(/install/i);
    expect(state.setupInstruction).toMatch(/refresh/i);
  });

  it("checkFreighterAvailability clears instructions when wallet is present", () => {
    const state = checkFreighterAvailability(() => true);
    expect(state.available).toBe(true);
    expect(state.status).toBe("available");
    expect(state.setupInstruction).toBeNull();
    expect(state.warningMessage).toBeNull();
  });

  it("checkFreighterAvailability returns error status when the detector throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = checkFreighterAvailability(() => {
      throw new Error("detector boom");
    });

    expect(state.available).toBe(false);
    expect(state.status).toBe("error");
    expect(state.setupInstruction).toBe(FREIGHTER_SETUP_INSTRUCTION);
    expect(state.warningMessage).toMatch(/Unable to verify wallet availability/i);
    expect(warnSpy).toHaveBeenCalled();
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[freighter_connector]");
    warnSpy.mockRestore();
  });

  it("FREIGHTER_SETUP_INSTRUCTION and FREIGHTER_INSTALL_URL are helpful fallbacks", () => {
    expect(FREIGHTER_SETUP_INSTRUCTION).toMatch(/freighter/i);
    expect(FREIGHTER_INSTALL_URL).toContain("freighter.app");
  });
});

describe("warnOnMissingFreighter (#103)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("shows a warning toast with setup instructions when wallet is missing", () => {
    const showToast = vi.fn();
    const state = warnOnMissingFreighter(showToast, () => false);

    expect(state.available).toBe(false);
    expect(showToast).toHaveBeenCalledWith(FREIGHTER_SETUP_INSTRUCTION, "warning");
  });

  it("does not toast when the wallet is available", () => {
    const showToast = vi.fn();
    const state = warnOnMissingFreighter(showToast, () => true);

    expect(state.available).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("toasts when the availability check errors", () => {
    const showToast = vi.fn();
    const state = warnOnMissingFreighter(showToast, () => {
      throw new Error("boom");
    });

    expect(state.status).toBe("error");
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/Unable to verify wallet availability/i),
      "warning"
    );
  });
});
