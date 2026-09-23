import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";

import { proveExpiredSwapAbsent } from "./swap-expiry-proof.ts";

const treasury = Keypair.generate().publicKey;
const terms = {
  treasury, sourceFeeSignature: "fee-anchor", sourceFeeSlot: 10,
  swapSignature: "swap-attempt", swapBlockhash: "old-blockhash",
  lastValidBlockHeight: 100,
};

function rpc(overrides: Record<string, unknown> = {}) {
  return {
    getBlockHeight: async () => 101,
    isBlockhashValid: async () => ({ value: false }),
    getSignatureStatuses: async () => ({ value: [null] }),
    getTransaction: async () => null,
    getSignaturesForAddress: async () => [{
      signature: "fee-anchor", slot: 10, err: null,
      confirmationStatus: "finalized",
    }],
    ...overrides,
  } as unknown as Parameters<typeof proveExpiredSwapAbsent>[0];
}

test("expired swap absence needs finalized fee anchor in treasury history", async () => {
  assert.equal(await proveExpiredSwapAbsent(rpc(), terms), true);
  await assert.rejects(proveExpiredSwapAbsent(rpc({ getSignaturesForAddress: async () => [] }), terms),
    /history_incomplete/);
});

test("live blockhash or existing status never permits a replacement", async () => {
  await assert.rejects(proveExpiredSwapAbsent(rpc({ getBlockHeight: async () => 100 }), terms),
    /not_expired/);
  await assert.rejects(proveExpiredSwapAbsent(rpc({ isBlockhashValid: async () => ({ value: true }) }), terms),
    /receipt_ambiguous/);
  await assert.rejects(proveExpiredSwapAbsent(rpc({
    getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: "finalized" }] }),
  }), terms), /receipt_ambiguous/);
});

test("finalized swap, missing anchor, and unfinalized history fail closed", async () => {
  await assert.rejects(proveExpiredSwapAbsent(rpc({
    getSignaturesForAddress: async () => [{
      signature: "swap-attempt", slot: 12, err: null, confirmationStatus: "finalized",
    }],
  }), terms), /swap_in_finalized_history/);
  await assert.rejects(proveExpiredSwapAbsent(rpc({
    getSignaturesForAddress: async () => [{
      signature: "other", slot: 9, err: null, confirmationStatus: "finalized",
    }],
  }), terms), /swap_fee_anchor_missing/);
  await assert.rejects(proveExpiredSwapAbsent(rpc({
    getSignaturesForAddress: async () => [{
      signature: "fee-anchor", slot: 10, err: null, confirmationStatus: "confirmed",
    }],
  }), terms), /history_ambiguous/);
});

test("a receipt appearing while history is scanned blocks replacement", async () => {
  let calls = 0;
  await assert.rejects(proveExpiredSwapAbsent(rpc({
    getSignatureStatuses: async () => ({ value: [++calls === 1 ? null :
      { err: null, confirmationStatus: "finalized" }] }),
  }), terms), /late_receipt_ambiguous/);
});
