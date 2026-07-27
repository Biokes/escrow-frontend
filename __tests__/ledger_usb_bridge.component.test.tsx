import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LedgerUsbBridge from "@/app/components/LedgerUsbBridge";
import type { LedgerAvailabilityState } from "@/app/lib/ledger_usb_bridge";

const AVAILABLE_TRANSPORT = () => ({ hasWebUsb: true, hasWebHid: false });
const UNAVAILABLE_TRANSPORT = () => ({ hasWebUsb: false, hasWebHid: false });

describe("LedgerUsbBridge component", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("renders trigger actions for network check and signing", () => {
    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={vi.fn()}
        detector={AVAILABLE_TRANSPORT}
      />
    );

    expect(screen.getByTestId("ledger-usb-bridge")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check Ledger network" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign via Ledger" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "idle"
    );
  });

  it("marks network as ok when wallet and app networks match", () => {
    const onNetworkCheck = vi.fn();
    const showToast = vi.fn();

    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={showToast}
        onNetworkCheck={onNetworkCheck}
        detector={AVAILABLE_TRANSPORT}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Check Ledger network" }));

    expect(onNetworkCheck).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "network-ok"
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it("surfaces a warning toast when networks diverge", () => {
    const onNetworkCheck = vi.fn();
    const showToast = vi.fn();

    render(
      <LedgerUsbBridge
        walletNetwork="mainnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={showToast}
        onNetworkCheck={onNetworkCheck}
        detector={AVAILABLE_TRANSPORT}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Check Ledger network" }));

    expect(onNetworkCheck).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "network-mismatch"
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/Network mismatch/i),
      "warning"
    );
  });

  it("completes signing when the wallet approves", async () => {
    const signTransaction = vi.fn().mockResolvedValue({ signedXdr: "signed-xdr" });
    const onSigned = vi.fn();
    const showToast = vi.fn();

    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={signTransaction}
        showToast={showToast}
        onSigned={onSigned}
        detector={AVAILABLE_TRANSPORT}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign via Ledger" }));

    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "signing"
    );

    await waitFor(() => {
      expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
        "signed"
      );
    });

    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(onSigned).toHaveBeenCalledWith({ signedXdr: "signed-xdr" });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("handles user rejection during signing with a warning toast", async () => {
    const signTransaction = vi
      .fn()
      .mockRejectedValue(new Error("user rejected transaction"));
    const showToast = vi.fn();

    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={signTransaction}
        showToast={showToast}
        detector={AVAILABLE_TRANSPORT}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign via Ledger" }));

    await waitFor(() => {
      expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
        "rejected"
      );
    });

    expect(showToast).toHaveBeenCalledWith(
      "Transaction cancelled — you rejected the signature on your Ledger.",
      "warning"
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it("surfaces unexpected signing errors with an error toast", async () => {
    const signTransaction = vi.fn().mockRejectedValue(new Error("USB disconnect"));
    const showToast = vi.fn();

    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={signTransaction}
        showToast={showToast}
        detector={AVAILABLE_TRANSPORT}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign via Ledger" }));

    await waitFor(() => {
      expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
        "error"
      );
    });

    expect(showToast).toHaveBeenCalledWith("USB disconnect", "error");
  });
});

describe("LedgerUsbBridge transport availability integration", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("displays the warning banner and shows unavailable status when transport is unavailable", () => {
    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={vi.fn()}
        detector={UNAVAILABLE_TRANSPORT}
      />
    );

    expect(
      screen.getByTestId("ledger-wallet-warning-banner")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check Ledger network" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign via Ledger" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "transport-unavailable"
    );
  });

  it("sets status to transport-unavailable on mount when transport is missing", () => {
    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={vi.fn()}
        detector={UNAVAILABLE_TRANSPORT}
      />
    );

    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "transport-unavailable"
    );
  });

  it("shows a warning toast when clicking the check-network button while transport is unavailable", () => {
    const showToast = vi.fn();

    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={showToast}
        detector={UNAVAILABLE_TRANSPORT}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Check Ledger network" })
    );

    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/browser does not support/i),
      "warning"
    );
    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "transport-unavailable"
    );
  });

  it("shows a warning toast when clicking the sign button while transport is unavailable", async () => {
    const signTransaction = vi.fn();
    const showToast = vi.fn();

    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={signTransaction}
        showToast={showToast}
        detector={UNAVAILABLE_TRANSPORT}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign via Ledger" }));

    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/browser does not support/i),
      "warning"
    );
    expect(signTransaction).not.toHaveBeenCalled();
    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "transport-unavailable"
    );
  });

  it("hides the banner and enables buttons when WebUSB transport is available", () => {
    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={vi.fn()}
        detector={() => ({ hasWebUsb: true, hasWebHid: false })}
      />
    );

    expect(
      screen.queryByTestId("ledger-wallet-warning-banner")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check Ledger network" })
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Sign via Ledger" })
    ).not.toBeDisabled();
    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "idle"
    );
  });

  it("hides the banner and enables buttons when only WebHID transport is available", () => {
    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={vi.fn()}
        detector={() => ({ hasWebUsb: false, hasWebHid: true })}
      />
    );

    expect(
      screen.queryByTestId("ledger-wallet-warning-banner")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check Ledger network" })
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Sign via Ledger" })
    ).not.toBeDisabled();
  });

  it("accepts a precomputed unavailable availability state via props", () => {
    const availability: LedgerAvailabilityState = {
      available: false,
      status: "unavailable",
      transportType: "none",
      setupInstruction:
        "Your browser does not support connecting to Ledger hardware wallets.",
      warningMessage:
        "Your browser does not support connecting to Ledger hardware wallets.",
    };

    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={vi.fn()}
        availability={availability}
      />
    );

    expect(
      screen.getByTestId("ledger-wallet-warning-banner")
    ).toBeInTheDocument();
    expect(screen.getByTestId("ledger-usb-bridge-status")).toHaveTextContent(
      "transport-unavailable"
    );
    expect(
      screen.getByRole("button", { name: "Check Ledger network" })
    ).toBeInTheDocument();
  });

  it("accepts a precomputed available availability state via props", () => {
    const availability: LedgerAvailabilityState = {
      available: true,
      status: "available",
      transportType: "webusb",
      setupInstruction: null,
      warningMessage: null,
    };

    const signTransaction = vi.fn().mockResolvedValue({ signedXdr: "ok" });
    const onNetworkCheck = vi.fn();

    render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={signTransaction}
        showToast={vi.fn()}
        onNetworkCheck={onNetworkCheck}
        availability={availability}
      />
    );

    expect(
      screen.queryByTestId("ledger-wallet-warning-banner")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check Ledger network" })
    ).not.toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Check Ledger network" })
    );
    expect(onNetworkCheck).toHaveBeenCalledWith(false);
  });

  it("treats available transport (no device) as a separate state and does not warn", () => {
    const availability: LedgerAvailabilityState = {
      available: true,
      status: "available",
      transportType: "webusb",
      setupInstruction: null,
      warningMessage: null,
    };

    const { container } = render(
      <LedgerUsbBridge
        walletNetwork="testnet"
        appNetwork="testnet"
        signTransaction={vi.fn()}
        showToast={vi.fn()}
        availability={availability}
      />
    );

    expect(
      screen.queryByTestId("ledger-wallet-warning-banner")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("ledger-usb-bridge-status")
    ).not.toHaveTextContent("transport-unavailable");
    expect(container.textContent).not.toMatch(/not support|install/i);
  });
});
