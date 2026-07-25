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
  });
});
