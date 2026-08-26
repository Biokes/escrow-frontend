"use client";

import { useCallback, useEffect, useState } from "react";
import {
  checkFreighterAvailability,
  FREIGHTER_INSTALL_URL,
  FREIGHTER_SETUP_INSTRUCTION,
  isFreighterUserRejected,
  type FreighterAvailabilityState,
} from "@/app/lib/freighter_connector";
import {
  isWalletRejectedError,
  WalletRejectedError,
} from "@/app/lib/errors";
import { useToast } from "@/app/context/ToastContext";
import {
  SUPPORTED_WALLETS,
  type SupportedWalletId,
} from "@/app/context/WalletContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WalletSelectorModalStatus =
  | "idle"
  | "connecting"
  | "signing"
  | "rejected"
  | "error"
  | "unavailable";

export interface WalletSelectorModalProps {
  /** Whether the modal is currently visible. */
  isOpen: boolean;
  /** Called when the user clicks the close / dismiss control. */
  onClose: () => void;
  /** Called when a wallet is successfully connected. */
  onConnect?: (walletId: SupportedWalletId) => void;
  /** Optional detector override for Freighter availability (useful in tests). */
  freighterDetector?: () => boolean;
  /** Optional detector override for window globals (useful in tests). */
  windowDetector?: () => boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detects if any supported browser wallet extension is installed.
 * Accepts optional detector overrides for test environments.
 */
export function detectAnyWalletExtension(
  detector?: () => boolean
): boolean {
  if (detector) {
    return detector();
  }
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as unknown as Record<string, unknown>;
  return !!(w["freighterApi"] || w["freighter"]);
}

/**
 * Catches and normalises wallet interaction errors. Returns a structured
 * result so the caller can decide how to surface the error to the user.
 */
export function handleWalletError(err: unknown): {
  isRejection: boolean;
  message: string;
  error: unknown;
} {
  if (isFreighterUserRejected(err) || isWalletRejectedError(err)) {
    const originalMessage =
      err instanceof Error ? err.message : "user rejected transaction";
    console.warn(
      "[wallet_selector_modal] signature rejected by user:",
      originalMessage
    );
    return {
      isRejection: true,
      message:
        "Signature cancelled — you rejected the request in your wallet.",
      error: err,
    };
  }

  const message =
    err instanceof Error ? err.message : "An unexpected error occurred.";
  return {
    isRejection: false,
    message,
    error: err,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WalletSelectorModal({
  isOpen,
  onClose,
  onConnect,
  freighterDetector,
  className = "",
}: WalletSelectorModalProps) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<WalletSelectorModalStatus>("idle");
  const [availability, setAvailability] =
    useState<FreighterAvailabilityState | null>(null);

  // Check wallet availability when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const state = checkFreighterAvailability(freighterDetector);
    setAvailability(state);

    if (!state.available) {
      setStatus("unavailable");
    } else {
      setStatus("idle");
    }
  }, [isOpen, freighterDetector]);

  const handleConnect = useCallback(
    async (walletId: SupportedWalletId) => {
      setStatus("connecting");

      try {
        // Simulate wallet connection — in production this would invoke
        // the StellarWalletsKit auth flow
        onConnect?.(walletId);
        setStatus("idle");
      } catch (err) {
        const result = handleWalletError(err);

        if (result.isRejection) {
          setStatus("rejected");
          showToast(result.message, "warning");
        } else {
          setStatus("error");
          showToast(
            "Failed to connect wallet. Please try again.",
            "error"
          );
        }
      }
    },
    [onConnect, showToast]
  );

  const handleSign = useCallback(
    async (signFn: () => Promise<string>) => {
      setStatus("signing");

      try {
        const signedXdr = await signFn();
        if (signedXdr) {
          setStatus("idle");
        } else {
          setStatus("rejected");
          showToast(
            "Signature cancelled — you rejected the request in your wallet.",
            "warning"
          );
        }
      } catch (err) {
        const result = handleWalletError(err);

        if (result.isRejection) {
          setStatus("rejected");
          showToast(result.message, "warning");
        } else {
          setStatus("error");
          showToast(result.message, "error");
        }
      }
    },
    [showToast]
  );

  if (!isOpen) return null;

  return (
    <div
      data-testid="wallet-selector-modal"
      role="dialog"
      aria-label="Select Wallet"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 ${className}`}
    >
      <div
        data-testid="wallet-selector-modal-content"
        className="bg-surface rounded-xl shadow-xl max-w-md w-full mx-4 p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-primary">
            Connect Wallet
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="wallet-selector-modal-close"
            aria-label="Close"
            className="text-secondary hover:text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Wallet availability warning */}
        {availability && !availability.available && (
          <div
            data-testid="wallet-selector-availability-warning"
            role="alert"
            className="bg-warning/40 border border-warning rounded-lg px-4 py-3 mb-4 text-warning-soft text-sm"
          >
            <p data-testid="wallet-selector-setup-instruction">
              {availability.setupInstruction}
            </p>
            <a
              href={FREIGHTER_INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="wallet-selector-install-link"
              className="underline font-medium hover:opacity-80"
            >
              Install Freighter
            </a>
          </div>
        )}

        {/* Status banner */}
        {status === "rejected" && (
          <div
            data-testid="wallet-selector-rejection-warning"
            role="alert"
            className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 mb-4 text-sm text-yellow-300"
          >
            Signature cancelled — you rejected the request in your wallet.
          </div>
        )}

        {status === "error" && (
          <div
            data-testid="wallet-selector-error-warning"
            role="alert"
            className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4 text-sm text-red-300"
          >
            Failed to connect wallet. Please try again.
          </div>
        )}

        {/* Wallet list */}
        <div className="space-y-2" data-testid="wallet-selector-list">
          {SUPPORTED_WALLETS.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              data-testid={`wallet-selector-option-${wallet.id}`}
              onClick={() => handleConnect(wallet.id)}
              disabled={status === "connecting" || status === "signing"}
              className="w-full text-left px-4 py-3 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="font-medium text-primary">
                {wallet.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
