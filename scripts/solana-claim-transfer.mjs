import { Buffer } from "buffer";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const MAX_U64 = 18_446_744_073_709_551_615n;

function terms({ signer, mint, destinationAddress, tokenProgram, amountAtomic, decimals }) {
  const treasury = new PublicKey(signer);
  const mintKey = new PublicKey(mint);
  const recipient = new PublicKey(destinationAddress);
  const program = new PublicKey(tokenProgram);
  const amount = BigInt(amountAtomic);
  if (amount <= 0n || amount > MAX_U64 || recipient.equals(treasury) ||
    !PublicKey.isOnCurve(recipient.toBytes()) ||
    !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("solana_claim_terms_invalid");
  }
  const source = getAssociatedTokenAddressSync(mintKey, treasury, false, program);
  const destination = getAssociatedTokenAddressSync(mintKey, recipient, false, program);
  const instruction = createTransferCheckedInstruction(source, mintKey, destination,
    treasury, amount, decimals, [], program);
  return { treasury, mintKey, recipient, program, amount, source, destination, instruction };
}

export function signSolanaClaimTransfer({ signer, mint, destinationAddress, tokenProgram,
  amountAtomic, decimals, blockhash }) {
  const expected = terms({ signer: signer.publicKey, mint, destinationAddress,
    tokenProgram, amountAtomic, decimals });
  const transaction = new Transaction({ feePayer: signer.publicKey,
    recentBlockhash: blockhash }).add(expected.instruction);
  transaction.sign(signer);
  if (!transaction.signature) throw new Error("solana_claim_signature_missing");
  const bytes = transaction.serialize();
  return { bytes, base64: bytes.toString("base64"),
    signature: bs58.encode(transaction.signature),
    source: expected.source, destination: expected.destination };
}

/** A replay uses precisely the previously persisted signed transfer. */
export function inspectPersistedSolanaClaimTransfer({ signedTransactionBase64, signature,
  signer, mint, destinationAddress, tokenProgram, amountAtomic, decimals }) {
  if (typeof signedTransactionBase64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signedTransactionBase64)) {
    throw new Error("solana_claim_transaction_encoding_invalid");
  }
  const bytes = Buffer.from(signedTransactionBase64, "base64");
  if (bytes.toString("base64") !== signedTransactionBase64) {
    throw new Error("solana_claim_transaction_encoding_invalid");
  }
  let transaction;
  try { transaction = Transaction.from(bytes); }
  catch { throw new Error("solana_claim_transaction_invalid"); }
  const expected = terms({ signer, mint, destinationAddress,
    tokenProgram, amountAtomic, decimals });
  const actual = transaction.instructions[0];
  if (!transaction.feePayer?.equals(expected.treasury) ||
    transaction.instructions.length !== 1 || transaction.signatures.length !== 1 ||
    !transaction.signatures[0].publicKey.equals(expected.treasury) ||
    !transaction.verifySignatures() ||
    !actual.programId.equals(expected.instruction.programId) ||
    !Buffer.from(actual.data).equals(Buffer.from(expected.instruction.data)) ||
    actual.keys.length !== expected.instruction.keys.length ||
    actual.keys.some((key, index) =>
      !key.pubkey.equals(expected.instruction.keys[index].pubkey) ||
      key.isSigner !== expected.instruction.keys[index].isSigner ||
      (key.isWritable !== expected.instruction.keys[index].isWritable &&
        !(key.pubkey.equals(expected.treasury) && key.isWritable))) ||
    !transaction.signature || bs58.encode(transaction.signature) !== signature) {
    throw new Error("solana_claim_intent_mismatch");
  }
  return { bytes, transaction, source: expected.source, destination: expected.destination };
}
