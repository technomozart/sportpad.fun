import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import {
  classifyUnindexedDevnetTransaction,
  normalizeTransactionSignature,
  validateDevnetRecipients,
} from "./devnet-launch.ts";

const address = () => bs58.encode(crypto.getRandomValues(new Uint8Array(32)));

test("accepts a canonical 64-byte Solana transaction signature", () => {
  const signature = bs58.encode(crypto.getRandomValues(new Uint8Array(64)));
  assert.equal(normalizeTransactionSignature(signature), signature);
  assert.equal(normalizeTransactionSignature("bad"), null);
});

test("requires two distinct valid fee recipients", () => {
  const creator = address();
  const reward = address();
  const burn = address();
  assert.deepEqual(validateDevnetRecipients(reward, burn, creator), {
    ok: true,
    rewardWallet: reward,
    burnWallet: burn,
    creatorWallet: creator,
  });
  assert.equal(validateDevnetRecipients(reward, reward, creator).ok, false);
  assert.equal(validateDevnetRecipients(creator, burn, creator).ok, false);
  assert.equal(validateDevnetRecipients(reward, creator, creator).ok, false);
  assert.equal(validateDevnetRecipients("bad", burn, creator).ok, false);
});

test("does not expire a landed transaction while finalized indexing catches up", () => {
  assert.equal(classifyUnindexedDevnetTransaction({
    signatureStatus: { err: null },
    blockhashValid: false,
  }), "pending");
  assert.equal(classifyUnindexedDevnetTransaction({
    signatureStatus: null,
    blockhashValid: false,
    invalidityGraceElapsed: true,
  }), "expired");
  assert.equal(classifyUnindexedDevnetTransaction({
    signatureStatus: null,
    blockhashValid: true,
  }), "pending");
  assert.equal(classifyUnindexedDevnetTransaction({
    signatureStatus: null,
    blockhashValid: false,
  }), "pending");
  assert.equal(classifyUnindexedDevnetTransaction({
    signatureStatus: { err: { InstructionError: [0, "Custom"] } },
    blockhashValid: true,
  }), "failed");
});
