import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./pump-devnet-verification.ts";
import { associatedTokenAddress } from "./spl-burn.ts";
import {
  buildCreateAssociatedTokenIdempotentInstruction,
  buildSplTransferCheckedInstruction,
} from "./spl-transfer.ts";

test("idempotent ATA creation binds payer, destination owner, mint, and token program", () => {
  const payer = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const ix = buildCreateAssociatedTokenIdempotentInstruction({ payer, owner, mint, tokenProgram: TOKEN_PROGRAM_ID });
  assert(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.deepEqual([...ix.data], [1]);
  assert(ix.keys[0].pubkey.equals(payer));
  assert(ix.keys[1].pubkey.equals(associatedTokenAddress(mint, owner, TOKEN_PROGRAM_ID)));
  assert(ix.keys[2].pubkey.equals(owner));
  assert(ix.keys[4].pubkey.equals(SystemProgram.programId));
});

test("TransferChecked encodes exact u64 atomic amount and decimals", () => {
  const sourceOwner = Keypair.generate().publicKey;
  const destinationOwner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const ix = buildSplTransferCheckedInstruction({
    mint,
    sourceOwner,
    destinationOwner,
    amountAtomic: 9_007_199_254_740_993n,
    decimals: 8,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  assert.equal(ix.data[0], 12);
  assert.equal(new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getBigUint64(1, true), 9_007_199_254_740_993n);
  assert.equal(ix.data[9], 8);
  assert(ix.keys[0].pubkey.equals(associatedTokenAddress(mint, sourceOwner, TOKEN_PROGRAM_ID)));
  assert(ix.keys[2].pubkey.equals(associatedTokenAddress(mint, destinationOwner, TOKEN_PROGRAM_ID)));
});

test("TransferChecked refuses zero and off-curve reward recipients", () => {
  const sourceOwner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  assert.throws(() => buildSplTransferCheckedInstruction({
    mint,
    sourceOwner,
    destinationOwner: Keypair.generate().publicKey,
    amountAtomic: 0n,
    decimals: 6,
    tokenProgram: TOKEN_PROGRAM_ID,
  }), /unsigned 64-bit/);
  const offCurve = PublicKey.findProgramAddressSync([Buffer.from("reward")], SystemProgram.programId)[0];
  assert.throws(() => buildSplTransferCheckedInstruction({
    mint,
    sourceOwner,
    destinationOwner: offCurve,
    amountAtomic: 1n,
    decimals: 6,
    tokenProgram: TOKEN_PROGRAM_ID,
  }), /on-curve/);
});
