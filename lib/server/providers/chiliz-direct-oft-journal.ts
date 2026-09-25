import { ed25519 } from "@noble/curves/ed25519";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAddress, padHex } from "viem";
import {
  createDirectOftChilizBridgeJournalInsert,
  type ChilizBridgeJournalInsert,
} from "../chiliz-bridge-journal.ts";
import {
  minimumDirectOftReceiveAtomic,
  type UnsignedDirectOftChzTransfer,
} from "./chiliz-direct-oft-build.ts";
import { DIRECT_CHZ_OFT } from "./chiliz-direct-oft.ts";

const DESTINATION_SCALE = 10n ** 10n;
const SHA256_HEX = /^[0-9a-f]{64}$/;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
}

function canonicalBase64(value: string, label: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label}_encoding_invalid`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 100 || bytes.length > 1_232 || bytes.toString("base64") !== value) {
    throw new Error(`${label}_size_or_encoding_invalid`);
  }
  return bytes;
}

/**
 * Check the plan against the exact canonical snapshot hashed by the on-chain
 * quote builder. This catches caller-side field substitutions, but is not a
 * fresh on-chain quote and does not authorize broadcast.
 */
async function assertPlanQuoteDigest(plan: UnsignedDirectOftChzTransfer,
  expectedSourceWallet: string, expectedDestinationTreasury: string): Promise<void> {
  if (plan.sourceWallet !== expectedSourceWallet ||
      getAddress(plan.destinationTreasury) !== getAddress(expectedDestinationTreasury) ||
      plan.sourceTokenAccount !== getAssociatedTokenAddressSync(
        new PublicKey(DIRECT_CHZ_OFT.solanaMint), new PublicKey(expectedSourceWallet),
        false, TOKEN_PROGRAM_ID).toBase58()) {
    throw new Error("direct_oft_plan_trusted_treasury_mismatch");
  }
  if (plan.sourceMint !== DIRECT_CHZ_OFT.solanaMint ||
      plan.sourceProgram !== DIRECT_CHZ_OFT.solanaProgram ||
      plan.sourceStore !== DIRECT_CHZ_OFT.solanaStore ||
      plan.sourceLookupTable !== DIRECT_CHZ_OFT.solanaAddressLookupTable ||
      plan.destinationEid !== DIRECT_CHZ_OFT.chilizEid ||
      plan.destinationAdapter.toLowerCase() !== DIRECT_CHZ_OFT.chilizNativeAdapter.toLowerCase() ||
      plan.executionReady !== false ||
      !SHA256_HEX.test(plan.onchainQuoteDigestSha256) ||
      !SHA256_HEX.test(plan.expectedMessageSha256)) {
    throw new Error("direct_oft_plan_identity_invalid");
  }
  if (!/^[1-9][0-9]*$/.test(plan.sourceAmountAtomic) ||
      BigInt(plan.sourceAmountAtomic) > BigInt(DIRECT_CHZ_OFT.maximumCanaryAmountAtomic) ||
      minimumDirectOftReceiveAtomic(plan.sourceAmountAtomic, plan.minimumReceiveAtomic) !==
        plan.minimumReceiveAtomic ||
      !/^[1-9][0-9]*$/.test(plan.quotedReceiveAtomic) ||
      BigInt(plan.quotedReceiveAtomic) < BigInt(plan.minimumReceiveAtomic) ||
      BigInt(plan.quotedReceiveAtomic) > BigInt(plan.sourceAmountAtomic) ||
      plan.minimumDestinationWei !==
        (BigInt(plan.minimumReceiveAtomic) * DESTINATION_SCALE).toString() ||
      !/^[1-9][0-9]*$/.test(plan.messagingFeeLamports) ||
      BigInt(plan.messagingFeeLamports) > BigInt(DIRECT_CHZ_OFT.maximumQuotedFeeLamports) ||
      !Number.isSafeInteger(plan.lastValidBlockHeight) || plan.lastValidBlockHeight <= 0 ||
      !/^0x(?:[0-9a-f]{2})*$/i.test(plan.extraOptionsHex)) {
    throw new Error("direct_oft_plan_amount_or_fee_invalid");
  }
  const snapshot = JSON.stringify({
    route: "SOLANA_CHZ_TO_NATIVE_CHILIZ_CHZ_OFT",
    sourceMint: DIRECT_CHZ_OFT.solanaMint,
    sourceProgram: DIRECT_CHZ_OFT.solanaProgram,
    sourceStore: DIRECT_CHZ_OFT.solanaStore,
    sourceAta: plan.sourceTokenAccount,
    sourceEscrow: plan.sourceEscrow,
    destinationEid: DIRECT_CHZ_OFT.chilizEid,
    destinationAdapter: DIRECT_CHZ_OFT.chilizNativeAdapter,
    destinationWallet: plan.destinationTreasury.toLowerCase(),
    sourceAmountAtomic: plan.sourceAmountAtomic,
    minimumReceiveAtomic: plan.minimumReceiveAtomic,
    quotedReceiveAtomic: plan.quotedReceiveAtomic,
    messagingFeeLamports: plan.messagingFeeLamports,
    optionsHex: plan.extraOptionsHex.slice(2).toLowerCase(),
    blockhash: plan.recentBlockhash,
    lastValidBlockHeight: plan.lastValidBlockHeight,
  });
  if (await sha256Hex(Buffer.from(snapshot)) !== plan.onchainQuoteDigestSha256) {
    throw new Error("direct_oft_plan_quote_digest_mismatch");
  }
}

function assertSignedMessageSemantics(
  plan: UnsignedDirectOftChzTransfer,
  transaction: VersionedTransaction,
): void {
  const message = transaction.message;
  if (transaction.version !== 0 || message.header.numRequiredSignatures !== 1 ||
      transaction.signatures.length !== 1 ||
      message.staticAccountKeys[0]?.toBase58() !== plan.sourceWallet ||
      message.recentBlockhash !== plan.recentBlockhash ||
      message.compiledInstructions.length !== 1 ||
      message.addressTableLookups.length > 1 ||
      message.addressTableLookups.some((lookup) =>
        lookup.accountKey.toBase58() !== DIRECT_CHZ_OFT.solanaAddressLookupTable)) {
    throw new Error("direct_oft_signed_message_shape_invalid");
  }
  const ix = message.compiledInstructions[0];
  if (message.staticAccountKeys[ix.programIdIndex]?.toBase58() !== DIRECT_CHZ_OFT.solanaProgram ||
      !message.staticAccountKeys.some((key) => key.toBase58() === plan.sourceTokenAccount)) {
    throw new Error("direct_oft_signed_message_program_or_ata_invalid");
  }
  const [decoded, decodedBytes] = oft.instructions.getSendInstructionDataSerializer().deserialize(ix.data);
  const destination = Buffer.from(padHex(getAddress(plan.destinationTreasury), { size: 32 }).slice(2), "hex");
  if (decodedBytes !== ix.data.length || decoded.dstEid !== DIRECT_CHZ_OFT.chilizEid ||
      !Buffer.from(decoded.to).equals(destination) ||
      decoded.amountLd !== BigInt(plan.sourceAmountAtomic) ||
      decoded.minAmountLd !== BigInt(plan.minimumReceiveAtomic) ||
      decoded.nativeFee !== BigInt(plan.messagingFeeLamports) ||
      decoded.lzTokenFee !== 0n ||
      decoded.composeMsg.__option !== "None" ||
      !Buffer.from(decoded.options).equals(Buffer.from(plan.extraOptionsHex.slice(2), "hex"))) {
    throw new Error("direct_oft_signed_instruction_semantics_invalid");
  }
}

/**
 * Bind a signed Solana transaction to an already verified, unsigned OFT plan
 * before invoking the paused-policy journal insertion validator. This helper
 * performs no signing, RPC, broadcast, or database write. The expected wallet
 * addresses MUST come from trusted server policy, not the plan or a user
 * request. A plan and journal insert are not authorization to move funds:
 * a fresh on-chain quote and finalized receipts remain separate requirements.
 */
export async function prepareDirectOftChilizBridgeJournalInsert(input: {
  id: string;
  plan: UnsignedDirectOftChzTransfer;
  expectedSourceWallet: string;
  expectedDestinationTreasury: string;
  signedTransactionBase64: string;
  nowMs?: number;
}): Promise<ChilizBridgeJournalInsert> {
  const { plan } = input;
  await assertPlanQuoteDigest(plan, input.expectedSourceWallet, input.expectedDestinationTreasury);
  const unsignedMessage = canonicalBase64(plan.unsignedMessageBase64, "direct_oft_unsigned_message");
  const unsignedBytes = canonicalBase64(plan.unsignedTransactionBase64,
    "direct_oft_unsigned_transaction");
  const unsignedTransaction = VersionedTransaction.deserialize(unsignedBytes);
  if (unsignedTransaction.version !== 0 ||
      !Buffer.from(unsignedTransaction.serialize()).equals(unsignedBytes) ||
      !Buffer.from(unsignedTransaction.message.serialize()).equals(unsignedMessage) ||
      unsignedTransaction.signatures.length !== 1 ||
      unsignedTransaction.signatures[0].some((byte) => byte !== 0) ||
      await sha256Hex(unsignedMessage) !== plan.expectedMessageSha256) {
    throw new Error("direct_oft_unsigned_plan_message_invalid");
  }
  const signedBytes = canonicalBase64(input.signedTransactionBase64, "direct_oft_signed_transaction");
  const signed = VersionedTransaction.deserialize(signedBytes);
  const signedMessage = signed.message.serialize();
  if (!Buffer.from(signed.serialize()).equals(signedBytes) ||
      !Buffer.from(signedMessage).equals(unsignedMessage) ||
      await sha256Hex(signedMessage) !== plan.expectedMessageSha256 ||
      signed.signatures.length !== 1 || signed.signatures[0].every((byte) => byte === 0) ||
      !ed25519.verify(signed.signatures[0], signedMessage,
        signed.message.staticAccountKeys[0]?.toBytes() ?? new Uint8Array())) {
    throw new Error("direct_oft_signed_transaction_does_not_match_plan");
  }
  assertSignedMessageSemantics(plan, signed);
  return createDirectOftChilizBridgeJournalInsert({
    id: input.id,
    sourceWallet: input.expectedSourceWallet,
    destinationTreasury: input.expectedDestinationTreasury,
    sourceAmountAtomic: plan.sourceAmountAtomic,
    minimumDestinationWei: plan.minimumDestinationWei,
    onchainQuoteDigestSha256: plan.onchainQuoteDigestSha256,
    quoteExpiresAtMs: plan.quoteExpiresAtMs,
    expectedMessageSha256: plan.expectedMessageSha256,
    signedTransactionBase64: input.signedTransactionBase64,
    nowMs: input.nowMs,
  });
}
