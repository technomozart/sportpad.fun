import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./pump-devnet-verification.ts";

export function associatedTokenAddress(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey) {
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("The mint is not owned by a supported SPL token program.");
  }
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function buildSplBurnInstruction({
  mint,
  owner,
  amountAtomic,
  tokenProgram,
}: {
  mint: PublicKey;
  owner: PublicKey;
  amountAtomic: bigint;
  tokenProgram: PublicKey;
}) {
  if (amountAtomic <= 0n || amountAtomic > 18_446_744_073_709_551_615n) {
    throw new Error("The burn amount must fit in an unsigned 64-bit integer.");
  }
  const data = new Uint8Array(9);
  data[0] = 8; // SPL Token Burn
  new DataView(data.buffer).setBigUint64(1, amountAtomic, true);
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: associatedTokenAddress(mint, owner, tokenProgram), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}
