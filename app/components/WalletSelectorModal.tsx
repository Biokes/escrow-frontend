"use client";

import { useEffect, useState, useCallback } from "react";
import {
  checkNetworkMismatch,
  buildWalletSelectorMismatchMessage,
  subscribeToModalWalletLoading,
  withModalWalletLoader,
  walletSelectorStore,
  type WalletCachedKey,
} from "@/app/lib/wallet_selector_modal";

export const WALLET_SELECTOR_SUPPORTED_WALLETS = [
  { id: "freighter", label: "Freighter" },
  { id: "albedo", label: "Albedo" },
  { id: "xbull", label: "xBull" },
  { id: "hana", label: "Hana" },
] as const;

export type WalletSelectorWalletId =
  (typeof WALLET_SELECTOR_SUPPORTED_WALLETS)[number]["id"];

export interface WalletSelectorModalProps {
  /** Whether the modal is currently visible. */
  isOpen: boolean;
  /** Called when the user requests the modal be closed. */
  onClose: () => void;
  /** Callback when the user selects a wallet to connect. */
  onConnect: (walletId: WalletSelectorWalletId) => void;
  /** Callback when the user disconnects the active wallet. */
  onDisconnect: () => void;
  /** The currently connected wallet address (null when disconnected). */
  activeAddress?: string | null;
  /** The currently selected wallet provider ID. */
  selectedWalletId?: WalletSelectorWalletId;
  /** The wallet's current network passphrase (for mismatch detection). */
  walletNetwork?: string | null;
  /** The expected app network passphrase. */
  appNetwork?: string;
  /** Whether a connect/disconnect operation is currently in progress. */
  isLoading?: boolean;
  /** Current wallet provider error message (null when no error). */
  errorMessage?: string | null;
}

/**
 * Wallet selector modal component.
 *
 * Renders a dropdown-style modal listing all supported wallets, with
 * network mismatch warnings when the wallet network does not match the
 * application, a loading spinner during wallet operations, and persistent
 * caching of the last-used wallet key via `walletSelectorStore`.
 */
export default function WalletSelectorModal({
  isOpen,
  onClose,
  onConnect,
  onDisconnect,
  activeAddress = null,
  selectedWalletId = "freighter",
  walletNetwork = null,
  appNetwork = "Test SDF Network ; September 2015",
  isLoading = false,
  errorMessage = null,
}: WalletSelectorModalProps) {
  const [modalLoading, setModalLoading] = useState(false);

  useEffect(() => {
    return subscribeToModalWalletLoading((loading) => {
      setModalLoading(loading);
    });
  }, []);

  const effectiveLoading = isLoading || modalLoading;

  const networkMismatch = checkNetworkMismatch(
    walletNetwork ?? "",
    appNetwork,
  );

  const mismatchMessage = buildWalletSelectorMismatchMessage(
    selectedWalletId,
    walletNetwork ?? "",
    appNetwork,
  );

  // Persistent caching: persist the cached key when the wallet connects
  useEffect(() => {
    if (activeAddress) {
      const cachedKey: WalletCachedKey = {
        walletId: selectedWalletId,
        address: activeAddress,
        networkPassphrase: walletNetwork ?? "",
        connectedAt: Date.now(),
      };
      walletSelectorStore.setCachedKey(cachedKey);
    }
  }, [activeAddress, selectedWalletId, walletNetwork]);

  const handleConnect = useCallback(
    (walletId: WalletSelectorWalletId) => {
      void withModalWalletLoader(async () => {
        onConnect(walletId);
      });
    },
    [onConnect],
  );

  const handleDisconnect = useCallback(() => {
    void withModalWalletLoader(async () => {
      onDisconnect();
    });
    onClose();
  }, [onDisconnect, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="wallet-selector-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Wallet selector"
    >
      <div
        data-testid="wallet-selector-modal"
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-md mx-4"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Select Wallet</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
            aria-label="Close wallet selector"
          >
            ✕
          </button>
        </div>

        {/* Network mismatch warning bar */}
        {networkMismatch.mismatched && mismatchMessage && (
          <div
            data-testid="wallet-selector-network-warning"
            className="bg-warning/40 border-b border-warning px-6 py-3 text-warning-soft text-sm text-center"
            role="alert"
          >
            {mismatchMessage}
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div
            data-testid="wallet-selector-error-message"
            className="bg-danger/20 border-b border-danger px-6 py-3 text-danger-soft text-sm text-center"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        {/* Loading spinner overlay */}
        {effectiveLoading && (
          <div
            data-testid="wallet-selector-spinner"
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 rounded-lg"
          >
            <div className="flex flex-col items-center space-y-2">
              <svg
                className="h-8 w-8 text-indigo-500 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-sm text-gray-300">
                Wallet operation in progress…
              </span>
            </div>
          </div>
        )}

        {/* Active wallet info */}
        {activeAddress && (
          <div
            data-testid="wallet-selector-active-info"
            className="px-6 py-3 border-b border-gray-700"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-gray-300 font-mono">
                  {activeAddress.slice(0, 4)}...{activeAddress.slice(-4)}
                </span>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={effectiveLoading}
                className="text-sm text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                data-testid="wallet-selector-disconnect-btn"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {/* Wallet list */}
        <div className="px-4 py-3">
          <ul className="space-y-2" role="listbox" aria-label="Available wallets">
            {WALLET_SELECTOR_SUPPORTED_WALLETS.map((wallet) => {
              const isSelected = wallet.id === selectedWalletId;
              const isConnected =
                activeAddress && wallet.id === selectedWalletId;

              return (
                <li key={wallet.id}>
                  <button
                    onClick={() => handleConnect(wallet.id)}
                    disabled={effectiveLoading}
                    data-testid={`wallet-option-${wallet.id}`}
                    data-selected={isSelected}
                    data-connected={isConnected}
                    role="option"
                    aria-selected={isSelected}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center gap-3 ${
                      isSelected
                        ? "bg-indigo-600/20 border border-indigo-500 text-white"
                        : "bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-750 hover:border-gray-600"
                    } disabled:opacity-50`}
                  >
                    <span className="text-sm font-medium">{wallet.label}</span>
                    {isConnected && (
                      <span
                        data-testid="wallet-option-connected-badge"
                        className="ml-auto text-xs text-green-400"
                      >
                        Connected
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
