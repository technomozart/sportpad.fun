import { Buffer } from "buffer";
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const exactBase64 = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("buyback_burn_encoding_invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("buyback_burn_encoding_invalid");
  return bytes;
};

export function signBuybackBurn({ signer, mint, tokenProgram, amountAtomic, decimals, blockhash }) {
  const amount = BigInt(amountAtomic);
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) {
    throw new Error("buyback_burn_amount_invalid");
  }
  const source = getAssociatedTokenAddressSync(mint, signer.publicKey, false, tokenProgram);
  const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash })
    .add(createBurnCheckedInstruction(source, mint, signer.publicKey,
      amount, decimals, [], tokenProgram));
  transaction.sign(signer);
  if (!transaction.signature) throw new Error("buyback_burn_signature_missing");
  const bytes = transaction.serialize();
  return { bytes, signature: bs58.encode(transaction.signature),
    base64: bytes.toString("base64"), source };
}

/** Verify that an already persisted burn is the same signed one-instruction
 * transaction before retransmitting it. Replaying its signature is safe;
 * signing another transaction is not. */
export function inspectPersistedBuybackBurn({ signedTransactionBase64, signature,
  signer, mint, tokenProgram, amountAtomic, decimals }) {
  const bytes = exactBase64(signedTransactionBase64);
  let transaction;
  try { transaction = Transaction.from(bytes); }
  catch { throw new Error("buyback_burn_transaction_invalid"); }
  const owner = new PublicKey(signer);
  const mintKey = new PublicKey(mint);
  const program = new PublicKey(tokenProgram);
  const source = getAssociatedTokenAddressSync(mintKey, owner, false, program);
  const expected = createBurnCheckedInstruction(source, mintKey, owner,
    BigInt(amountAtomic), decimals, [], program);
  if (!transaction.feePayer?.equals(owner) || transaction.instructions.length !== 1 ||
    transaction.signatures.length !== 1 ||
    !transaction.signatures[0].publicKey.equals(owner) ||
    !transaction.verifySignatures() ||
    !transaction.instructions[0].programId.equals(expected.programId) ||
    !Buffer.from(transaction.instructions[0].data).equals(Buffer.from(expected.data)) ||
    transaction.instructions[0].keys.length !== expected.keys.length ||
    transaction.instructions[0].keys.some((key, index) =>
      !key.pubkey.equals(expected.keys[index].pubkey) ||
      key.isSigner !== expected.keys[index].isSigner ||
      (key.isWritable !== expected.keys[index].isWritable &&
        !(key.pubkey.equals(owner) && key.isWritable))) ||
    !transaction.signature || bs58.encode(transaction.signature) !== signature) {
    throw new Error("buyback_burn_intent_mismatch");
  }
  return { bytes, transaction, source };
}
