import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WalletProvider,
  useWallet,
} from "@/app/context/WalletContext";
import { WalletRejectedError } from "@/app/lib/errors";
import { submitContractTransaction } from "@/app/lib/transactions";

const walletKitMocks = vi.hoisted(() => ({
  authModal: vi.fn(),
  disconnect: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  init: vi.fn(),
  setWallet: vi.fn(),
  signTransaction: vi.fn(),
}));

const showToast = vi.hoisted(() => vi.fn());

vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  Networks: { TESTNET: "TESTNET" },
  StellarWalletsKit: walletKitMocks,
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/utils", () => ({
  defaultModules: vi.fn(() => []),
}));

vi.mock("@/app/lib/contract", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

vi.mock("@/app/context/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("@/app/lib/freighter_connector", () => ({
  freighterActiveAddress: {
    clear: vi.fn(),
    setActiveAddress: vi.fn(),
  },
  verifyAndRehydrateFreighterAddress: vi.fn(),
}));

vi.mock("@/app/lib/ledger_usb_bridge", () => ({
  ledgerActiveAddresses: { clear: vi.fn() },
}));

function WalletWrapper({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

async function renderConnectedWallet() {
  const { result } = renderHook(() => useWallet(), {
    wrapper: WalletWrapper,
  });

  await act(async () => {
    await result.current.connect();
  });

  if (!result.current.address) {
    throw new Error("Test wallet did not connect");
  }

  return result;
}

describe("wallet_state_context signature rejection handling (#115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    walletKitMocks.authModal.mockResolvedValue({ address: "GTESTADDRESS" });
    walletKitMocks.getNetwork.mockResolvedValue({
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("logs and warns when the user rejects a signature request", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    walletKitMocks.signTransaction.mockRejectedValue(
      new Error("User rejected transaction")
    );
    const wallet = await renderConnectedWallet();

    await expect(
      wallet.current.signTransaction("unsigned-xdr")
    ).rejects.toBeInstanceOf(WalletRejectedError);

    expect(showToast).toHaveBeenCalledWith(
      "Signature cancelled - you rejected the request in your wallet.",
      "warning"
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[wallet_state_context] signature rejected by user:",
      "User rejected transaction"
    );
  });

  it("preserves unexpected signing failures without showing a rejection warning", async () => {
    const signingError = new Error("Wallet RPC unavailable");
    walletKitMocks.signTransaction.mockRejectedValue(signingError);
    const wallet = await renderConnectedWallet();

    await expect(wallet.current.signTransaction("unsigned-xdr")).rejects.toBe(
      signingError
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does not classify unexpected signing failures as transaction rejection", async () => {
    const signingError = new Error("Wallet RPC unavailable");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ xdr: "unsigned-xdr" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitContractTransaction({
        method: "create_job",
        args: [],
        sourceAddress: "GTESTADDRESS",
        signTransaction: vi.fn().mockRejectedValue(signingError),
      })
    ).rejects.toBe(signingError);
  });
});
