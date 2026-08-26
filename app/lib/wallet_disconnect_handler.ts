/**
 * wallet_disconnect_handler — Helpers for safe wallet disconnection with
 * wallet-extension availability checks.
 *
 * Before attempting to disconnect, the handler checks whether the wallet
 * extension is actually installed.  If the extension is missing (e.g. the
 * user uninstalled it while connected), a helpful setup instruction is
 * displayed instead of a cryptic runtime error.
 *
 * Mirrors the conventions established by `app/lib/freighter_connector.ts`
 * and `app/lib/wallet_state_context.ts`.
 */

const LOG_PREFIX = "[wallet_disconnect_handler]";

// =============================================================
// Wallet availability detection
// =============================================================

/** Global window keys injected by each wallet extension. */
const WALLET_GLOBALS: Record<string, string[]> = {
  freighter: ["freighterApi", "freighter"],
  albedo: ["albedo", "albedoApi"],
  xbull: ["xBullSDK", "x bull"],
  hana: ["hanaWallet", "hana"],
};

export interface WalletAvailabilityResult {
  /** `true` when at least one of the extension's globals is present. */
  available: boolean;
  /** Human-readable setup instruction shown when the wallet is missing. */
  setupInstruction: string | null;
  /** Install URL for the missing wallet, if known. */
  installUrl: string | null;
}

const SETUP_INSTRUCTIONS: Record<string, string> = {
  freighter:
    "Freighter wallet extension not found. " +
    "Install Freighter from freighter.app and refresh this page to continue.",
  albedo:
    "Albedo wallet extension not found. " +
    "Install Albedo from albedo.link and refresh this page to continue.",
  xbull:
    "xBull wallet extension not found. " +
    "Install xBull and refresh this page to continue.",
  hana:
    "Hana wallet extension not found. " +
    "Install Hana Wallet and refresh this page to continue.",
};

const INSTALL_URLS: Record<string, string> = {
  freighter: "https://www.freighter.app/",
  albedo: "https://albedo.link/",
  xbull: "https://xbull.app/",
  hana: "https://www.hanawallet.io/",
};

const FALLBACK_SETUP_INSTRUCTION =
  "Wallet extension not found. " +
  "Install the wallet extension for your provider and refresh this page to continue.";

/**
 * Detects whether a wallet extension is installed by checking for the
 * window globals it injects.
 *
 * @param walletId - The wallet provider ID (freighter, albedo, xbull, hana).
 * @param detector - Optional override for testing (receives the global check).
 */
export function detectWalletExtensionById(
  walletId: string,
  detector?: () => boolean,
): boolean {
  if (detector) {
    return detector();
  }

  if (typeof window === "undefined") return false;

  const globals = WALLET_GLOBALS[walletId] ?? [];
  const w = window as unknown as Record<string, unknown>;

  for (const key of globals) {
    try {
      if (w[key]) return true;
    } catch {
      // SSR or restricted environment — skip
    }
  }

  return false;
}

/**
 * Checks wallet availability and returns setup instructions if missing.
 */
export function checkWalletAvailabilityById(
  walletId: string,
  detector?: () => boolean,
): WalletAvailabilityResult {
  try {
    const available = detectWalletExtensionById(walletId, detector);

    if (available) {
      return { available: true, setupInstruction: null, installUrl: null };
    }

    return {
      available: false,
      setupInstruction:
        SETUP_INSTRUCTIONS[walletId] ?? FALLBACK_SETUP_INSTRUCTION,
      installUrl: INSTALL_URLS[walletId] ?? null,
    };
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} AVAILABILITY CHECK FAILED for ${walletId}:`,
      err instanceof Error ? err.message : String(err),
    );

    return {
      available: false,
      setupInstruction:
        SETUP_INSTRUCTIONS[walletId] ?? FALLBACK_SETUP_INSTRUCTION,
      installUrl: INSTALL_URLS[walletId] ?? null,
    };
  }
}

// =============================================================
// Disconnect with availability pre-check
// =============================================================

export interface WalletDisconnectResult {
  /** `true` when the disconnect operation succeeded. */
  success: boolean;
  /** Error message when the disconnect failed. `null` on success. */
  error: string | null;
  /**
   * Human-readable fallback instructions shown when the wallet is not
   * installed.  `null` when no fallback is needed.
   */
  fallbackInstructions: string | null;
  /** Install URL for the missing wallet, if known. */
  installUrl: string | null;
}

/**
 * Attempts to disconnect a wallet, performing an availability check first.
 *
 * If the wallet extension is not installed, the disconnect is skipped and
 * the returned result carries `fallbackInstructions` instead of throwing.
 * This prevents a confusing "wallet not found" error from appearing when
 * the user has already uninstalled the extension.
 *
 * @param walletId - The wallet provider ID.
 * @param disconnectFn - The actual disconnect function (e.g. StellarWalletsKit.disconnect()).
 * @param detector - Optional availability-detector override for tests.
 */
export async function disconnectWalletWithCheck(
  walletId: string,
  disconnectFn: () => Promise<void>,
  detector?: () => boolean,
): Promise<WalletDisconnectResult> {
  const availability = checkWalletAvailabilityById(walletId, detector);

  if (!availability.available) {
    console.warn(
      `${LOG_PREFIX} Wallet "${walletId}" is not installed — skipping disconnect.`,
    );
    return {
      success: false,
      error: null,
      fallbackInstructions: availability.setupInstruction,
      installUrl: availability.installUrl,
    };
  }

  try {
    await disconnectFn();
    return {
      success: true,
      error: null,
      fallbackInstructions: null,
      installUrl: null,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Unknown error during wallet disconnect.";

    console.warn(`${LOG_PREFIX} DISCONNECT FAILED for ${walletId}:`, message);

    return {
      success: false,
      error: message,
      fallbackInstructions: null,
      installUrl: null,
    };
  }
}
