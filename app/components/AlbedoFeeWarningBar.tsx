"use client";

import {
  checkAlbedoFeeWarning,
  DEFAULT_FEE_LIMIT_STROOPS,
  type AlbedoSimulationResult,
} from "@/app/lib/albedo_connector";

interface Props {
  simulation: AlbedoSimulationResult;
  /** Override the default fee limit (stroops). Defaults to {@link DEFAULT_FEE_LIMIT_STROOPS}. */
  feeLimitStroops?: number;
  className?: string;
}

/**
 * Warning banner rendered by albedo_connector fee inspection when the
 * estimated transaction fee from a Soroban simulation result exceeds the
 * configured limit.
 */
export default function AlbedoFeeWarningBar({
  simulation,
  feeLimitStroops = DEFAULT_FEE_LIMIT_STROOPS,
  className = "",
}: Props) {
  const state = checkAlbedoFeeWarning(simulation, feeLimitStroops);

  if (!state.exceeded || !state.warningMessage) {
    return null;
  }

  return (
    <div
      data-testid="albedo-fee-warning-bar"
      className={`bg-warning/40 border-b border-warning px-6 py-3 text-warning-soft text-sm text-center ${className}`}
      role="alert"
    >
      {state.warningMessage}
    </div>
  );
}
