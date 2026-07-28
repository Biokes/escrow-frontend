import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FreighterActiveAddressStore,
  verifyAndRehydrateFreighterAddress,
  type FreighterActiveAddress,
  FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY,
  freighterActiveAddress,
} from "@/app/lib/freighter_connector";

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      const v = store.get(key);
      return v === undefined ? null : v;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function makeAddress(overrides: Partial<FreighterActiveAddress> = {}): FreighterActiveAddress {
  return {
    address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
    network: "testnet",
    connectedAt: Date.now(),
    ...overrides,
  };
}

describe("freighter_connector active address persistence", () => {
  let storage: Storage;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalStorageRef: Storage | null;

  beforeEach(() => {
    storage = createMockStorage();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    originalStorageRef = null;
    freighterActiveAddress.overrideStorage(storage);
    freighterActiveAddress.clear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    freighterActiveAddress.clear();
    freighterActiveAddress.overrideStorage(originalStorageRef);
  });

  it("initializes to empty state when storage is empty", () => {
    const store = new FreighterActiveAddressStore(storage);
    expect(store.getActiveAddress()).toBeNull();
  });

  it("serializes active address to storage when setActiveAddress is called", () => {
    const store = new FreighterActiveAddressStore(storage);
    const address = makeAddress();
    store.setActiveAddress(address);

    const raw = storage.getItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.address).toBe(address.address);
    expect(parsed.network).toBe(address.network);
    expect(parsed.connectedAt).toBe(address.connectedAt);
    expect(parsed.version).toBe(1);
  });

  it("rehydrates active address correctly from storage on reinitialization", () => {
    const storeA = new FreighterActiveAddressStore(storage);
    const address = makeAddress();
    storeA.setActiveAddress(address);

    const storeB = new FreighterActiveAddressStore(storage);
    const rehydrated = storeB.getActiveAddress();
    expect(rehydrated).toEqual(address);
  });

  it("clears active address correctly when clear is called", () => {
    const store = new FreighterActiveAddressStore(storage);
    store.setActiveAddress(makeAddress());
    expect(store.getActiveAddress()).not.toBeNull();

    store.clear();
    expect(store.getActiveAddress()).toBeNull();
    expect(storage.getItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY)).toBeNull();
  });

  it("drops invalid entries silently (no private/sensitive data leak)", () => {
    const store = new FreighterActiveAddressStore(storage);
    // Missing address
    store.setActiveAddress({
      network: "testnet",
      connectedAt: Date.now(),
    } as unknown as FreighterActiveAddress);
    expect(store.getActiveAddress()).toBeNull();

    // Invalid connectedAt type
    store.setActiveAddress({
      address: "G...",
      network: "testnet",
      connectedAt: "yesterday",
    } as unknown as FreighterActiveAddress);
    expect(store.getActiveAddress()).toBeNull();
  });

  it("gracefully handles corrupted JSON on rehydrate", () => {
    storage.setItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY, "{bad json");
    const store = new FreighterActiveAddressStore(storage);
    expect(store.getActiveAddress()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("gracefully handles missing schema version on rehydrate", () => {
    const payload = {
      address: "G...",
      network: "testnet",
      connectedAt: Date.now(),
    };
    storage.setItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY, JSON.stringify(payload));
    const store = new FreighterActiveAddressStore(storage);
    expect(store.getActiveAddress()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("passes only public fields through the validator and filters sensitive/private keys", () => {
    const store = new FreighterActiveAddressStore(storage);
    const withSensitive = makeAddress({
      address: "G...",
    }) as FreighterActiveAddress & { privateKey?: string; seed?: string };
    withSensitive.privateKey = "S...";
    withSensitive.seed = "supersecret";

    store.setActiveAddress(withSensitive);
    const result = store.getActiveAddress();
    expect(result).not.toBeNull();
    expect(result!.address).toBe("G...");
    const bag = result ?? {};
    expect("privateKey" in bag).toBe(false);
    expect("seed" in bag).toBe(false);
  });

  it("returns defensive copies from getActiveAddress to prevent mutation", () => {
    const store = new FreighterActiveAddressStore(storage);
    const original = makeAddress({ address: "G..." });
    store.setActiveAddress(original);

    const copy1 = store.getActiveAddress();
    expect(copy1).not.toBeNull();
    copy1!.address = "GMUTATED";

    const copy2 = store.getActiveAddress();
    expect(copy2!.address).toBe("G...");
  });

  describe("verifyAndRehydrateFreighterAddress", () => {
    describe("with object-based API responses (v6.0.0)", () => {
      it("returns null if no address is persisted", async () => {
        const getAddressFn = vi.fn().mockResolvedValue({ address: "G..." });
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: true });

        const verified = await verifyAndRehydrateFreighterAddress(getAddressFn, isConnectedFn);
        expect(verified).toBeNull();
      });

      it("returns verified address if live address matches persisted address", async () => {
        const address = makeAddress();
        freighterActiveAddress.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue({ address: address.address });
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: true });

        const verified = await verifyAndRehydrateFreighterAddress(getAddressFn, isConnectedFn);
        expect(verified).toBe(address.address);
        expect(freighterActiveAddress.getActiveAddress()).toEqual(address);
      });

      it("clears and returns null if isConnected is false", async () => {
        const address = makeAddress();
        freighterActiveAddress.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue({ address: address.address });
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: false });

        const verified = await verifyAndRehydrateFreighterAddress(getAddressFn, isConnectedFn);
        expect(verified).toBeNull();
        expect(freighterActiveAddress.getActiveAddress()).toBeNull();
      });

      it("clears and returns null if live address differs from persisted address (account switched)", async () => {
        const address = makeAddress();
        freighterActiveAddress.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue({ address: "GDIFFERENT..." });
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: true });

        const verified = await verifyAndRehydrateFreighterAddress(getAddressFn, isConnectedFn);
        expect(verified).toBeNull();
        expect(freighterActiveAddress.getActiveAddress()).toBeNull();
      });

      it("clears and returns null if live address check fails or throws", async () => {
        const address = makeAddress();
        freighterActiveAddress.setActiveAddress(address);

        const getAddressFn = vi.fn().mockRejectedValue(new Error("freighter boom"));
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: true });

        const verified = await verifyAndRehydrateFreighterAddress(getAddressFn, isConnectedFn);
        expect(verified).toBeNull();
        expect(freighterActiveAddress.getActiveAddress()).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
      });
    });

    describe("with direct primitive API responses (alternative formats)", () => {
      it("returns verified address if live address matches persisted address", async () => {
        const address = makeAddress();
        freighterActiveAddress.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue(address.address);
        const isConnectedFn = vi.fn().mockResolvedValue(true);

        const verified = await verifyAndRehydrateFreighterAddress(getAddressFn, isConnectedFn);
        expect(verified).toBe(address.address);
        expect(freighterActiveAddress.getActiveAddress()).toEqual(address);
      });

      it("clears and returns null if isConnected is false", async () => {
        const address = makeAddress();
        freighterActiveAddress.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue(address.address);
        const isConnectedFn = vi.fn().mockResolvedValue(false);

        const verified = await verifyAndRehydrateFreighterAddress(getAddressFn, isConnectedFn);
        expect(verified).toBeNull();
        expect(freighterActiveAddress.getActiveAddress()).toBeNull();
      });

      it("clears and returns null if live address differs (account switched)", async () => {
        const address = makeAddress();
        freighterActiveAddress.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue("GDIFFERENT...");
        const isConnectedFn = vi.fn().mockResolvedValue(true);

        const verified = await verifyAndRehydrateFreighterAddress(getAddressFn, isConnectedFn);
        expect(verified).toBeNull();
        expect(freighterActiveAddress.getActiveAddress()).toBeNull();
      });
    });
  });
});
