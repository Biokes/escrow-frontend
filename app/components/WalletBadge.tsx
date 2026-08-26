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
  /** Validation error message or flag highlighting invalid input configuration */
  error?: boolean | string | null;
  /** Field-specific error message or indicator */
  fieldError?: boolean | string | null;
  /** Alert message or flag to highlight input configurations/warnings */
  alert?: boolean | string | null;
  /** Explicit flag indicating whether the address configuration is invalid */
  invalidAddress?: boolean;
  /** Whether to validate the Stellar public key address format */
  validateAddress?: boolean;
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

/** Utility helper to check if a Stellar public key (G-address) format is valid */
export function isValidStellarAddress(address?: string | null): boolean {
  if (!address) return false;
  return /^G[A-Za-z0-9]{55}$/.test(address);
}

/**
 * WalletBadge Component (`wallet_badge`)
 *
 * Header status indicator component representing the current wallet connection status,
 * active wallet provider, network alignment, address, field validation errors, and alerts.
 */
export default function WalletBadge({
  address,
  isConnecting = false,
  isConnected,
  providerName,
  networkMismatch,
  error,
  fieldError,
  alert,
  invalidAddress = false,
  validateAddress = false,
  showStatusDot = true,
  onDisconnect,
  onClick,
  className = "",
  "data-testid": testId = "wallet-badge",
}: WalletBadgeProps) {
  const activeConnected = isConnected !== undefined ? isConnected : Boolean(address);
  const hasMismatch = Boolean(networkMismatch);

  // Address validation check
  const addressFormatInvalid =
    invalidAddress || (validateAddress && address ? !isValidStellarAddress(address) : false);

  // Derive consolidated validation error and alert text
  const combinedError = error || fieldError || (addressFormatInvalid ? "Invalid Stellar address" : null);
  const hasError = Boolean(combinedError);
  const errorMessage =
    typeof combinedError === "string"
      ? combinedError
      : combinedError
      ? "Invalid wallet configuration"
      : null;

  const hasAlert = Boolean(alert);
  const alertMessage =
    typeof alert === "string" ? alert : alert ? "Configuration alert" : null;

  // Status label & ARIA label derivation
  let statusText = "Not Connected";
  let statusState: "connected" | "connecting" | "mismatch" | "error" | "alert" | "disconnected" =
    "disconnected";

  if (isConnecting) {
    statusText = "Connecting...";
    statusState = "connecting";
  } else if (hasError) {
    statusText = address ? formatAddress(address) : errorMessage || "Invalid Configuration";
    statusState = "error";
  } else if (hasMismatch) {
    statusText = address ? formatAddress(address) : "Network Mismatch";
    statusState = "mismatch";
  } else if (hasAlert) {
    statusText = address ? formatAddress(address) : alertMessage || "Alert";
    statusState = "alert";
  } else if (activeConnected && address) {
    statusText = formatAddress(address);
    statusState = "connected";
  }

  const ariaLabel =
    statusState === "error"
      ? `Wallet validation error: ${errorMessage || "Invalid configuration"} ${address || ""}`.trim()
      : statusState === "alert"
      ? `Wallet alert: ${alertMessage || "Alert"} ${address || ""}`.trim()
      : statusState === "connected"
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
    error: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse",
    alert: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]",
    disconnected: "bg-gray-500",
  }[statusState];

  // Container border and background theme
  const borderBgClasses = hasError
    ? "border-red-500/50 bg-red-950/40 text-red-200 hover:border-red-400"
    : hasAlert
    ? "border-amber-500/50 bg-amber-950/40 text-amber-200 hover:border-amber-400"
    : "border-gray-800 bg-gray-900/90 text-gray-200 hover:border-gray-700";

  const content = (
    <div
      data-testid={testId}
      role="status"
      aria-label={ariaLabel}
      aria-invalid={hasError ? true : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-mono shadow-sm transition-all duration-150 ${borderBgClasses} ${
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

      {/* Field error indicator & text message toggle */}
      {hasError && (
        <span
          data-testid="wallet-field-error"
          role="alert"
          aria-live="polite"
          className="inline-flex items-center gap-1 text-xs font-sans text-red-400 bg-red-950/80 border border-red-800/60 px-2 py-0.5 rounded font-medium"
        >
          <span aria-hidden="true" className="font-bold">⚠</span>
          <span data-testid="wallet-error-text">{errorMessage || "Invalid configuration"}</span>
        </span>
      )}

      {/* Alert indicator & text message toggle */}
      {!hasError && hasAlert && (
        <span
          data-testid="wallet-alert-badge"
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1 text-xs font-sans text-amber-400 bg-amber-950/80 border border-amber-800/60 px-2 py-0.5 rounded font-medium"
        >
          <span data-testid="wallet-alert-text">{alertMessage || "Alert"}</span>
        </span>
      )}

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
}

