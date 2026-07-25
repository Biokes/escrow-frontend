/**
 * freighter_connector — Freighter browser wallet integration helpers:
 * extension availability detection, signature time limits, and graceful
 * handling of user signature rejections.
 */

import type { ToastType } from "@/app/context/ToastContext";

const LOG_PREFIX = "[freighter_connector]";

/** Install URL surfaced when no Freighter extension is detected. */
export const FREIGHTER_INSTALL_URL = "https://www.freighter.app/";

/** Fallback copy shown when the Freighter extension is missing. */
export const FREIGHTER_SETUP_INSTRUCTION =
  "Freighter wallet extension not detected. Install Freighter and refresh this page to continue.";

export type FreighterAvailabilityStatus = "available" | "unavailable" | "error";

export interface FreighterAvailabilityState {
  available: boolean;
  status: FreighterAvailabilityStatus;
  /** User-facing setup instructions when the extension is missing. */
  setupInstruction: string | null;
  warningMessage: string | null;
}

export type FreighterToastHandler = (message: string, type: ToastType) => void;

/**
 * Detects whether the Freighter browser extension is present. Accepts an
 * optional detector override for tests / non-browser runtimes.
 */
export function detectFreighterExtension(detector?: () => boolean): boolean {
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
 * Checks Freighter extension availability and returns fallback setup
 * instructions when the extension is missing or the check itself throws.
 */
export function checkFreighterAvailability(
  detector?: () => boolean
): FreighterAvailabilityState {
  try {
    const available = detectFreighterExtension(detector);
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
      setupInstruction: FREIGHTER_SETUP_INSTRUCTION,
      warningMessage: FREIGHTER_SETUP_INSTRUCTION,
    };
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} wallet availability check failed:`,
      err instanceof Error ? err.message : err
    );
    return {
      available: false,
      status: "error",
      setupInstruction: FREIGHTER_SETUP_INSTRUCTION,
      warningMessage: `Unable to verify wallet availability. ${FREIGHTER_SETUP_INSTRUCTION}`,
    };
  }
}

/**
 * Runs a Freighter availability check and surfaces a warning toast when the
 * extension is missing or the check errors.
 */
export function warnOnMissingFreighter(
  showToast: FreighterToastHandler,
  detector?: () => boolean
): FreighterAvailabilityState {
  const state = checkFreighterAvailability(detector);
  if (!state.available && state.warningMessage) {
    showToast(state.warningMessage, "warning");
  }
  return state;
}
