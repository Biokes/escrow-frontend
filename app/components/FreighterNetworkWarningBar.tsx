"use client";

import {
  checkFreighterNetworkMatch,
  type FreighterNetwork,
} from "@/app/lib/freighter_connector";

interface Props {
  walletNetwork: FreighterNetwork;
  appNetwork: FreighterNetwork;
  className?: string;
}

/**
 * Warning bar rendered by freighter_connector network checks when the
 * connected Freighter wallet network does not match the app network.
 */
export default function FreighterNetworkWarningBar({
  walletNetwork,
  appNetwork,
  className = "",
}: Props) {
  const state = checkFreighterNetworkMatch(walletNetwork, appNetwork);

  if (!state.mismatched || !state.warningMessage) {
    return null;
  }

  return (
    <div
      data-testid="freighter-network-warning-bar"
      className={`bg-warning/40 border-b border-warning px-6 py-3 text-warning-soft text-sm text-center ${className}`}
      role="alert"
    >
      {state.warningMessage}
    </div>
  );
}
