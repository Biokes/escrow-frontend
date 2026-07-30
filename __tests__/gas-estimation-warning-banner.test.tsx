import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import GasEstimationWarningBanner from "@/app/components/GasEstimationWarningBanner";
import { HIGH_FEE_THRESHOLD_STROOPS } from "@/app/lib/ledger_usb_bridge";

// ---------------------------------------------------------------------------
// Mock useWallet so we can inject different gasWarning states without
// needing a full WalletProvider / StellarWalletsKit environment.
// ---------------------------------------------------------------------------
const mockUseWallet = vi.fn();

vi.mock("@/app/context/WalletContext", () => ({
  useWallet: () => mockUseWallet(),
}));

describe("GasEstimationWarningBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when gasWarning is null", () => {
    mockUseWallet.mockReturnValue({ gasWarning: null });

    const { container } = render(<GasEstimationWarningBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when hasWarning is false", () => {
    mockUseWallet.mockReturnValue({
      gasWarning: {
        hasWarning: false,
        highFee: false,
        simulationError: false,
        warningMessage: null,
      },
    });

    const { container } = render(<GasEstimationWarningBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a warning banner when fee exceeds standard bounds", () => {
    const fee = HIGH_FEE_THRESHOLD_STROOPS + 1;
    const xlm = (fee / 10_000_000).toFixed(7);
    mockUseWallet.mockReturnValue({
      gasWarning: {
        hasWarning: true,
        highFee: true,
        simulationError: false,
        warningMessage: `Estimated fee is unusually high (${fee} stroops / ${xlm} XLM). Review before signing.`,
      },
    });

    render(<GasEstimationWarningBanner />);

    const banner = screen.getByTestId("gas-estimation-warning-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent(/unusually high/i);
    expect(banner).toHaveTextContent(`${fee} stroops`);
  });

  it("renders a warning banner when simulation reports an error string", () => {
    mockUseWallet.mockReturnValue({
      gasWarning: {
        hasWarning: true,
        highFee: false,
        simulationError: true,
        warningMessage: "Transaction simulation failed: HostError: trap",
      },
    });

    render(<GasEstimationWarningBanner />);

    const banner = screen.getByTestId("gas-estimation-warning-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent(/simulation failed/i);
    expect(banner).toHaveTextContent("HostError: trap");
  });

  it("renders a generic simulation failure message when no error string is present", () => {
    mockUseWallet.mockReturnValue({
      gasWarning: {
        hasWarning: true,
        highFee: false,
        simulationError: true,
        warningMessage:
          "Transaction simulation failed. The contract may have rejected this operation.",
      },
    });

    render(<GasEstimationWarningBanner />);

    expect(screen.getByRole("alert")).toHaveTextContent(/contract may have rejected/i);
  });

  it("applies extra className prop to the banner", () => {
    mockUseWallet.mockReturnValue({
      gasWarning: {
        hasWarning: true,
        highFee: true,
        simulationError: false,
        warningMessage: "Estimated fee is unusually high (1000001 stroops / 0.1000001 XLM). Review before signing.",
      },
    });

    render(<GasEstimationWarningBanner className="mx-4 mt-4" />);

    const banner = screen.getByTestId("gas-estimation-warning-banner");
    expect(banner).toHaveClass("mx-4");
    expect(banner).toHaveClass("mt-4");
  });
});

// ---------------------------------------------------------------------------
// Integration: verify WalletContext derives gasWarning correctly from
// setSimulationResult so the banner reflects real context state changes.
// ---------------------------------------------------------------------------
import { renderHook } from "@testing-library/react";
import { useWallet, WalletProvider } from "@/app/context/WalletContext";

// Re-enable the real module for integration tests in this block.
vi.unmock("@/app/context/WalletContext");

// Minimal stubs needed by WalletProvider internals.
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  StellarWalletsKit: {
    init: vi.fn(),
    getNetwork: vi.fn().mockResolvedValue({ networkPassphrase: "Test SDF Network ; September 2015" }),
    getAddress: vi.fn().mockResolvedValue({ address: null }),
    authModal: vi.fn(),
    setWallet: vi.fn(),
    signTransaction: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/utils", () => ({
  defaultModules: vi.fn(() => []),
}));

vi.mock("@/app/lib/contract", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

vi.mock("@/app/lib/ledger_usb_bridge", () => {
  // Import real implementations so checkSimulationFeeWarning logic is preserved
  const {
    checkSimulationFeeWarning,
    HIGH_FEE_THRESHOLD_STROOPS,
  } = vi.importActual<typeof import("@/app/lib/ledger_usb_bridge")>(
    "@/app/lib/ledger_usb_bridge"
  );
  return {
    checkSimulationFeeWarning,
    HIGH_FEE_THRESHOLD_STROOPS,
    ledgerActiveAddresses: { clear: vi.fn() },
  };
});

vi.mock("@/app/lib/freighter_connector", () => ({
  freighterActiveAddress: { setActiveAddress: vi.fn(), clear: vi.fn() },
  verifyAndRehydrateFreighterAddress: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/app/context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe("WalletContext gas warning integration", () => {
  it("gasWarning is null when no simulationResult has been set", () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: WalletProvider,
    });

    expect(result.current.gasWarning).toBeNull();
    expect(result.current.simulationResult).toBeNull();
  });

  it("gasWarning reflects hasWarning=true when fee exceeds threshold", () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: WalletProvider,
    });

    act(() => {
      result.current.setSimulationResult({
        fee: HIGH_FEE_THRESHOLD_STROOPS + 500,
      });
    });

    expect(result.current.gasWarning?.hasWarning).toBe(true);
    expect(result.current.gasWarning?.highFee).toBe(true);
    expect(result.current.gasWarning?.simulationError).toBe(false);
    expect(result.current.gasWarning?.warningMessage).toMatch(/unusually high/i);
  });

  it("gasWarning reflects simulationError=true when simulation has an error", () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: WalletProvider,
    });

    act(() => {
      result.current.setSimulationResult({
        fee: 100,
        error: "HostError: trap",
      });
    });

    expect(result.current.gasWarning?.hasWarning).toBe(true);
    expect(result.current.gasWarning?.simulationError).toBe(true);
    expect(result.current.gasWarning?.warningMessage).toMatch(/simulation failed/i);
  });

  it("gasWarning is null after simulationResult is cleared", () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: WalletProvider,
    });

    act(() => {
      result.current.setSimulationResult({ fee: HIGH_FEE_THRESHOLD_STROOPS + 1 });
    });
    expect(result.current.gasWarning?.hasWarning).toBe(true);

    act(() => {
      result.current.setSimulationResult(null);
    });
    expect(result.current.gasWarning).toBeNull();
  });

  it("gasWarning has hasWarning=false when fee is within bounds", () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: WalletProvider,
    });

    act(() => {
      result.current.setSimulationResult({ fee: 100 });
    });

    expect(result.current.gasWarning?.hasWarning).toBe(false);
    expect(result.current.gasWarning?.warningMessage).toBeNull();
  });
});
