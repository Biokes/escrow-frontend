"use client";

import { useWallet } from "@/app/context/WalletContext";

interface Props {
  className?: string;
}

/**
 * Reads gas/fee warning state from WalletContext and displays a warning
 * banner when a simulation result exceeds standard fee bounds or reports
 * a simulation error.
 */
export default function GasEstimationWarningBanner({ className = "" }: Props) {
  const { gasWarning } = useWallet();

  if (!gasWarning || !gasWarning.hasWarning || !gasWarning.warningMessage) {
    return null;
  }

  return (
    <div
      data-testid="gas-estimation-warning-banner"
      role="alert"
      className={`bg-warning/40 border border-warning px-4 py-3 rounded-lg text-warning-soft text-sm ${className}`}
    >
      {gasWarning.warningMessage}
    </div>
  );
}
