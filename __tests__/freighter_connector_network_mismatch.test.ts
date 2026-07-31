import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FreighterNetworkMismatchError,
  checkFreighterNetworkMatch,
  warnOnFreighterNetworkMismatch,
} from "@/app/lib/freighter_connector";

describe("freighter_connector checkFreighterNetworkMatch (#106)", () => {
  it("reports no mismatch when wallet and app networks are the same", () => {
    const state = checkFreighterNetworkMatch("testnet", "testnet");

    expect(state.mismatched).toBe(false);
    expect(state.warningMessage).toBeNull();
    expect(state.walletNetwork).toBe("testnet");
    expect(state.appNetwork).toBe("testnet");
  });

  it("reports a mismatch when the wallet is on mainnet and app expects testnet", () => {
    const state = checkFreighterNetworkMatch("mainnet", "testnet");

    expect(state.mismatched).toBe(true);
    expect(state.warningMessage).toMatch(/Network mismatch/i);
    expect(state.warningMessage).toMatch(/Mainnet/);
    expect(state.warningMessage).toMatch(/Testnet/);
  });

  it("reports the inverse mismatch (wallet on testnet, app expects mainnet)", () => {
    const state = checkFreighterNetworkMatch("testnet", "mainnet");

    expect(state.mismatched).toBe(true);
    expect(state.warningMessage).toMatch(/Testnet/);
    expect(state.warningMessage).toMatch(/Mainnet/);
  });
});

describe("FreighterNetworkMismatchError (#106)", () => {
  it("carries the wallet and app networks and a descriptive message", () => {
    const err = new FreighterNetworkMismatchError("mainnet", "testnet");
    expect(err.name).toBe("FreighterNetworkMismatchError");
    expect(err.walletNetwork).toBe("mainnet");
    expect(err.appNetwork).toBe("testnet");
    expect(err.message).toContain("mainnet");
    expect(err.message).toContain("testnet");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("freighter_connector warnOnFreighterNetworkMismatch (#106)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs a warning when networks mismatch", () => {
    const state = warnOnFreighterNetworkMismatch("mainnet", "testnet");

    expect(state.mismatched).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[freighter_connector]");
    expect(logged).toContain("Network mismatch");
  });

  it("does not log when networks match", () => {
    const state = warnOnFreighterNetworkMismatch("testnet", "testnet");

    expect(state.mismatched).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
