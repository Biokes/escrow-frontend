"use client";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import { Networks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { NETWORK_PASSPHRASE } from "@/app/lib/contract";
import { useToast } from "./ToastContext";
import { ledgerActiveAddresses } from "@/app/lib/ledger_usb_bridge";
import { freighterActiveAddress, verifyAndRehydrateFreighterAddress } from "@/app/lib/freighter_connector";
import {
  logWalletWarning,
  validateMultiSigAssembly,
  withWalletLoader,
  WalletTransactionTracker,
  type WalletMultiSigAssemblyOptions,
  type WalletMultiSigAssemblyResult,
  type WalletMultiSigSplit,
} from "@/app/lib/wallet_state_context";

const STORAGE_KEY = "milesto_wallet_connected";

export const SUPPORTED_WALLETS = [
  { id: "freighter", label: "Freighter" },
  { id: "albedo", label: "Albedo" },
  { id: "xbull", label: "xBull" },
  { id: "hana", label: "Hana" },
] as const;

export type SupportedWalletId = (typeof SUPPORTED_WALLETS)[number]["id"];

interface KitSignResult {
  signedTxXdr?: string;
}

interface WalletContextType {
  address: string | null;
  assembleMultiSigTransaction: (
    splits: WalletMultiSigSplit[],
    options?: WalletMultiSigAssemblyOptions
  ) => Promise<WalletMultiSigAssemblyResult>;
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnecting: boolean;
  networkMismatch: boolean;
  selectedWalletId: SupportedWalletId;
  setSelectedWalletId: (walletId: SupportedWalletId) => void;
  signTransaction: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  assembleMultiSigTransaction: async () => ({ uniqueSigners: 0, splitsValidated: 0 }),
  connect: async () => {},
  disconnect: () => {},
  isConnecting: false,
  networkMismatch: false,
  selectedWalletId: SUPPORTED_WALLETS[0].id,
  setSelectedWalletId: () => {},
  signTransaction: async () => "",
});

/** Shared transaction/debug tracker for the active wallet context store. */
const walletTracker = new WalletTransactionTracker();

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState<SupportedWalletId>(
    SUPPORTED_WALLETS[0].id
  );
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const initializedRef = useRef(false);
  const { showToast } = useToast();

  const checkNetwork = useCallback(async () => {
    try {
      const result = await StellarWalletsKit.getNetwork();
      setNetworkMismatch(result.networkPassphrase !== NETWORK_PASSPHRASE);
    } catch (e) {
      logWalletWarning("NETWORK CHECK FAILED", "Failed to check network", {
        err: e,
        phase: "error",
      });
      setNetworkMismatch(false);
    }
  }, []);

  const ensureKitInitialized = useCallback(() => {
    if (initializedRef.current) return;

    const allowedIds = new Set<string>(SUPPORTED_WALLETS.map((wallet) => wallet.id));

    StellarWalletsKit.init({
      modules: defaultModules({
        filterBy: (module: { productId: string }) => allowedIds.has(module.productId),
      }),
      network: Networks.TESTNET,
      authModal: {
        showInstallLabel: true,
        hideUnsupportedWallets: false,
      },
    });

    initializedRef.current = true;
  }, []);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) !== "true") return;

    ensureKitInitialized();

    let active = true;

    const rehydrate = async () => {
      if (selectedWalletId === "freighter") {
        try {
          const verifiedAddress = await verifyAndRehydrateFreighterAddress();
          if (!active) return;
          if (verifiedAddress) {
            setAddress(verifiedAddress);
            await checkNetwork();
            return;
          }
        } catch (e) {
          logWalletWarning(
            "REHYDRATE FAILED",
            "Failed to rehydrate freighter active address",
            { err: e, phase: "error" }
          );
        }
      }

      StellarWalletsKit.getAddress()
        .then(async (result: { address?: string }) => {
          if (!active) return;
          if (result.address) {
            setAddress(result.address);
            await checkNetwork();
            if (selectedWalletId === "freighter") {
              freighterActiveAddress.setActiveAddress({
                address: result.address,
                network: NETWORK_PASSPHRASE,
                connectedAt: Date.now(),
              });
            }
          } else {
            localStorage.removeItem(STORAGE_KEY);
            if (selectedWalletId === "freighter") {
              freighterActiveAddress.clear();
            }
          }
        })
        .catch(() => {
          if (!active) return;
          localStorage.removeItem(STORAGE_KEY);
          if (selectedWalletId === "freighter") {
            freighterActiveAddress.clear();
          }
        });
    };

    rehydrate();

    return () => {
      active = false;
    };
  }, [ensureKitInitialized, checkNetwork, selectedWalletId]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      await withWalletLoader(async () => {
        ensureKitInitialized();
        StellarWalletsKit.setWallet(selectedWalletId);

        const result = (await StellarWalletsKit.authModal()) as { address?: string };
        if (result.address) {
          setAddress(result.address);
          await checkNetwork();
          localStorage.setItem(STORAGE_KEY, "true");
          if (selectedWalletId === "freighter") {
            freighterActiveAddress.setActiveAddress({
              address: result.address,
              network: NETWORK_PASSPHRASE,
              connectedAt: Date.now(),
            });
          }
        }
      });
    } catch (e) {
      walletTracker.track("connect", "error", "Wallet connection failed", e);
      showToast("Failed to connect wallet.", "error");
    } finally {
      setIsConnecting(false);
    }
  }, [ensureKitInitialized, selectedWalletId, checkNetwork, showToast]);

  const disconnect = useCallback(() => {
    void withWalletLoader(async () => {
      try {
        await StellarWalletsKit.disconnect();
      } catch (e) {
        walletTracker.track("disconnect", "error", "Wallet disconnect failed", e);
      }
    });
    localStorage.removeItem(STORAGE_KEY);
    ledgerActiveAddresses.clear();
    freighterActiveAddress.clear();
    setNetworkMismatch(false);
    setAddress(null);
  }, []);

  const signTransaction = useCallback(async (xdr: string): Promise<string> => {
    if (!address) throw new Error("Wallet not connected");

    return withWalletLoader(async () => {
      try {
        ensureKitInitialized();
        StellarWalletsKit.setWallet(selectedWalletId);

        const result = (await StellarWalletsKit.signTransaction(xdr, {
          address,
          networkPassphrase: NETWORK_PASSPHRASE,
        })) as KitSignResult;

        return result.signedTxXdr ?? "";
      } catch (e) {
        walletTracker.track("sign", "error", "Wallet signTransaction failed", e);
        throw e;
      }
    });
  }, [address, ensureKitInitialized, selectedWalletId]);

  const assembleMultiSigTransaction = useCallback(
    async (
      splits: WalletMultiSigSplit[],
      options?: WalletMultiSigAssemblyOptions
    ): Promise<WalletMultiSigAssemblyResult> => {
      return withWalletLoader(async () => {
        try {
          return validateMultiSigAssembly(splits, options);
        } catch (e) {
          walletTracker.track(
            "multisig",
            "error",
            "Multi-sig transaction assembly failed",
            e
          );
          throw e;
        }
      });
    },
    []
  );

  return (
    <WalletContext.Provider
      value={{
        address,
        assembleMultiSigTransaction,
        connect,
        disconnect,
        isConnecting,
        networkMismatch,
        selectedWalletId,
        setSelectedWalletId,
        signTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
