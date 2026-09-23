import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { captureClaimHistoryAnchor, proveExpiredClaimTransferAbsent } from "./claim-expiry-proof.ts";

const sourceAta = new PublicKey("11111111111111111111111111111111");
const terms = { sourceAta, anchorSignature: "anchor", claimSignature: "claim",
  claimBlockhash: "expired-blockhash", lastValidBlockHeight: 100 };

function fakeRpc(options: {
  height?: number; blockhashValid?: boolean; status?: object | null;
  receipt?: object | null; lateStatus?: object | null;
  receiptAfterHistory?: object | null; pages?: Array<Array<{
    signature: string; slot: number; err: null | object;
    confirmationStatus: "finalized" | "confirmed";
  }>>;
} = {}) {
  let page = 0;
  let statusCalls = 0;
  let receiptCalls = 0;
  return {
    getBlockHeight: async () => options.height ?? 101,
    isBlockhashValid: async () => ({ value: options.blockhashValid ?? false }),
    getSignatureStatuses: async () => ({ value: [++statusCalls > 1
      ? options.lateStatus ?? options.status ?? null : options.status ?? null] }),
    getTransaction: async () => ++receiptCalls > 1
      ? options.receiptAfterHistory ?? options.receipt ?? null : options.receipt ?? null,
    getSignaturesForAddress: async () => (options.pages ?? [
      [{ signature: "newer", slot: 20, err: null, confirmationStatus: "finalized" },
        { signature: "anchor", slot: 10, err: null, confirmationStatus: "finalized" }],
    ])[page++] ?? [],
  } as unknown as Parameters<typeof proveExpiredClaimTransferAbsent>[0];
}

test("expired claim absent through pre-broadcast source history anchor", async () => {
  assert.equal(await proveExpiredClaimTransferAbsent(fakeRpc(), terms), true);
});

test("claim expiry proof refuses live blockhash, status, or receipt", async () => {
  await assert.rejects(proveExpiredClaimTransferAbsent(fakeRpc({ height: 100 }), terms),
    /claim_blockhash_not_expired/);
  await assert.rejects(proveExpiredClaimTransferAbsent(fakeRpc({ blockhashValid: true }), terms),
    /claim_expiry_receipt_ambiguous/);
  await assert.rejects(proveExpiredClaimTransferAbsent(fakeRpc({ status: { err: null } }), terms),
    /claim_expiry_receipt_ambiguous/);
  await assert.rejects(proveExpiredClaimTransferAbsent(fakeRpc({ receipt: {} }), terms),
    /claim_expiry_receipt_ambiguous/);
});

test("claim expiry proof refuses missing, present, and ambiguous history", async () => {
  await assert.rejects(proveExpiredClaimTransferAbsent(fakeRpc({ pages: [[
    { signature: "newer", slot: 20, err: null, confirmationStatus: "finalized" },
  ]] }), terms), /claim_history_incomplete/);
  await assert.rejects(proveExpiredClaimTransferAbsent(fakeRpc({ pages: [[
    { signature: "claim", slot: 20, err: null, confirmationStatus: "finalized" },
    { signature: "anchor", slot: 10, err: null, confirmationStatus: "finalized" },
  ]] }), terms), /claim_in_finalized_history/);
  await assert.rejects(proveExpiredClaimTransferAbsent(fakeRpc({ pages: [[
    { signature: "newer", slot: 20, err: null, confirmationStatus: "confirmed" },
    { signature: "anchor", slot: 10, err: null, confirmationStatus: "finalized" },
  ]] }), terms), /claim_history_ambiguous/);
});

test("claim receipt appearing during history scan blocks replacement", async () => {
  await assert.rejects(proveExpiredClaimTransferAbsent(fakeRpc({
    lateStatus: { slot: 20, err: null, confirmationStatus: "finalized" },
  }), terms), /claim_expiry_late_receipt_ambiguous/);
});

test("claim anchor capture requires finalized, matching status", async () => {
  const anchor = { signature: "anchor", slot: 10, err: null,
    confirmationStatus: "finalized" as const };
  const rpc = fakeRpc({ status: { slot: 10, err: null, confirmationStatus: "finalized" },
    pages: [[anchor]] });
  assert.equal(await captureClaimHistoryAnchor(rpc, sourceAta), "anchor");
  await assert.rejects(captureClaimHistoryAnchor(fakeRpc({ pages: [[]] }), sourceAta),
    /claim_history_anchor_unavailable/);
  await assert.rejects(captureClaimHistoryAnchor(fakeRpc({ pages: [[anchor]] }), sourceAta),
    /claim_history_anchor_unverified/);
});
