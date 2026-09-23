import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

/** Reproduce only the previously persisted signed Jupiter order. A changed
 * order, signer or signature must never be broadcast on recovery. */
export function signPersistedBuybackSwap({ unsignedTransactionBase64, signature, signer }) {
  if (typeof unsignedTransactionBase64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(unsignedTransactionBase64) ||
    Buffer.from(unsignedTransactionBase64, "base64").toString("base64") !==
      unsignedTransactionBase64) throw new Error("buyback_replay_order_encoding_invalid");
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(unsignedTransactionBase64, "base64"));
  if (transaction.message.header.numRequiredSignatures !== 1 ||
    !transaction.message.staticAccountKeys[0]?.equals(signer.publicKey) ||
    transaction.signatures.length !== 1 ||
    transaction.signatures[0].some((byte) => byte !== 0)) {
    throw new Error("buyback_replay_order_signer_mismatch");
  }
  transaction.sign([signer]);
  if (bs58.encode(transaction.signatures[0]) !== signature) {
    throw new Error("buyback_replay_signature_mismatch");
  }
  return { signedTransactionBase64: Buffer.from(transaction.serialize()).toString("base64"),
    blockhash: transaction.message.recentBlockhash };
}
