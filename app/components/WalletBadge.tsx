"use client";

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
