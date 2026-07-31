import { describe, expect, it, vi } from "vitest";
import {
  assembleFreighterMultiSigTransaction,
  createFreighterMultiSigSplit,
  parseFreighterMultiSigEnvelope,
  signFreighterMultiSigSplit,
  type FreighterMultiSigSplit,
} from "@/app/lib/freighter_connector";
import { WalletMultiSigStructureError } from "@/app/lib/wallet_state_context";

function toBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

describe("freighter_connector multi-sig helper hooks (#109)", () => {
  it("parseFreighterMultiSigEnvelope parses a well-formed envelope without errors", () => {
    const xdr = toBase64("a".repeat(200));
    const shape = parseFreighterMultiSigEnvelope(xdr);
    expect(shape.baseXdr).toBe(xdr);
    expect(shape.signatures).toBeGreaterThan(0);
  });

  it("parseFreighterMultiSigEnvelope throws for malformed input", () => {
    expect(() => parseFreighterMultiSigEnvelope("")).toThrow(
      WalletMultiSigStructureError
    );
  });

  it("createFreighterMultiSigSplit builds a split seeded with the base XDR", () => {
    const xdr = toBase64("x".repeat(200));
    const split = createFreighterMultiSigSplit(xdr, {
      publicKey: "GABC",
      hint: "abcd",
    });
    expect(split.baseXdr).toBe(xdr);
    expect(split.signedXdr).toBe(xdr);
    expect(split.signer).toEqual({ publicKey: "GABC", hint: "abcd" });
  });

  it("signFreighterMultiSigSplit signs the split's XDR through Freighter and records the result", async () => {
    const xdr = toBase64("x".repeat(200));
    const split = createFreighterMultiSigSplit(xdr, {
      publicKey: "GABC",
      hint: "abcd",
    });
    const signFn = vi.fn(async () => "signed-by-freighter");

    const signed = await signFreighterMultiSigSplit(split, signFn, 5_000);

    expect(signFn).toHaveBeenCalledWith(xdr);
    expect(signed.signedXdr).toBe("signed-by-freighter");
    expect(signed).toBe(split);
  });

  it("assembleFreighterMultiSigTransaction validates a coherent multi-sig assembly", async () => {
    const xdr = toBase64("x".repeat(200));
    const splitA = createFreighterMultiSigSplit(xdr, {
      publicKey: "GA",
      hint: "aaaa",
    });
    const splitB = createFreighterMultiSigSplit(xdr, {
      publicKey: "GB",
      hint: "bbbb",
    });
    await signFreighterMultiSigSplit(splitA, async () => "signed-a", 5_000);
    await signFreighterMultiSigSplit(splitB, async () => "signed-b", 5_000);

    const result = assembleFreighterMultiSigTransaction([splitA, splitB]);
    expect(result).toEqual({ uniqueSigners: 2, splitsValidated: 2 });
  });

  it("assembleFreighterMultiSigTransaction rejects duplicate signers", () => {
    const xdr = toBase64("x".repeat(200));
    const splitA = createFreighterMultiSigSplit(xdr, {
      publicKey: "GA",
      hint: "aaaa",
    });
    const splitDup: FreighterMultiSigSplit = createFreighterMultiSigSplit(
      xdr,
      { publicKey: "GA", hint: "aaaa" }
    );

    expect(() =>
      assembleFreighterMultiSigTransaction([splitA, splitDup], {
        minRequired: 1,
      })
    ).toThrow(WalletMultiSigStructureError);
  });

  it("assembleFreighterMultiSigTransaction rejects assemblies below the minimum signer threshold", () => {
    const xdr = toBase64("x".repeat(200));
    const splitA = createFreighterMultiSigSplit(xdr, {
      publicKey: "GA",
      hint: "aaaa",
    });

    try {
      assembleFreighterMultiSigTransaction([splitA]);
      throw new Error("expected assembleFreighterMultiSigTransaction to throw");
    } catch (err) {
      expect((err as WalletMultiSigStructureError).code).toBe(
        "insufficient_signatures"
      );
    }
  });
});
