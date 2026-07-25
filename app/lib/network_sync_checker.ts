/**
 * network_sync_checker — active network status validator:
 * alignment checks and graceful handling of wallet signature rejections
 * during sync probes.
 */

import type { ToastType } from "@/app/context/ToastContext";

export type SyncNetwork = "mainnet" | "testnet";

export type SyncToastHandler = (message: string, type: ToastType) => void;

const LOG_PREFIX = "[network_sync_checker]";

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
