"use client";

import React from "react";

export interface WalletBadgeProps {
  /** The connected Stellar public address (e.g. GABC...1234) */
  address?: string | null;
  /** Whether a wallet connection attempt is actively in progress */
  isConnecting?: boolean;
  /** Explicit connection status override (defaults to `Boolean(address)`) */
  isConnected?: boolean;
  /** Display name of the active wallet provider (e.g. "Freighter", "Albedo") */
  providerName?: string;
  /** Network mismatch warning flag or message */
  networkMismatch?: boolean | string | null;
  /** Whether to display the status indicator dot (defaults to true) */
  showStatusDot?: boolean;
  /** Callback fired when disconnect action is triggered */
  onDisconnect?: () => void;
  /** Callback fired when badge is clicked */
  onClick?: () => void;
  /** Additional CSS class names */
  className?: string;
  /** Custom data-testid attribute (defaults to "wallet-badge") */
  "data-testid"?: string;
}

/** Utility helper to format a Stellar G-address into G...1234 format */
export function formatAddress(address: string, prefixLen = 4, suffixLen = 4): string {
  if (!address || address.length <= prefixLen + suffixLen) {
    return address || "";
  }
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

/**
 * WalletBadge Component (`wallet_badge`)
 *
 * Header status indicator component representing the current wallet connection status,
 * active wallet provider, network alignment, and address.
 */
export default function WalletBadge({
  address,
  isConnecting = false,
  isConnected,
  providerName,
  networkMismatch,
  showStatusDot = true,
  onDisconnect,
  onClick,
  className = "",
  "data-testid": testId = "wallet-badge",
}: WalletBadgeProps) {
  const activeConnected = isConnected !== undefined ? isConnected : Boolean(address);
  const hasMismatch = Boolean(networkMismatch);

  // Status label & ARIA label derivation
  let statusText = "Not Connected";
  let statusState: "connected" | "connecting" | "mismatch" | "disconnected" = "disconnected";

  if (isConnecting) {
    statusText = "Connecting...";
    statusState = "connecting";
  } else if (hasMismatch) {
    statusText = address ? formatAddress(address) : "Network Mismatch";
    statusState = "mismatch";
  } else if (activeConnected && address) {
    statusText = formatAddress(address);
    statusState = "connected";
  }

  const ariaLabel =
    statusState === "connected"
      ? `Connected wallet ${address}`
      : statusState === "connecting"
      ? "Wallet connecting"
      : statusState === "mismatch"
      ? `Wallet network mismatch ${address || ""}`.trim()
      : "Wallet not connected";

  // Dot color classes matching design system
  const dotClasses = {
    connected: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]",
    connecting: "bg-amber-400 animate-pulse",
    mismatch: "bg-rose-400 animate-ping",
    disconnected: "bg-gray-500",
  }[statusState];

  const content = (
    <div
      data-testid={testId}
      role="status"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900/90 px-3 py-1 text-sm font-mono text-gray-200 shadow-sm transition-all duration-150 hover:border-gray-700 ${
        onClick ? "cursor-pointer hover:bg-gray-800/80" : ""
      } ${className}`}
    >
      {showStatusDot && (
        <span
          data-testid="wallet-status-dot"
          data-status={statusState}
          className={`h-2 w-2 rounded-full transition-colors ${dotClasses}`}
          aria-hidden="true"
        />
      )}

      {providerName && (
        <span
          data-testid="wallet-provider-tag"
          className="text-xs font-sans text-gray-400 bg-gray-800/70 px-1.5 py-0.5 rounded"
        >
          {providerName}
        </span>
      )}

      <span data-testid="wallet-address-text" className="tracking-wide">
        {statusText}
      </span>

      {activeConnected && onDisconnect && (
        <button
          type="button"
          data-testid="wallet-disconnect-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDisconnect();
          }}
          aria-label="Disconnect wallet"
          className="ml-1 text-xs font-sans text-gray-400 hover:text-rose-400 focus:outline-none focus:text-rose-400 transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  );

  return content;
import ButtonSpinner from "./ButtonSpinner";

export type WalletBadgeStatus =
  | "connected"
  | "disconnected"
  | "loading"
  | "error";

export interface WalletBadgeProps {
  address?: string | null;
  status?: WalletBadgeStatus;
  errorMessage?: string | null;
  onDisconnect?: () => void;
  className?: string;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Displays a compact wallet status badge showing the connected address,
 * connection status, or an error message. Uses the repository's canonical
 * design tokens for all colors, spacing, and typography.
 */
export default function WalletBadge({
  address,
  status = "disconnected",
  errorMessage,
  onDisconnect,
  className = "",
}: WalletBadgeProps) {
  if (status === "loading") {
    return (
      <span
        data-testid="wallet-badge"
        data-status="loading"
        className={`inline-flex items-center gap-2 text-sm font-mono text-text-muted bg-surface-field border border-border-subtle px-3 py-1 rounded-full ${className}`}
      >
        <ButtonSpinner className="h-3.5 w-3.5" />
        <span>Connecting…</span>
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        data-testid="wallet-badge"
        data-status="error"
        className={`inline-flex items-center gap-2 text-sm font-mono text-danger-soft bg-surface-field border border-danger px-3 py-1 rounded-full ${className}`}
        title={errorMessage ?? undefined}
      >
        <span aria-hidden="true">⚠</span>
        <span>{errorMessage ?? "Wallet error"}</span>
      </span>
    );
  }

  if (status === "connected" && address) {
    return (
      <span
        data-testid="wallet-badge"
        data-status="connected"
        className={`inline-flex items-center gap-2 text-sm font-mono text-text-primary bg-surface-field border border-border-subtle px-3 py-1 rounded-full ${className}`}
        aria-label={`Connected wallet ${address}`}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-success animate-pulse"
        />
        <span>{truncateAddress(address)}</span>
        {onDisconnect && (
          <button
            onClick={onDisconnect}
            className="ml-1 text-text-muted hover:text-danger-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page rounded"
            aria-label="Disconnect wallet"
          >
            ✕
          </button>
        )}
      </span>
    );
  }

  return (
    <span
      data-testid="wallet-badge"
      data-status="disconnected"
      className={`inline-flex items-center gap-2 text-sm font-mono text-text-muted bg-surface-field border border-border-subtle px-3 py-1 rounded-full ${className}`}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-text-disabled" />
      <span>No wallet</span>
    </span>
  );
}
