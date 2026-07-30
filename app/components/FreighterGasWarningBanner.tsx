"use client";

import {
  checkSimulationFeeWarning,
  type FreighterSimulationResult,
} from "@/app/lib/freighter_connector";

interface Props {
  simulation: FreighterSimulationResult | null;
  className?: string;
}

/**
 * Displays a warning banner when a Freighter gas/fee estimation result
 * exceeds standard bounds or contains a simulation error.
 *
 * Renders nothing when `simulation` is null or when no warning applies.
 */
export default function FreighterGasWarningBanner({
  simulation,
  className = "",
}: Props) {
  if (!simulation) return null;

  const state = checkSimulationFeeWarning(simulation);

  if (!state.hasWarning || !state.warningMessage) {
    return null;
  }

  return (
    <div
      data-testid="freighter-gas-warning-banner"
      role="alert"
      className={`bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-sm text-yellow-300 ${className}`}
    >
      {state.warningMessage}
    </div>
  );
}
