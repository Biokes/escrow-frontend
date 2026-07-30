import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlbedoNetworkMismatchError,
  checkAlbedoNetworkMatch,
  warnOnAlbedoNetworkMismatch,
} from "@/app/lib/albedo_connector";

describe("albedo_connector checkAlbedoNetworkMatch (#126)", () => {
  it("reports no mismatch when wallet and app networks are the same", () => {
    const state = checkAlbedoNetworkMatch("testnet", "testnet");

    expect(state.mismatched).toBe(false);
    expect(state.warningMessage).toBeNull();
    expect(state.walletNetwork).toBe("testnet");
    expect(state.appNetwork).toBe("testnet");
  });

  it("reports a mismatch when the wallet is on mainnet and app expects testnet", () => {
    const state = checkAlbedoNetworkMatch("mainnet", "testnet");

    expect(state.mismatched).toBe(true);
    expect(state.warningMessage).toMatch(/Network mismatch/i);
    expect(state.warningMessage).toMatch(/Mainnet/);
    expect(state.warningMessage).toMatch(/Testnet/);
  });

  it("reports the inverse mismatch (wallet on testnet, app expects mainnet)", () => {
    const state = checkAlbedoNetworkMatch("testnet", "mainnet");

    expect(state.mismatched).toBe(true);
    expect(state.warningMessage).toMatch(/Testnet/);
    expect(state.warningMessage).toMatch(/Mainnet/);
  });
});

describe("AlbedoNetworkMismatchError (#126)", () => {
  it("carries the wallet and app networks and a descriptive message", () => {
    const err = new AlbedoNetworkMismatchError("mainnet", "testnet");
    expect(err.name).toBe("AlbedoNetworkMismatchError");
    expect(err.walletNetwork).toBe("mainnet");
    expect(err.appNetwork).toBe("testnet");
    expect(err.message).toContain("mainnet");
    expect(err.message).toContain("testnet");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("albedo_connector warnOnAlbedoNetworkMismatch (#126)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs a formatted warning block when networks mismatch", () => {
    const state = warnOnAlbedoNetworkMismatch("mainnet", "testnet");

    expect(state.mismatched).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain("[albedo_connector]");
    expect(logged).toContain("NETWORK MISMATCH");
    expect(logged).toContain("AlbedoNetworkMismatchError");
    expect(logged).toContain("--- stack trace ---");
  });

  it("does not log when networks match", () => {
    const state = warnOnAlbedoNetworkMismatch("testnet", "testnet");

    expect(state.mismatched).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
