import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import {
  Keypair, PublicKey, SystemProgram, VersionedTransaction,
  type Connection,
} from "@solana/web3.js";

import {
  NATIVE_MINT, PUMP_BONDING_CURVE_DISCRIMINATOR,
  PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID, PUMP_SHARING_CONFIG_DISCRIMINATOR,
  creatorVaultPda, feeSharingConfigPda,
} from "../../protocol/pump-devnet-verification.ts";
import {
  prepareRewardPayerPumpFeeCollection,
  signRewardPayerPumpFeeCollection,
  verifyFinalizedRewardPayerPumpFeeCollection,
} from "./reward-payer-pump-fee.ts";

function fixture(complete = false) {
  const rewardSigner = Keypair.generate();
  const buyback = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const sharingAddress = feeSharingConfigPda(mint);
  const curve = Buffer.alloc(125);
  curve.set(PUMP_BONDING_CURVE_DISCRIMINATOR);
  curve[48] = Number(complete);
  curve.set(sharingAddress.toBytes(), 49);
  curve.set(NATIVE_MINT.toBytes(), 83);
  const sharing = Buffer.alloc(148);
  sharing.set(PUMP_SHARING_CONFIG_DISCRIMINATOR);
  sharing[9] = 2;
  sharing[10] = 1;
  sharing.set(mint.toBytes(), 11);
  sharing[75] = 1;
  sharing.writeUInt32LE(2, 76);
  sharing.set(rewardSigner.publicKey.toBytes(), 80);
  sharing.writeUInt16LE(8_000, 112);
  sharing.set(buyback.toBytes(), 114);
  sharing.writeUInt16LE(2_000, 146);
  const curveAccount = { data: curve, executable: false, lamports: 1,
    owner: PUMP_PROGRAM_ID, rentEpoch: 0 };
  const sharingAccount = { data: sharing, executable: false, lamports: 1,
    owner: PUMP_FEE_PROGRAM_ID, rentEpoch: 0 };
  const connection = {
    async getMultipleAccountsInfoAndContext(keys: PublicKey[], commitment: string) {
      assert.equal(commitment, "finalized");
      assert.equal(keys[0].toBase58().length > 0, true);
      return { context: { slot: 100 }, value: [curveAccount, sharingAccount] };
    },
    async getLatestBlockhashAndContext() {
      return { context: { slot: 101 }, value: {
        blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 200,
      } };
    },
    async getFeeForMessage() {
      return { context: { slot: 101 }, value: 5_000 };
    },
    async simulateTransaction(transaction: VersionedTransaction) {
      assert.ok(transaction.signatures[0].every((byte) => byte === 0));
      return { context: { slot: 102 }, value: { err: null, unitsConsumed: 80_000 } };
    },
  } as unknown as Connection;
  return {
    rewardSigner, buyback, mint, curve, sharing, connection,
    input: {
      connection, mint: mint.toBase58(),
      rewardTreasury: rewardSigner.publicKey.toBase58(),
      buybackTreasury: buyback.toBase58(),
    },
  };
}

function receiptFor(signed: ReturnType<typeof signRewardPayerPumpFeeCollection>) {
  const tx = VersionedTransaction.deserialize(Buffer.from(signed.signedTransactionBase64, "base64"));
  const keys = tx.message.staticAccountKeys.map((key) => key.toBase58());
  const preBalances = keys.map(() => 1_000_000);
  const postBalances = preBalances.slice();
  postBalances[keys.indexOf(signed.rewardTreasury)] += 3_000;
  postBalances[keys.indexOf(signed.buybackTreasury)] += 2_000;
  const vault = creatorVaultPda(feeSharingConfigPda(new PublicKey(signed.mint))).toBase58();
  postBalances[keys.indexOf(vault)] -= 10_000;
  return {
    slot: 150, confirmationStatus: "finalized" as const,
    transactionBase64: signed.signedTransactionBase64,
    meta: { err: null, fee: 5_000, preBalances, postBalances,
      loadedAddresses: { writable: [], readonly: [] } },
  };
}

