import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { buildSolanaRewardAccountTransaction } from "./solana-reward-account.ts";

const wallet = new PublicKey("11111111111111111111111111111111");
const mint = new PublicKey("So11111111111111111111111111111111111111112");
const blockhash = "11111111111111111111111111111111";

for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
  test(`recipient pays for only an idempotent ${tokenProgram.toBase58()} ATA creation`, () => {
    const { transaction, tokenAccount } = buildSolanaRewardAccountTransaction({
      walletAddress: wallet.toBase58(), rewardMint: mint.toBase58(), tokenProgram, blockhash,
    });
    assert.equal(transaction.feePayer?.toBase58(), wallet.toBase58());
    assert.equal(transaction.recentBlockhash, blockhash);
    assert.equal(transaction.instructions.length, 1);
    const instruction = transaction.instructions[0];
    assert.equal(instruction.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    assert.deepEqual([...instruction.data], [1]);
    assert.equal(instruction.keys[0].pubkey.toBase58(), wallet.toBase58());
    assert.equal(instruction.keys[0].isSigner, true);
    assert.equal(instruction.keys[0].isWritable, true);
    assert.equal(instruction.keys[1].pubkey.toBase58(), tokenAccount.toBase58());
    assert.equal(instruction.keys[2].pubkey.toBase58(), wallet.toBase58());
    assert.equal(instruction.keys[3].pubkey.toBase58(), mint.toBase58());
    assert.equal(instruction.keys[5].pubkey.toBase58(), tokenProgram.toBase58());
    assert.equal(tokenAccount.toBase58(), getAssociatedTokenAddressSync(
      mint, wallet, false, tokenProgram,
    ).toBase58());
  });
}

test("rejects unsupported token programs before constructing a transaction", () => {
  assert.throws(() => buildSolanaRewardAccountTransaction({
    walletAddress: wallet.toBase58(), rewardMint: mint.toBase58(),
    tokenProgram: PublicKey.unique(), blockhash,
  }), /Unsupported Fan Token program/);
});
