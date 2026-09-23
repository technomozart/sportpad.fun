import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

import { signPersistedBuybackSwap } from "./solana-buyback-swap-replay.mjs";

function fixture() {
  const signer = Keypair.generate();
  const message = new TransactionMessage({ payerKey: signer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [],
  }).compileToV0Message();
  const unsigned = new VersionedTransaction(message);
  const unsignedTransactionBase64 = Buffer.from(unsigned.serialize()).toString("base64");
  unsigned.sign([signer]);
  return { signer, unsignedTransactionBase64,
    signature: bs58.encode(unsigned.signatures[0]), blockhash: message.recentBlockhash };
}

test("replay signs only the previously persisted transaction signature", () => {
  const value = fixture();
  const replay = signPersistedBuybackSwap(value);
  assert.equal(replay.blockhash, value.blockhash);
  const signed = VersionedTransaction.deserialize(Buffer.from(replay.signedTransactionBase64, "base64"));
  assert.equal(bs58.encode(signed.signatures[0]), value.signature);
  assert.throws(() => signPersistedBuybackSwap({ ...value,
    signature: fixture().signature }), /signature_mismatch/);
  assert.throws(() => signPersistedBuybackSwap({ ...value,
    signer: Keypair.generate() }), /signer_mismatch/);
  assert.throws(() => signPersistedBuybackSwap({ ...value,
    unsignedTransactionBase64: replay.signedTransactionBase64 }), /signer_mismatch/);
});
