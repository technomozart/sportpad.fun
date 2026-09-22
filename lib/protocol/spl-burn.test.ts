import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./pump-devnet-verification.ts";
import { associatedTokenAddress, buildSplBurnInstruction } from "./spl-burn.ts";

function key(byte: number) {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte));
}

test("builds an exact SPL burn instruction for classic and Token-2022 mints", () => {
  for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const mint = key(1);
    const owner = key(2);
    const instruction = buildSplBurnInstruction({ mint, owner, amountAtomic: 123456789n, tokenProgram });
    assert.equal(instruction.programId.toBase58(), tokenProgram.toBase58());
    assert.equal(instruction.keys[0].pubkey.toBase58(), associatedTokenAddress(mint, owner, tokenProgram).toBase58());
    assert.equal(instruction.keys[0].isWritable, true);
    assert.equal(instruction.keys[1].pubkey.toBase58(), mint.toBase58());
    assert.equal(instruction.keys[2].pubkey.toBase58(), owner.toBase58());
    assert.equal(instruction.keys[2].isSigner, true);
    assert.equal(instruction.data[0], 8);
    assert.equal(new DataView(instruction.data.buffer, instruction.data.byteOffset, instruction.data.byteLength).getBigUint64(1, true), 123456789n);
  }
});

test("rejects invalid burn amounts and programs", () => {
  assert.throws(() => buildSplBurnInstruction({ mint: key(3), owner: key(4), amountAtomic: 0n, tokenProgram: TOKEN_PROGRAM_ID }), /burn amount/);
  assert.throws(() => associatedTokenAddress(key(3), key(4), key(5)), /supported SPL token program/);
});
