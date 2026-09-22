import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";

import {
  COMPUTE_BUDGET_PROGRAM_ID,
  verifyPumpFeeDistributions,
  type FinalizedSolanaTransaction,
} from "./pump-fee-distribution.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR,
  PUMP_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  bondingCurvePda,
  creatorVaultPda,
  feeSharingConfigPda,
  pumpEventAuthorityPda,
} from "./pump-devnet-verification.ts";

function key(byte: number) {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte)).toBase58();
}

const mint = key(21);
const reward = key(22);
const buyback = key(23);
const payer = key(24);

function fixture(): FinalizedSolanaTransaction {
  const mintKey = new PublicKey(mint);
  const sharing = feeSharingConfigPda(mintKey);
  const keys = [
    payer,
    mint,
    bondingCurvePda(mintKey).toBase58(),
    sharing.toBase58(),
    creatorVaultPda(sharing).toBase58(),
    SystemProgram.programId.toBase58(),
    pumpEventAuthorityPda().toBase58(),
    PUMP_PROGRAM_ID.toBase58(),
    key(25),
    NATIVE_MINT.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    reward,
    buyback,
    COMPUTE_BUDGET_PROGRAM_ID,
  ];
  const preBalances = keys.map(() => 1_000_000);
  const postBalances = [...preBalances];
  postBalances[12] += 800;
  postBalances[13] += 200;
  return {
    slot: 123,
    meta: { err: null, preBalances, postBalances, loadedAddresses: { writable: [], readonly: [] } },
    transaction: {
      signatures: ["finalized-signature"],
      message: {
        accountKeys: keys,
        instructions: [
          { programIdIndex: 14, accounts: [], data: bs58.encode(Uint8Array.of(1)) },
          {
            programIdIndex: 7,
            accounts: Array.from({ length: 14 }, (_, index) => index),
            data: bs58.encode(Uint8Array.from([...PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR, 0])),
          },
        ],
      },
    },
  };
}

test("verifies an exact finalized Pump 80/20 distribution", () => {
  assert.deepEqual(verifyPumpFeeDistributions({ transaction: fixture(), mint, rewardTreasury: reward, buybackTreasury: buyback }), [{
    signature: "finalized-signature",
    instructionIndex: 1,
    slot: 123,
    grossAmountAtomic: "1000",
    rewardAmountAtomic: "800",
    buybackAmountAtomic: "200",
  }]);
});

test("accepts Pump's one-lamport share rounding residue", () => {
  const transaction = fixture();
  transaction.meta!.postBalances[12] = transaction.meta!.preBalances[12] + 801;
  transaction.meta!.postBalances[13] = transaction.meta!.preBalances[13] + 200;
  const [result] = verifyPumpFeeDistributions({ transaction, mint, rewardTreasury: reward, buybackTreasury: buyback });
  assert.equal(result.grossAmountAtomic, "1001");
});

test("ignores finalized transactions without the distribution discriminator", () => {
  const transaction = fixture();
  transaction.transaction.message.instructions[1].data = bs58.encode(Uint8Array.of(1, 2, 3));
  assert.deepEqual(verifyPumpFeeDistributions({ transaction, mint, rewardTreasury: reward, buybackTreasury: buyback }), []);
});

test("rejects a failed transaction", () => {
  const transaction = fixture();
  transaction.meta!.err = { InstructionError: [1, "Custom"] };
  assert.throws(() => verifyPumpFeeDistributions({ transaction, mint, rewardTreasury: reward, buybackTreasury: buyback }), /did not finalize/);
});

test("rejects wrong mint, config, recipient order, or split", () => {
  const wrongMint = fixture();
  wrongMint.transaction.message.accountKeys[1] = key(31);
  assert.throws(() => verifyPumpFeeDistributions({ transaction: wrongMint, mint, rewardTreasury: reward, buybackTreasury: buyback }), /mint/);

  const wrongConfig = fixture();
  wrongConfig.transaction.message.accountKeys[3] = key(32);
  assert.throws(() => verifyPumpFeeDistributions({ transaction: wrongConfig, mint, rewardTreasury: reward, buybackTreasury: buyback }), /sharing config/);

  const reversed = fixture();
  [reversed.transaction.message.accountKeys[12], reversed.transaction.message.accountKeys[13]] = [buyback, reward];
  assert.throws(() => verifyPumpFeeDistributions({ transaction: reversed, mint, rewardTreasury: reward, buybackTreasury: buyback }), /80% treasury/);

  const wrongSplit = fixture();
  wrongSplit.meta!.postBalances[12] = wrongSplit.meta!.preBalances[12] + 700;
  wrongSplit.meta!.postBalances[13] = wrongSplit.meta!.preBalances[13] + 300;
  assert.throws(() => verifyPumpFeeDistributions({ transaction: wrongSplit, mint, rewardTreasury: reward, buybackTreasury: buyback }), /80\/20/);
});

test("rejects unrelated top-level instructions and treasury payers", () => {
  const unrelated = fixture();
  unrelated.transaction.message.accountKeys.push(key(40));
  unrelated.meta!.preBalances.push(0);
  unrelated.meta!.postBalances.push(0);
  unrelated.transaction.message.instructions.push({ programIdIndex: 15, accounts: [], data: bs58.encode(Uint8Array.of(1)) });
  assert.throws(() => verifyPumpFeeDistributions({ transaction: unrelated, mint, rewardTreasury: reward, buybackTreasury: buyback }), /unapproved/);

  const treasuryPayer = fixture();
  treasuryPayer.transaction.message.accountKeys[0] = reward;
  assert.throws(() => verifyPumpFeeDistributions({ transaction: treasuryPayer, mint, rewardTreasury: reward, buybackTreasury: buyback }), /payer/);
});
