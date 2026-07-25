/**
 * network_sync_checker — active network status validator:
 * alignment checks, wallet availability detection, and graceful handling
 * of wallet signature rejections during sync probes.
 */

import type { ToastType } from "@/app/context/ToastContext";

export type SyncNetwork = "mainnet" | "testnet";

export type SyncToastHandler = (message: string, type: ToastType) => void;

export type WalletAvailabilityStatus =
  | "available"
  | "unavailable"
  | "error";

export interface WalletAvailabilityState {
  available: boolean;
  status: WalletAvailabilityStatus;
  /** User-facing setup instructions when the wallet extension is missing. */
  setupInstruction: string | null;
  warningMessage: string | null;
}

const LOG_PREFIX = "[network_sync_checker]";

/** Install URL for Freighter — the primary recommended Stellar extension. */
export const WALLET_INSTALL_URL = "https://www.freighter.app/";

/** Fallback copy shown when no supported wallet extension is detected. */
export const WALLET_SETUP_INSTRUCTION =
  "No wallet extension detected. Install a supported Stellar wallet (Freighter, Albedo, xBull, or Hana) and refresh this page to continue.";

export interface NetworkSyncState {
  synced: boolean;
  walletNetwork: SyncNetwork;
  appNetwork: SyncNetwork;
  warningMessage: string | null;
}

export class NetworkSyncUserRejectedError extends Error {
  constructor(message = "user rejected transaction") {
    super(message);
    this.name = "NetworkSyncUserRejectedError";
  }
}

export function isNetworkSyncUserRejected(err: unknown): boolean {
  if (err instanceof NetworkSyncUserRejectedError) return true;
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user declined") ||
    message.includes("request rejected") ||
    message.includes("denied by the user")
  );
}

function capitalizeNetwork(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Compares wallet and app networks for sync readiness. */
export function checkNetworkSync(
  walletNetwork: SyncNetwork,
  appNetwork: SyncNetwork
): NetworkSyncState {
  const synced = walletNetwork === appNetwork;
  return {
    synced,
    walletNetwork,
    appNetwork,
    warningMessage: synced
      ? null
      : `Network out of sync: your wallet is on ${capitalizeNetwork(walletNetwork)} but this app uses ${capitalizeNetwork(appNetwork)}. Switch networks to continue.`,
  };
}

/**
 * Runs a wallet signature step during network sync validation. Catches
 * "user rejected transaction" exceptions, logs them, and shows a warning toast.
 */
export async function runNetworkSyncSign<T>(
  signFn: () => Promise<T>,
  showToast: SyncToastHandler
): Promise<T | null> {
  try {
    return await signFn();
  } catch (err) {
    if (isNetworkSyncUserRejected(err)) {
      console.warn(
        `${LOG_PREFIX} signature rejected during network sync:`,
        err instanceof Error ? err.message : err
      );
      showToast(
        "Network sync cancelled — you rejected the signature in your wallet.",
        "warning"
      );
      return null;
    }
    throw err;
  }
}

/**
 * Validates network alignment before running a sync signature probe. When
 * networks match, delegates to {@link runNetworkSyncSign}.
 */
export async function validateNetworkSyncWithSignature<T>(
  walletNetwork: SyncNetwork,
  appNetwork: SyncNetwork,
  signFn: () => Promise<T>,
  showToast: SyncToastHandler
): Promise<T | null> {
  const state = checkNetworkSync(walletNetwork, appNetwork);
  if (!state.synced && state.warningMessage) {
    showToast(state.warningMessage, "warning");
    return null;
  }
  return runNetworkSyncSign(signFn, showToast);
}

/**
 * Detects whether a supported Stellar wallet extension is present in the
 * browser. Accepts an optional detector for tests / non-browser runtimes.
 */
export function detectWalletExtension(detector?: () => boolean): boolean {
  if (detector) {
    return detector();
  }
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as unknown as Record<string, unknown>;
  return !!(
    w["freighterApi"] ||
    w["freighter"] ||
    w["albedo"] ||
    w["xBullSDK"] ||
    w["hanaWallet"]
  );
}

/**
 * Checks wallet extension availability and returns fallback setup instructions
 * when the extension is missing or the check itself throws.
 */
export function checkWalletAvailability(
  detector?: () => boolean
): WalletAvailabilityState {
  try {
    const available = detectWalletExtension(detector);
    if (available) {
      return {
        available: true,
        status: "available",
        setupInstruction: null,
        warningMessage: null,
      };
    }
    return {
      available: false,
      status: "unavailable",
      setupInstruction: WALLET_SETUP_INSTRUCTION,
      warningMessage: WALLET_SETUP_INSTRUCTION,
    };
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} wallet availability check failed:`,
      err instanceof Error ? err.message : err
    );
    return {
      available: false,
      status: "error",
      setupInstruction: WALLET_SETUP_INSTRUCTION,
      warningMessage: `Unable to verify wallet availability. ${WALLET_SETUP_INSTRUCTION}`,
    };
  }
}

/**
 * Runs a wallet availability check and surfaces a warning toast when the
 * extension is missing or the check errors.
 */
export function warnOnMissingWallet(
  showToast: SyncToastHandler,
  detector?: () => boolean
): WalletAvailabilityState {
  const state = checkWalletAvailability(detector);
  if (!state.available && state.warningMessage) {
    showToast(state.warningMessage, "warning");
  }
  return state;
}
