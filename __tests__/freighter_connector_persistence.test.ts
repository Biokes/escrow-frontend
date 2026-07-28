import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FreighterActiveAddressStore,
  verifyAndRehydrateFreighterAddress,
  type FreighterActiveAddress,
  FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY,
  FREIGHTER_ACTIVE_ADDRESS_SCHEMA_VERSION,
} from "@/app/lib/freighter_connector";

/**
 * In-memory Storage implementation used as a test double.
 * Injected via the public constructor parameter — no private-member access needed.
 */
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

function makeAddress(
  overrides: Partial<FreighterActiveAddress> = {}
): FreighterActiveAddress {
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

  beforeEach(() => {
    storage = createMockStorage();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
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
    expect(parsed.version).toBe(FREIGHTER_ACTIVE_ADDRESS_SCHEMA_VERSION);
  });

  it("rehydrates active address correctly on construction from the same storage", () => {
    // storeA writes; storeB reads — simulates a page reload against the same storage backend
    const storeA = new FreighterActiveAddressStore(storage);
    const address = makeAddress();
    storeA.setActiveAddress(address);

    const storeB = new FreighterActiveAddressStore(storage);
    const rehydrated = storeB.getActiveAddress();
    expect(rehydrated).toEqual(address);
  });

  it("persisted state is cleared when clear() is called", () => {
    const store = new FreighterActiveAddressStore(storage);
    store.setActiveAddress(makeAddress());
    expect(store.getActiveAddress()).not.toBeNull();

    store.clear();
    expect(store.getActiveAddress()).toBeNull();
    expect(storage.getItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY)).toBeNull();
  });

  it("setActiveAddress(null) removes entry from storage", () => {
    const store = new FreighterActiveAddressStore(storage);
    store.setActiveAddress(makeAddress());
    expect(storage.getItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY)).not.toBeNull();

    store.setActiveAddress(null);
    expect(store.getActiveAddress()).toBeNull();
    expect(storage.getItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY)).toBeNull();
  });

  it("drops invalid entries silently — missing required address field", () => {
    const store = new FreighterActiveAddressStore(storage);
    store.setActiveAddress({
      network: "testnet",
      connectedAt: Date.now(),
    } as unknown as FreighterActiveAddress);
    expect(store.getActiveAddress()).toBeNull();
  });

  it("drops invalid entries silently — invalid connectedAt type", () => {
    const store = new FreighterActiveAddressStore(storage);
    store.setActiveAddress({
      address: "GABC...",
      network: "testnet",
      connectedAt: "yesterday",
    } as unknown as FreighterActiveAddress);
    expect(store.getActiveAddress()).toBeNull();
  });

  it("gracefully handles corrupted JSON on rehydrate — falls back to null, no throw", () => {
    storage.setItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY, "{bad json");
    const store = new FreighterActiveAddressStore(storage);
    expect(store.getActiveAddress()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    // Corrupted entry should be removed from storage
    expect(storage.getItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY)).toBeNull();
  });

  it("gracefully handles missing schema version on rehydrate — falls back to null", () => {
    const payload = {
      address: "GABC...",
      network: "testnet",
      connectedAt: Date.now(),
      // no `version` field
    };
    storage.setItem(
      FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY,
      JSON.stringify(payload)
    );
    const store = new FreighterActiveAddressStore(storage);
    expect(store.getActiveAddress()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("only persists public fields — no private keys or sensitive data in storage", () => {
    const store = new FreighterActiveAddressStore(storage);
    const withSensitive = makeAddress({ address: "GPUBLIC..." }) as FreighterActiveAddress & {
      privateKey?: string;
      seed?: string;
    };
    withSensitive.privateKey = "SSECRETKEY...";
    withSensitive.seed = "supersecret mnemonic";

    store.setActiveAddress(withSensitive);

    // Verify what actually reached storage
    const raw = storage.getItem(FREIGHTER_ACTIVE_ADDRESS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.address).toBe("GPUBLIC...");
    expect(parsed.privateKey).toBeUndefined();
    expect(parsed.seed).toBeUndefined();

    // Verify the returned value is also clean
    const result = store.getActiveAddress();
    expect(result).not.toBeNull();
    expect(result!.address).toBe("GPUBLIC...");
    expect((result as unknown as Record<string, unknown>).privateKey).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).seed).toBeUndefined();
  });

  it("getActiveAddress returns defensive copies — mutations do not affect store", () => {
    const store = new FreighterActiveAddressStore(storage);
    const original = makeAddress({ address: "GORIGINAL..." });
    store.setActiveAddress(original);

    const copy1 = store.getActiveAddress();
    expect(copy1).not.toBeNull();
    copy1!.address = "GMUTATED";

    const copy2 = store.getActiveAddress();
    expect(copy2!.address).toBe("GORIGINAL...");
  });

  describe("verifyAndRehydrateFreighterAddress", () => {
    // verifyAndRehydrateFreighterAddress uses the module-level `freighterActiveAddress`
    // singleton which is backed by window.sessionStorage in jsdom.
    // We set/clear state through the singleton's public methods only — no private access.
    let singletonStore: typeof import("@/app/lib/freighter_connector").freighterActiveAddress;

    beforeEach(async () => {
      const mod = await import("@/app/lib/freighter_connector");
      singletonStore = mod.freighterActiveAddress;
      // Start each test from a clean slate
      singletonStore.clear();
    });

    afterEach(() => {
      // Ensure singleton is clean after each test
      singletonStore.clear();
    });

    describe("object-based API responses (Freighter SDK v6+)", () => {
      it("returns null if no address is persisted in the singleton store", async () => {
        const getAddressFn = vi.fn().mockResolvedValue({ address: "GABC..." });
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: true });

        const verified = await verifyAndRehydrateFreighterAddress(
          getAddressFn,
          isConnectedFn
        );
        expect(verified).toBeNull();
        // getAddressFn should not even be called when nothing is persisted
        expect(isConnectedFn).not.toHaveBeenCalled();
      });

      it("returns verified address when live address matches persisted address", async () => {
        const address = makeAddress();
        singletonStore.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue({ address: address.address });
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: true });

        const verified = await verifyAndRehydrateFreighterAddress(
          getAddressFn,
          isConnectedFn
        );
        expect(verified).toBe(address.address);
        expect(singletonStore.getActiveAddress()?.address).toBe(address.address);
      });

      it("clears and returns null when Freighter reports isConnected: false", async () => {
        const address = makeAddress();
        singletonStore.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue({ address: address.address });
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: false });

        const verified = await verifyAndRehydrateFreighterAddress(
          getAddressFn,
          isConnectedFn
        );
        expect(verified).toBeNull();
        expect(singletonStore.getActiveAddress()).toBeNull();
      });

      it("clears and returns null when live address differs from persisted (account switched)", async () => {
        const address = makeAddress();
        singletonStore.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue({ address: "GDIFFERENT..." });
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: true });

        const verified = await verifyAndRehydrateFreighterAddress(
          getAddressFn,
          isConnectedFn
        );
        expect(verified).toBeNull();
        expect(singletonStore.getActiveAddress()).toBeNull();
      });

      it("clears and returns null when getAddress throws — live state authoritative", async () => {
        const address = makeAddress();
        singletonStore.setActiveAddress(address);

        const getAddressFn = vi.fn().mockRejectedValue(new Error("freighter boom"));
        const isConnectedFn = vi.fn().mockResolvedValue({ isConnected: true });

        const verified = await verifyAndRehydrateFreighterAddress(
          getAddressFn,
          isConnectedFn
        );
        expect(verified).toBeNull();
        expect(singletonStore.getActiveAddress()).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
      });
    });

    describe("primitive API responses (direct boolean/string format)", () => {
      it("returns verified address when live address matches persisted address", async () => {
        const address = makeAddress();
        singletonStore.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue(address.address);
        const isConnectedFn = vi.fn().mockResolvedValue(true);

        const verified = await verifyAndRehydrateFreighterAddress(
          getAddressFn,
          isConnectedFn
        );
        expect(verified).toBe(address.address);
      });

      it("clears and returns null when isConnected is false", async () => {
        const address = makeAddress();
        singletonStore.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue(address.address);
        const isConnectedFn = vi.fn().mockResolvedValue(false);

        const verified = await verifyAndRehydrateFreighterAddress(
          getAddressFn,
          isConnectedFn
        );
        expect(verified).toBeNull();
        expect(singletonStore.getActiveAddress()).toBeNull();
      });

      it("clears and returns null when live address differs (account switched)", async () => {
        const address = makeAddress();
        singletonStore.setActiveAddress(address);

        const getAddressFn = vi.fn().mockResolvedValue("GDIFFERENT...");
        const isConnectedFn = vi.fn().mockResolvedValue(true);

        const verified = await verifyAndRehydrateFreighterAddress(
          getAddressFn,
          isConnectedFn
        );
        expect(verified).toBeNull();
        expect(singletonStore.getActiveAddress()).toBeNull();
      });
    });
  });
});
