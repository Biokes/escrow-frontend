"use client";

import { useCallback, useMemo } from "react";
import {
  assembleMultiSigTransaction,
  createMultiSigAssemblyPlan,
  parseLedgerTransactionStructure,
  splitMultiSigTransactionParts,
  validateMultiSigParts,
  type LedgerMultiSigPart,
} from "@/app/lib/ledger_usb_bridge";

/**
 * React hook helpers for assembling multi-signature Ledger transactions.
 */
export function useLedgerMultiSigAssembly(networkPassphrase: string) {
  const parseStructure = useCallback(
    (transactionXdr: string) =>
      parseLedgerTransactionStructure(transactionXdr, networkPassphrase),
    [networkPassphrase]
  );

  const assemble = useCallback(
    (baseXdr: string, parts: LedgerMultiSigPart[]) =>
      assembleMultiSigTransaction(baseXdr, parts, networkPassphrase),
    [networkPassphrase]
  );

  const planAssembly = useCallback(
    (baseXdr: string, signerPublicKeys: string[]) =>
      createMultiSigAssemblyPlan(baseXdr, signerPublicKeys, networkPassphrase),
    [networkPassphrase]
  );

  const splitParts = useCallback(
    (signedXdr: string, signerPublicKeys: string[]) =>
      splitMultiSigTransactionParts(
        signedXdr,
        signerPublicKeys,
        networkPassphrase
      ),
    [networkPassphrase]
  );

  const validateParts = useCallback(
    (parts: LedgerMultiSigPart[]) =>
      validateMultiSigParts(parts, networkPassphrase),
    [networkPassphrase]
  );

  return useMemo(
    () => ({
      parseStructure,
      assemble,
      planAssembly,
      splitParts,
      validateParts,
    }),
    [parseStructure, assemble, planAssembly, splitParts, validateParts]
  );
}
