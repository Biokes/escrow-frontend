import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WalletStateProvider,
  useWalletState,
  detectFreighterExtension,
  FREIGHTER_INSTALL_URL,
  FREIGHTER_SETUP_INSTRUCTION,
} from "@/app/context/WalletStateContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple consumer component so we can assert context values via the DOM. */
function WalletStateConsumer() {
  const state = useWalletState();
  return (
    <div>
      <span data-testid="availability-status">{state.availabilityStatus}</span>
      <span data-testid="is-checking">{String(state.isChecking)}</span>
      <span data-testid="is-available">{String(state.isAvailable)}</span>
      <span data-testid="setup-instruction">
        {state.setupInstruction ?? "none"}
      </span>
      <button
        type="button"
        onClick={state.recheckAvailability}
        data-testid="recheck-btn"
      >
        Recheck
import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletProvider, useWallet } from "@/app/context/WalletContext";
import { ToastProvider } from "@/app/context/ToastContext";
import { isWalletLoading } from "@/app/lib/wallet_state_context";

const kitState = {
  getAddress: vi.fn(),
  authModal: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
  disconnect: vi.fn(),
  init: vi.fn(),
  setWallet: vi.fn(),
};

vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  StellarWalletsKit: {
    init: (...args: unknown[]) => kitState.init(...args),
    getAddress: (...args: unknown[]) => kitState.getAddress(...args),
    authModal: (...args: unknown[]) => kitState.authModal(...args),
    getNetwork: (...args: unknown[]) => kitState.getNetwork(...args),
    signTransaction: (...args: unknown[]) => kitState.signTransaction(...args),
    disconnect: (...args: unknown[]) => kitState.disconnect(...args),
    setWallet: (...args: unknown[]) => kitState.setWallet(...args),
  },
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/utils", () => ({
  defaultModules: vi.fn(() => []),
}));

vi.mock("@/app/lib/freighter_connector", () => ({
  freighterActiveAddress: {
    setActiveAddress: vi.fn(),
    clear: vi.fn(),
  },
  verifyAndRehydrateFreighterAddress: vi.fn(async () => null),
}));

vi.mock("@/app/lib/ledger_usb_bridge", () => ({
  ledgerActiveAddresses: {
    clear: vi.fn(),
  },
}));

function toBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

