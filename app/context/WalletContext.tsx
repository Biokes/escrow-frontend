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
import { walletStateStore } from "@/app/lib/wallet_state_store";

const LEGACY_STORAGE_KEY = "milesto_wallet_connected";

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
  connect: async () => {},
  disconnect: () => {},
  isConnecting: false,
  networkMismatch: false,
  selectedWalletId: SUPPORTED_WALLETS[0].id,
  setSelectedWalletId: () => {},
  signTransaction: async () => "",
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState<SupportedWalletId>(() => {
    const persisted = walletStateStore.getActiveState();
    return persisted?.selectedWalletId as SupportedWalletId ?? SUPPORTED_WALLETS[0].id;
  });
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const initializedRef = useRef(false);
  const { showToast } = useToast();

  const checkNetwork = useCallback(async () => {
    try {
      const result = await StellarWalletsKit.getNetwork();
      setNetworkMismatch(result.networkPassphrase !== NETWORK_PASSPHRASE);
    } catch (e) {
      console.error("Failed to check network", e);
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

  const initialRehydrationDone = useRef(false);

  useEffect(() => {
    if (initialRehydrationDone.current) return;
    initialRehydrationDone.current = true;

    const persisted = walletStateStore.getActiveState();
    const hadLegacyFlag = localStorage.getItem(LEGACY_STORAGE_KEY) === "true";

    if (!persisted && !hadLegacyFlag) return;

    const walletId = persisted?.selectedWalletId ?? selectedWalletId;

    ensureKitInitialized();

    let active = true;

    const rehydrate = async () => {
      if (walletId === "freighter") {
        try {
          const verifiedAddress = await verifyAndRehydrateFreighterAddress();
          if (!active) return;
          if (verifiedAddress) {
            setAddress(verifiedAddress);
            await checkNetwork();

            if (!persisted) {
              walletStateStore.setActiveState({
                address: verifiedAddress,
                selectedWalletId: "freighter",
                networkPassphrase: NETWORK_PASSPHRASE,
                connectedAt: Date.now(),
              });
            }

            localStorage.removeItem(LEGACY_STORAGE_KEY);
            return;
          }
        } catch (e) {
          console.error("Failed to rehydrate freighter active address", e);
        }

        if (!active) return;
        walletStateStore.clear();
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        setAddress(null);
        return;
      }

      StellarWalletsKit.getAddress()
        .then(async (result: { address?: string }) => {
          if (!active) return;
          if (result.address) {
            setAddress(result.address);
            await checkNetwork();

            if (!persisted) {
              walletStateStore.setActiveState({
                address: result.address,
                selectedWalletId: walletId,
                networkPassphrase: NETWORK_PASSPHRASE,
                connectedAt: Date.now(),
              });
            }

            localStorage.removeItem(LEGACY_STORAGE_KEY);
          } else {
            walletStateStore.clear();
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            setAddress(null);
          }
        })
        .catch(() => {
          if (!active) return;
          walletStateStore.clear();
          localStorage.removeItem(LEGACY_STORAGE_KEY);
          setAddress(null);
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
      ensureKitInitialized();
      StellarWalletsKit.setWallet(selectedWalletId);

      const result = (await StellarWalletsKit.authModal()) as { address?: string };
      if (result.address) {
        setAddress(result.address);
        await checkNetwork();
        walletStateStore.setActiveState({
          address: result.address,
          selectedWalletId,
          networkPassphrase: NETWORK_PASSPHRASE,
          connectedAt: Date.now(),
        });
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        if (selectedWalletId === "freighter") {
          freighterActiveAddress.setActiveAddress({
            address: result.address,
            network: NETWORK_PASSPHRASE,
            connectedAt: Date.now(),
          });
        }
      }
    } catch (e) {
      console.error("Wallet connection failed", e);
      showToast("Failed to connect wallet.", "error");
    } finally {
      setIsConnecting(false);
    }
  }, [ensureKitInitialized, selectedWalletId, checkNetwork, showToast]);

  const disconnect = useCallback(() => {
    StellarWalletsKit.disconnect().catch((e) => {
      console.error("Wallet disconnect failed", e);
    });
    walletStateStore.clear();
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    ledgerActiveAddresses.clear();
    freighterActiveAddress.clear();
    setNetworkMismatch(false);
    setAddress(null);
  }, []);

  const signTransaction = useCallback(async (xdr: string): Promise<string> => {
    if (!address) throw new Error("Wallet not connected");

    ensureKitInitialized();
    StellarWalletsKit.setWallet(selectedWalletId);

    const result = (await StellarWalletsKit.signTransaction(xdr, {
      address,
      networkPassphrase: NETWORK_PASSPHRASE,
    })) as KitSignResult;

    return result.signedTxXdr ?? "";
  }, [address, ensureKitInitialized, selectedWalletId]);

  return (
    <WalletContext.Provider
      value={{
        address,
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
