"use client";

import {
  checkAlbedoNetworkMatch,
  type AlbedoNetwork,
} from "@/app/lib/albedo_connector";

interface Props {
  walletNetwork: AlbedoNetwork;
  appNetwork: AlbedoNetwork;
  className?: string;
}

/**
 * Warning bar rendered by albedo_connector network checks when the connected
 * Albedo wallet network does not match the app network.
 */
export default function AlbedoNetworkWarningBar({
  walletNetwork,
  appNetwork,
  className = "",
}: Props) {
  const state = checkAlbedoNetworkMatch(walletNetwork, appNetwork);

  if (!state.mismatched || !state.warningMessage) {
    return null;
  }

  return (
    <div
      data-testid="albedo-network-warning-bar"
      className={`bg-warning/40 border-b border-warning px-6 py-3 text-warning-soft text-sm text-center ${className}`}
      role="alert"
    >
      {state.warningMessage}
    </div>
  );
}
