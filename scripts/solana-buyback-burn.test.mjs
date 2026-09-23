import assert from "node:assert/strict";
import test from "node:test";

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, Transaction } from "@solana/web3.js";

import { inspectPersistedBuybackBurn, signBuybackBurn } from "./solana-buyback-burn.mjs";

test("a prepared burn is one signed instruction for the exact ATA and amount", () => {
  const signer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const blockhash = Keypair.generate().publicKey.toBase58();
  const burn = signBuybackBurn({ signer, mint, tokenProgram: TOKEN_PROGRAM_ID,
    amountAtomic: 42n, decimals: 6, blockhash });
  const checked = inspectPersistedBuybackBurn({ signedTransactionBase64: burn.base64,
    signature: burn.signature, signer: signer.publicKey.toBase58(),
    mint: mint.toBase58(), tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    amountAtomic: "42", decimals: 6 });
  assert.equal(checked.transaction.recentBlockhash, blockhash);
  assert.equal(checked.transaction.instructions.length, 1);
  assert.equal(checked.source.toBase58(), burn.source.toBase58());
});

test("retransmission rejects changed amount, signer, or transaction bytes", () => {
  const signer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const burn = signBuybackBurn({ signer, mint, tokenProgram: TOKEN_PROGRAM_ID,
    amountAtomic: 42n, decimals: 6, blockhash: Keypair.generate().publicKey.toBase58() });
  const expected = { signedTransactionBase64: burn.base64, signature: burn.signature,
    signer: signer.publicKey.toBase58(), mint: mint.toBase58(),
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(), amountAtomic: "42", decimals: 6 };
  assert.throws(() => inspectPersistedBuybackBurn({ ...expected, amountAtomic: "43" }),
    /buyback_burn_intent_mismatch/);
  assert.throws(() => inspectPersistedBuybackBurn({ ...expected,
    signer: Keypair.generate().publicKey.toBase58() }), /buyback_burn_intent_mismatch/);
  const transaction = Transaction.from(burn.bytes);
  transaction.instructions[0].data[1] ^= 1;
  const tampered = transaction.serialize({ verifySignatures: false }).toString("base64");
  assert.throws(() => inspectPersistedBuybackBurn({ ...expected,
    signedTransactionBase64: tampered }), /buyback_burn_intent_mismatch/);
});