test("prepares exact permissionless Pump 80/20 message and signs only matching reward treasury", async () => {
  const setup = fixture();
  const plan = await prepareRewardPayerPumpFeeCollection(setup.input);
  assert.equal(plan.kind, "pump_v2_reward_payer");
  assert.equal(plan.estimatedNetworkFeeLamports, 5_000);
  const unsigned = VersionedTransaction.deserialize(Buffer.from(plan.unsignedTransactionBase64, "base64"));
  assert.equal(unsigned.message.header.numRequiredSignatures, 1);
  assert.equal(unsigned.message.staticAccountKeys[0].toBase58(), setup.input.rewardTreasury);
  assert.equal(unsigned.message.addressTableLookups.length, 0);
  const signed = signRewardPayerPumpFeeCollection({
    plan, signer: setup.rewardSigner,
    configuredMint: setup.input.mint,
    configuredRewardTreasury: setup.input.rewardTreasury,
    configuredBuybackTreasury: setup.input.buybackTreasury,
    finalizedBlockHeight: 150,
  });
  assert.ok(signed.sourceSignature.length > 70);
  const verified = verifyFinalizedRewardPayerPumpFeeCollection({
    signed, receipt: receiptFor(signed),
  });
  assert.equal(verified.rewardGrossLamports, "8000");
  assert.equal(verified.rewardNetLamports, "3000");
  assert.equal(verified.buybackLamports, "2000");
  assert.equal(verified.networkFeeLamports, "5000");
});

test("rejects an altered route, a different signer, a stale blockhash, and extra instruction", async () => {
  const setup = fixture();
  const plan = await prepareRewardPayerPumpFeeCollection(setup.input);
  const args = {
    plan, signer: setup.rewardSigner,
    configuredMint: setup.input.mint,
    configuredRewardTreasury: setup.input.rewardTreasury,
    configuredBuybackTreasury: setup.input.buybackTreasury,
    finalizedBlockHeight: 150,
  };
  assert.throws(() => signRewardPayerPumpFeeCollection({
    ...args, configuredBuybackTreasury: Keypair.generate().publicKey.toBase58(),
  }), /signing_scope_invalid/);
  assert.throws(() => signRewardPayerPumpFeeCollection({
    ...args, signer: Keypair.generate(),
  }), /signing_scope_invalid/);
  assert.throws(() => signRewardPayerPumpFeeCollection({
    ...args, finalizedBlockHeight: 201,
  }), /signing_scope_invalid/);
  const tampered = VersionedTransaction.deserialize(Buffer.from(plan.unsignedTransactionBase64, "base64"));
  tampered.message.compiledInstructions[0].data = SystemProgram.transfer({
    fromPubkey: setup.rewardSigner.publicKey,
    toPubkey: setup.buyback,
    lamports: 100,
  }).data;
  assert.throws(() => signRewardPayerPumpFeeCollection({
    ...args, plan: { ...plan, unsignedTransactionBase64: Buffer.from(tampered.serialize()).toString("base64") },
  }), /instruction_effects_invalid/);
});

test("rejects nonfinalized or altered receipts and 80/20 net/gross confusion", async () => {
  const setup = fixture();
  const plan = await prepareRewardPayerPumpFeeCollection(setup.input);
  const signed = signRewardPayerPumpFeeCollection({
    plan, signer: setup.rewardSigner,
    configuredMint: setup.input.mint,
    configuredRewardTreasury: setup.input.rewardTreasury,
    configuredBuybackTreasury: setup.input.buybackTreasury,
    finalizedBlockHeight: 150,
  });
  const valid = receiptFor(signed);
  assert.throws(() => verifyFinalizedRewardPayerPumpFeeCollection({
    signed, receipt: { ...valid, confirmationStatus: "confirmed" as "finalized" },
  }), /finality_or_fee_invalid/);
  const wrongTx = receiptFor(signed);
  wrongTx.transactionBase64 = Buffer.from("wrong transaction").toString("base64");
  assert.throws(() => verifyFinalizedRewardPayerPumpFeeCollection({
    signed, receipt: wrongTx,
  }), /receipt_transaction_invalid|transaction_mismatch/);
  const wrongRatio = receiptFor(signed);
  const index = VersionedTransaction.deserialize(Buffer.from(signed.signedTransactionBase64, "base64"))
    .message.staticAccountKeys.findIndex((key) => key.toBase58() === signed.buybackTreasury);
  wrongRatio.meta.postBalances[index] += 1_000;
  assert.throws(() => verifyFinalizedRewardPayerPumpFeeCollection({
    signed, receipt: wrongRatio,
  }), /balance_conservation_invalid|80_20_invalid/);
});

test("requires finalized immutable V2 shares and supports graduated AMM sweep", async () => {
  const setup = fixture(true);
  const plan = await prepareRewardPayerPumpFeeCollection(setup.input);
  assert.equal(plan.sweptAmm, true);
  setup.sharing[75] = 0;
  await assert.rejects(() => prepareRewardPayerPumpFeeCollection(setup.input),
    /immutable_80_20_route_invalid/);
});
