import assert from "node:assert/strict";
import test from "node:test";

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";

import { inspectPersistedSolanaClaimTransfer,
  signSolanaClaimTransfer } from "./solana-claim-transfer.mjs";

test("claim intent signs one exact transfer to the recipient ATA", () => {
  const signer = Keypair.generate();
  const mint = Keypair.generate().publicKey.toBase58();
  const destinationAddress = Keypair.generate().publicKey.toBase58();
  const signed = signSolanaClaimTransfer({ signer, mint, destinationAddress,
    tokenProgram: TOKEN_PROGRAM_ID, amountAtomic: "123456", decimals: 6,
    blockhash: Keypair.generate().publicKey.toBase58() });
  const checked = inspectPersistedSolanaClaimTransfer({
    signedTransactionBase64: signed.base64, signature: signed.signature,
    signer: signer.publicKey.toBase58(), mint, destinationAddress,
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(), amountAtomic: "123456", decimals: 6,
  });
  assert.equal(checked.transaction.instructions.length, 1);
  assert.equal(checked.source.toBase58(), signed.source.toBase58());
  assert.equal(checked.destination.toBase58(), signed.destination.toBase58());
});

test("a replay cannot change recipient, amount, signer, or mint", () => {
  const signer = Keypair.generate();
  const mint = Keypair.generate().publicKey.toBase58();
  const destinationAddress = Keypair.generate().publicKey.toBase58();
  const signed = signSolanaClaimTransfer({ signer, mint, destinationAddress,
    tokenProgram: TOKEN_PROGRAM_ID, amountAtomic: "123456", decimals: 6,
    blockhash: Keypair.generate().publicKey.toBase58() });
  const expected = { signedTransactionBase64: signed.base64, signature: signed.signature,
    signer: signer.publicKey.toBase58(), mint, destinationAddress,
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(), amountAtomic: "123456", decimals: 6 };
  for (const change of [
    { destinationAddress: Keypair.generate().publicKey.toBase58() },
    { amountAtomic: "123457" },
    { signer: Keypair.generate().publicKey.toBase58() },
    { mint: Keypair.generate().publicKey.toBase58() },
  ]) assert.throws(() => inspectPersistedSolanaClaimTransfer({ ...expected, ...change }),
    /solana_claim_intent_mismatch/);
});