function WalletHarness() {
  const wallet = useWallet();
  const [multiSigResult, setMultiSigResult] = useState("idle");
  return (
    <div>
      <div data-testid="address">{wallet.address ?? "none"}</div>
      <div data-testid="is-connecting">{String(wallet.isConnecting)}</div>
      <div data-testid="multisig-result">{multiSigResult}</div>
      <button onClick={() => void wallet.connect()}>connect</button>
      <button onClick={() => wallet.disconnect()}>disconnect</button>
      <button
        onClick={() => {
          void wallet.signTransaction("some-xdr").catch(() => {});
        }}
      >
        sign
      </button>
      <button
        onClick={() => {
          const xdr = toBase64("x".repeat(200));
          wallet
            .assembleMultiSigTransaction([
              { baseXdr: xdr, signer: { publicKey: "GA", hint: "aaaa" }, signedXdr: xdr },
              { baseXdr: xdr, signer: { publicKey: "GB", hint: "bbbb" }, signedXdr: xdr },
            ])
            .then((result) =>
              setMultiSigResult(`ok:${result.uniqueSigners}:${result.splitsValidated}`)
            )
            .catch((err: Error) => setMultiSigResult(`error:${err.message}`));
        }}
      >
        assemble-multisig-ok
      </button>
      <button
        onClick={() => {
          const xdr = toBase64("x".repeat(200));
          wallet
            .assembleMultiSigTransaction([
              { baseXdr: xdr, signer: { publicKey: "GA", hint: "aaaa" }, signedXdr: xdr },
            ])
            .then((result) =>
              setMultiSigResult(`ok:${result.uniqueSigners}:${result.splitsValidated}`)
            )
            .catch((err: Error) => setMultiSigResult(`error:${err.message}`));
        }}
      >
        assemble-multisig-fail
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// #113 — wallet availability detection unit tests
// ---------------------------------------------------------------------------

describe("detectFreighterExtension (#113)", () => {
  afterEach(() => {
    // Clean up any window.freighterApi we injected
    delete (window as unknown as Record<string, unknown>)["freighterApi"];
  });

  it("returns false when window.freighterApi is not present", () => {
    expect(detectFreighterExtension()).toBe(false);
  });

  it("returns true when window.freighterApi is present", () => {
    (window as unknown as Record<string, unknown>)["freighterApi"] = {};
    expect(detectFreighterExtension()).toBe(true);
  });

  it("returns true for any truthy value of window.freighterApi", () => {
    (window as unknown as Record<string, unknown>)["freighterApi"] = {
      getPublicKey: vi.fn(),
      signTransaction: vi.fn(),
    };
    expect(detectFreighterExtension()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #113 — FREIGHTER_SETUP_INSTRUCTION constant
// ---------------------------------------------------------------------------

describe("FREIGHTER_SETUP_INSTRUCTION and FREIGHTER_INSTALL_URL (#113)", () => {
  it("FREIGHTER_SETUP_INSTRUCTION mentions Freighter and refresh instructions", () => {
    expect(FREIGHTER_SETUP_INSTRUCTION).toContain("Freighter");
    expect(FREIGHTER_SETUP_INSTRUCTION).toMatch(/install/i);
    expect(FREIGHTER_SETUP_INSTRUCTION).toMatch(/refresh/i);
  });

  it("FREIGHTER_INSTALL_URL points to freighter.app", () => {
    expect(FREIGHTER_INSTALL_URL).toContain("freighter.app");
  });
});

// ---------------------------------------------------------------------------
// #113 — WalletStateProvider context tests
// ---------------------------------------------------------------------------

describe("WalletStateProvider (#113)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as unknown as Record<string, unknown>)["freighterApi"];
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>)["freighterApi"];
    vi.clearAllMocks();
  });

  it("starts in 'checking' status and transitions to 'unavailable' when Freighter is absent", async () => {
    render(
      <WalletStateProvider>
        <WalletStateConsumer />
      </WalletStateProvider>
    );

    // Initially checking
    expect(screen.getByTestId("availability-status")).toHaveTextContent(
      "checking"
    );
    expect(screen.getByTestId("is-checking")).toHaveTextContent("true");

    // Advance past the 100ms detection timeout
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByTestId("availability-status")).toHaveTextContent(
      "unavailable"
    );
    expect(screen.getByTestId("is-checking")).toHaveTextContent("false");
    expect(screen.getByTestId("is-available")).toHaveTextContent("false");
  });

  it("displays the setup instruction fallback message when wallet is missing", async () => {
    render(
      <WalletStateProvider>
        <WalletStateConsumer />
      </WalletStateProvider>
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    const instruction = screen.getByTestId("setup-instruction");
    expect(instruction).not.toHaveTextContent("none");
    expect(instruction).toHaveTextContent(/Freighter/i);
    expect(instruction).toHaveTextContent(/install/i);
  });

  it("transitions to 'available' and clears setup instruction when Freighter is installed", async () => {
    (window as unknown as Record<string, unknown>)["freighterApi"] = {};

    render(
      <WalletStateProvider>
        <WalletStateConsumer />
      </WalletStateProvider>
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByTestId("availability-status")).toHaveTextContent(
      "available"
    );
    expect(screen.getByTestId("is-available")).toHaveTextContent("true");
    expect(screen.getByTestId("setup-instruction")).toHaveTextContent("none");
  });

  it("recheckAvailability re-runs the detection", async () => {
    render(
      <WalletStateProvider>
        <WalletStateConsumer />
      </WalletStateProvider>
    );

    // First check — no extension
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByTestId("availability-status")).toHaveTextContent(
      "unavailable"
    );

    // Simulate extension being installed between checks
    (window as unknown as Record<string, unknown>)["freighterApi"] = {};

    // Trigger recheck
    await act(async () => {
      screen.getByTestId("recheck-btn").click();
    });

    // Back to checking during the debounce window
    expect(screen.getByTestId("availability-status")).toHaveTextContent(
      "checking"
    );

    // Advance past the timeout
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByTestId("availability-status")).toHaveTextContent(
      "available"
    );
    expect(screen.getByTestId("setup-instruction")).toHaveTextContent("none");
  });

  it("isChecking is true only while the check is in progress", async () => {
    render(
      <WalletStateProvider>
        <WalletStateConsumer />
      </WalletStateProvider>
    );

    expect(screen.getByTestId("is-checking")).toHaveTextContent("true");

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByTestId("is-checking")).toHaveTextContent("false");
  });

  it("setup instruction is null when wallet is available", async () => {
    (window as unknown as Record<string, unknown>)["freighterApi"] = {
      version: "1.0",
    };

    render(
      <WalletStateProvider>
        <WalletStateConsumer />
      </WalletStateProvider>
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByTestId("setup-instruction")).toHaveTextContent("none");
  });

  it("renders children regardless of wallet availability", async () => {
    render(
      <WalletStateProvider>
        <p data-testid="child-content">Hello world</p>
      </WalletStateProvider>
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
function renderWallet() {
  return render(
    <ToastProvider>
      <WalletProvider>
        <WalletHarness />
      </WalletProvider>
    </ToastProvider>
  );
}

describe("wallet_state_context / WalletContext (#122)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    kitState.getNetwork.mockResolvedValue({
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("connect() sets the address on success", async () => {
    kitState.authModal.mockResolvedValue({ address: "GCONNECTED" });
    renderWallet();

    screen.getByText("connect").click();

    await waitFor(() => {
      expect(screen.getByTestId("address")).toHaveTextContent("GCONNECTED");
    });
  });

  it("connect() leaves the address unset and logs a warning block on failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    kitState.authModal.mockRejectedValue(new Error("user rejected"));
    renderWallet();

    screen.getByText("connect").click();

    await waitFor(() => {
      expect(screen.getByTestId("address")).toHaveTextContent("none");
    });
    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("[wallet_state_context]");
    expect(logged).toContain("--- stack trace ---");
    warnSpy.mockRestore();
  });

  it("disconnect() clears the address", async () => {
    kitState.authModal.mockResolvedValue({ address: "GCONNECTED" });
    kitState.disconnect.mockResolvedValue(undefined);
    renderWallet();

    screen.getByText("connect").click();
    await waitFor(() => {
      expect(screen.getByTestId("address")).toHaveTextContent("GCONNECTED");
    });

    screen.getByText("disconnect").click();

    await waitFor(() => {
      expect(screen.getByTestId("address")).toHaveTextContent("none");
    });
  });

  it("signTransaction() throws when no wallet is connected", async () => {
    renderWallet();

    await act(async () => {
      screen.getByText("sign").click();
    });

    expect(kitState.signTransaction).not.toHaveBeenCalled();
  });

  it("toggles the wallet loader around connect()", async () => {
    let resolveAuth: (value: { address: string }) => void = () => {};
    kitState.authModal.mockReturnValue(
      new Promise((resolve) => {
        resolveAuth = resolve;
      })
    );
    renderWallet();

    expect(isWalletLoading()).toBe(false);
    screen.getByText("connect").click();

    await waitFor(() => {
      expect(isWalletLoading()).toBe(true);
    });

    resolveAuth({ address: "GCONNECTED" });

    await waitFor(() => {
      expect(isWalletLoading()).toBe(false);
    });
  });

  it("sets isConnecting true during connect() and false once settled", async () => {
    let resolveAuth: (value: { address: string }) => void = () => {};
    kitState.authModal.mockReturnValue(
      new Promise((resolve) => {
        resolveAuth = resolve;
      })
    );
    renderWallet();

    screen.getByText("connect").click();
    await waitFor(() => {
      expect(screen.getByTestId("is-connecting")).toHaveTextContent("true");
    });

    resolveAuth({ address: "GCONNECTED" });

    await waitFor(() => {
      expect(screen.getByTestId("is-connecting")).toHaveTextContent("false");
    });
  });

  it("assembleMultiSigTransaction resolves with the assembly summary for a valid split set", async () => {
    renderWallet();

    screen.getByText("assemble-multisig-ok").click();

    await waitFor(() => {
      expect(screen.getByTestId("multisig-result")).toHaveTextContent("ok:2:2");
    });
  });

  it("assembleMultiSigTransaction rejects and logs a warning block below the signer threshold", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWallet();

    screen.getByText("assemble-multisig-fail").click();

    await waitFor(() => {
      expect(screen.getByTestId("multisig-result")).toHaveTextContent(
        "error:Multi-sig assembly has 1 unique signature(s); minimum required is 2."
      );
    });
    const logged = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("[wallet_state_context]");
    expect(logged).toContain("--- stack trace ---");
    warnSpy.mockRestore();
  });
});
