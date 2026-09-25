import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import { verifyCanarySignedIntent } from "./chiliz-sol-chz-canary-intent.ts";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const payer = Keypair.generate();
  const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const recentBlockhash = Keypair.generate().publicKey.toBase58();
  const instruction = createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey, ata, payer.publicKey, mint, TOKEN_PROGRAM_ID);
  const message = new TransactionMessage({ payerKey: payer.publicKey,
    recentBlockhash, instructions: [instruction] }).compileToV0Message();
  const unsigned = new VersionedTransaction(message);
  const unsignedTransactionBase64 = Buffer.from(unsigned.serialize()).toString("base64");
  const signed = new VersionedTransaction(message);
  signed.sign([payer]);
  const signedBytes = Buffer.from(signed.serialize());
  const transactionMessageHash = hash(message.serialize());
  const plan = {
    rewardTreasury: payer.publicKey.toBase58(),
    officialChzMint: mint.toBase58(), tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    outputAta: ata.toBase58(), ataRentLamports: "2000000",
    estimatedNetworkFeeLamports: "5000", maximumSetupSpendLamports: "2050000",
    minimumRemainingSolLamports: "5000000", sourceBalanceLamports: "50000000",
    accountSlot: 1, blockhashSlot: 2, recentBlockhash,
    lastValidBlockHeight: 200,
    unsignedTransactionBase64, transactionMessageHash, executionReady: false as const,
  };
  return { payer, plan, signed: { plan,
    signedTransactionBase64: signedBytes.toString("base64"),
    signedTransactionSha256: hash(signedBytes), transactionMessageHash,
    sourceSignature: bs58.encode(signed.signatures[0]), executionReady: false as const },
    connection: { getBlockHeight: async () => 100,
      getMultipleAccountsInfoAndContext: async () => { throw new Error("not needed"); } } };
}

test("signed canary ATA is bound to exact instruction, signer, and cap", async () => {
  const value = fixture();
  const verified = await verifyCanarySignedIntent({
    operation: "ata_setup", configuredRewardTreasury: value.payer.publicKey.toBase58(),
    signed: value.signed, connection: value.connection as never,
  });
  assert.equal(verified.maximumSpendLamports, 2_050_000);
  assert.equal(verified.sourceSignature, value.signed.sourceSignature);
  assert.equal(verified.inputLamports, 0);
});

test("signed canary rejects wrong treasury, altered bounds, and stale blockhash", async () => {
  const value = fixture();
  await assert.rejects(verifyCanarySignedIntent({ operation: "ata_setup",
    configuredRewardTreasury: Keypair.generate().publicKey.toBase58(),
    signed: value.signed, connection: value.connection as never }),
  /chz_canary_intent_signed_message_identity_invalid/);
  const altered = { ...value.signed, plan: { ...value.plan,
    maximumSetupSpendLamports: "3000000" } };
  await assert.rejects(verifyCanarySignedIntent({ operation: "ata_setup",
    configuredRewardTreasury: value.payer.publicKey.toBase58(),
    signed: altered, connection: value.connection as never }),
  /chz_canary_intent_ata_plan_invalid/);
  await assert.rejects(verifyCanarySignedIntent({ operation: "ata_setup",
    configuredRewardTreasury: value.payer.publicKey.toBase58(),
    signed: value.signed, connection: { ...value.connection,
      getBlockHeight: async () => 200 } as never }),
  /chz_canary_intent_plan_blockhash_or_expiry_invalid/);
});
