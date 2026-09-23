import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { proveExpiredBuybackBurnAbsent } from "./buyback-expiry-proof.ts";

const terms = {
  sourceAta: new PublicKey("11111111111111111111111111111111"),
  sourceSwapSignature: "source-swap",
  burnSignature: "old-burn",
  burnBlockhash: "old-blockhash",
  lastValidBlockHeight: 100,
};

function rpc(overrides: Record<string, unknown> = {}) {
  const reader = {
    getBlockHeight: async () => 101,
    isBlockhashValid: async () => ({ value: false }),
    getSignatureStatuses: async () => ({ value: [null] }),
    getTransaction: async () => null,
    getSignaturesForAddress: async () => [
      { signature: "newer-transaction" }, { signature: "source-swap" },
    ],
    ...overrides,
  };
  return reader as unknown as Parameters<typeof proveExpiredBuybackBurnAbsent>[0];
}

test("expired burn replacement requires finalized source-ATA history through the swap", async () => {
  assert.equal(await proveExpiredBuybackBurnAbsent(rpc(), terms), true);
  let pages = 0;
  const paginated = rpc({ getSignaturesForAddress: async () => {
    pages += 1;
    return pages === 1
      ? Array.from({ length: 1000 }, (_, index) => ({ signature: `newer-${index}` }))
      : [{ signature: "source-swap" }];
  } });
  assert.equal(await proveExpiredBuybackBurnAbsent(paginated, terms), true);
  assert.equal(pages, 2);
});

test("never replace a burn while blockhash or chain evidence is ambiguous", async () => {
  const failures = [
    rpc({ getBlockHeight: async () => 100 }),
    rpc({ isBlockhashValid: async () => ({ value: true }) }),
    rpc({ getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "finalized" }] }) }),
    rpc({ getTransaction: async () => ({ meta: {} }) }),
    rpc({ getSignaturesForAddress: async () => [{ signature: "old-burn" },
      { signature: "source-swap" }] }),
    rpc({ getSignaturesForAddress: async () => [{ signature: "other" }] }),
  ];
  for (const reader of failures) {
    await assert.rejects(() => proveExpiredBuybackBurnAbsent(reader, terms));
  }
});
