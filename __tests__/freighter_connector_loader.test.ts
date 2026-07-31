import { describe, expect, it, vi } from "vitest";
import {
  runFreighterSign,
  signFreighterWithTimeout,
  verifyAndRehydrateFreighterAddress,
  type FreighterSignRequest,
} from "@/app/lib/freighter_connector";
import { subscribeToWalletLoading } from "@/app/lib/wallet_state_context";

describe("freighter_connector loader overlay integration (#108)", () => {
  it("signFreighterWithTimeout toggles the shared wallet loader on execution start/end", async () => {
    const states: boolean[] = [];
    const unsubscribe = subscribeToWalletLoading((isLoading) =>
      states.push(isLoading)
    );

    const request: FreighterSignRequest = { xdr: "AAAA..." };
    const result = await signFreighterWithTimeout(
      request,
      async () => "signed-xdr",
      5_000
    );

    expect(result).toBe("signed-xdr");
    expect(states).toEqual([false, true, false]);
    unsubscribe();
  });

  it("signFreighterWithTimeout clears the loader even when the call rejects", async () => {
    const states: boolean[] = [];
    const unsubscribe = subscribeToWalletLoading((isLoading) =>
      states.push(isLoading)
    );

    const request: FreighterSignRequest = { xdr: "AAAA..." };
    await expect(
      signFreighterWithTimeout(
        request,
        async () => {
          throw new Error("boom");
        },
        5_000
      )
    ).rejects.toThrow("boom");

    expect(states).toEqual([false, true, false]);
    unsubscribe();
  });

  it("runFreighterSign toggles the shared wallet loader on execution start/end", async () => {
    const states: boolean[] = [];
    const unsubscribe = subscribeToWalletLoading((isLoading) =>
      states.push(isLoading)
    );
    const showToast = vi.fn();

    const result = await runFreighterSign(async () => "ok", showToast);

    expect(result).toBe("ok");
    expect(states).toEqual([false, true, false]);
    unsubscribe();
  });

  it("verifyAndRehydrateFreighterAddress toggles the loader while checking live wallet state", async () => {
    const { freighterActiveAddress } = await import(
      "@/app/lib/freighter_connector"
    );
    freighterActiveAddress.setActiveAddress({
      address: "GABC",
      network: "testnet",
      connectedAt: Date.now(),
    });

    const states: boolean[] = [];
    const unsubscribe = subscribeToWalletLoading((isLoading) =>
      states.push(isLoading)
    );

    const result = await verifyAndRehydrateFreighterAddress(
      async () => "GABC",
      async () => true
    );

    expect(result).toBe("GABC");
    expect(states).toEqual([false, true, false]);
    unsubscribe();
    freighterActiveAddress.clear();
  });

  it("verifyAndRehydrateFreighterAddress does not toggle the loader when there is no persisted address", async () => {
    const { freighterActiveAddress } = await import(
      "@/app/lib/freighter_connector"
    );
    freighterActiveAddress.clear();

    const states: boolean[] = [];
    const unsubscribe = subscribeToWalletLoading((isLoading) =>
      states.push(isLoading)
    );

    const result = await verifyAndRehydrateFreighterAddress(
      async () => "GABC",
      async () => true
    );

    expect(result).toBeNull();
    expect(states).toEqual([false]);
    unsubscribe();
  });
});
