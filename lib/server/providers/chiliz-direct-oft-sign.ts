import { ed25519 } from "@noble/curves/ed25519";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "node:buffer";
import { getAddress, padHex } from "viem";
import type { ChilizBridgeJournalInsert } from "../chiliz-bridge-journal.ts";
import { minimumDirectOftReceiveAtomic,
  type UnsignedDirectOftChzTransfer } from "./chiliz-direct-oft-build.ts";
import { prepareDirectOftChilizBridgeJournalInsert } from "./chiliz-direct-oft-journal.ts";
import { DIRECT_CHZ_OFT } from "./chiliz-direct-oft.ts";

const DESTINATION_SCALE = 10_000_000_000n;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const POSITIVE = /^[1-9][0-9]*$/;
type RpcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** A vault/HSM/wallet adapter: only signs the exact Solana message bytes. */
export type DirectOftMessageSigner = Readonly<{
  publicKey: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}>;

/** Independent, trusted treasury policy values; never infer these from plan. */
export type DirectOftSigningIntent = Readonly<{
  sourceWallet: string;
  destinationTreasury: string;
  sourceAmountAtomic: string;
  minimumDestinationWei: string;
  quoteId: string;
}>;

export type SignedDirectOftChilizJournal = Readonly<{
  journal: ChilizBridgeJournalInsert;
  signedTransactionBase64: string;
  signedTransactionSha256: string;
  sourceSignature: string;
}>;

function fail(code: string): never { throw new Error(code); }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))
    .toString("hex");
}

function canonicalBase64(value: unknown, code: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail(code);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 100 || bytes.length > 1_232 || bytes.toString("base64") !== value) {
    fail(code);
  }
  return bytes;
}

function canonicalKey(value: unknown, code: string): PublicKey {
  if (typeof value !== "string") fail(code);
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) fail(code);
    return key;
  } catch { return fail(code); }
}

function canonicalDestination(value: unknown, code: string): string {
  if (typeof value !== "string") fail(code);
  try { return getAddress(value).toLowerCase(); }
  catch { return fail(code); }
}

function rpcEndpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { return fail("direct_oft_sign_rpc_url_invalid"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
    fail("direct_oft_sign_rpc_url_invalid");
  }
  return url;
}

async function currentBlockHeight(url: URL, fetchImpl: RpcFetch): Promise<number> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBlockHeight",
        params: [{ commitment: "confirmed" }] }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch { return fail("direct_oft_sign_rpc_unavailable"); }
  if (!response.ok) fail("direct_oft_sign_rpc_unavailable");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { return fail("direct_oft_sign_rpc_invalid"); }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    fail("direct_oft_sign_rpc_invalid");
  }
  const record = payload as Record<string, unknown>;
  if (record.jsonrpc !== "2.0" || record.id !== 1 || record.error ||
      typeof record.result !== "number" || !Number.isSafeInteger(record.result) ||
      record.result <= 0) {
    fail("direct_oft_sign_rpc_invalid");
  }
  return record.result;
}

async function preflight(plan: UnsignedDirectOftChzTransfer,
  intent: DirectOftSigningIntent, signerPublicKey: string, nowMs: number): Promise<{
    transaction: VersionedTransaction; messageBytes: Uint8Array;
  }> {
  const wallet = canonicalKey(intent.sourceWallet, "direct_oft_sign_treasury_invalid");
  if (!PublicKey.isOnCurve(wallet) || signerPublicKey !== intent.sourceWallet ||
      plan.sourceWallet !== intent.sourceWallet ||
      plan.sourceTokenAccount !== getAssociatedTokenAddressSync(
        new PublicKey(DIRECT_CHZ_OFT.solanaMint), wallet, false, TOKEN_PROGRAM_ID).toBase58() ||
      canonicalKey(plan.sourceEscrow, "direct_oft_sign_escrow_invalid")
        .equals(new PublicKey(plan.sourceTokenAccount))) {
    fail("direct_oft_sign_treasury_mismatch");
  }
  const destination = canonicalDestination(intent.destinationTreasury,
    "direct_oft_sign_destination_invalid");
  if (canonicalDestination(plan.destinationTreasury,
        "direct_oft_sign_destination_invalid") !== destination ||
      plan.sourceAmountAtomic !== intent.sourceAmountAtomic ||
      plan.minimumDestinationWei !== intent.minimumDestinationWei ||
      !SHA256_HEX.test(plan.onchainQuoteDigestSha256) ||
      intent.quoteId !== `oft:${plan.onchainQuoteDigestSha256}`) {
    fail("direct_oft_sign_intent_mismatch");
  }
  if (plan.sourceMint !== DIRECT_CHZ_OFT.solanaMint ||
      plan.sourceProgram !== DIRECT_CHZ_OFT.solanaProgram ||
      plan.sourceStore !== DIRECT_CHZ_OFT.solanaStore ||
      plan.sourceLookupTable !== DIRECT_CHZ_OFT.solanaAddressLookupTable ||
      plan.destinationEid !== DIRECT_CHZ_OFT.chilizEid ||
      plan.destinationAdapter.toLowerCase() !==
        DIRECT_CHZ_OFT.chilizNativeAdapter.toLowerCase() ||
      plan.executionReady !== false ||
      !SHA256_HEX.test(plan.expectedMessageSha256)) {
    fail("direct_oft_sign_route_mismatch");
  }
  if (!POSITIVE.test(plan.sourceAmountAtomic) ||
      BigInt(plan.sourceAmountAtomic) > BigInt(DIRECT_CHZ_OFT.maximumCanaryAmountAtomic) ||
      minimumDirectOftReceiveAtomic(plan.sourceAmountAtomic, plan.minimumReceiveAtomic) !==
        plan.minimumReceiveAtomic ||
      !POSITIVE.test(plan.quotedReceiveAtomic) ||
      BigInt(plan.quotedReceiveAtomic) < BigInt(plan.minimumReceiveAtomic) ||
      BigInt(plan.quotedReceiveAtomic) > BigInt(plan.sourceAmountAtomic) ||
      plan.minimumDestinationWei !==
        (BigInt(plan.minimumReceiveAtomic) * DESTINATION_SCALE).toString() ||
      !POSITIVE.test(plan.messagingFeeLamports) ||
      BigInt(plan.messagingFeeLamports) > BigInt(DIRECT_CHZ_OFT.maximumQuotedFeeLamports) ||
      !/^0x(?:[0-9a-f]{2})*$/i.test(plan.extraOptionsHex)) {
    fail("direct_oft_sign_amount_mismatch");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      !Number.isSafeInteger(plan.quoteExpiresAtMs) ||
      plan.quoteExpiresAtMs <= nowMs + 30_000 ||
      plan.quoteExpiresAtMs > nowMs + 60_000 ||
      !Number.isSafeInteger(plan.lastValidBlockHeight) ||
      plan.lastValidBlockHeight <= 0) {
    fail("direct_oft_sign_expired");
  }
  const quoteSnapshot = JSON.stringify({
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
  if (await sha256Hex(Buffer.from(quoteSnapshot)) !== plan.onchainQuoteDigestSha256) {
    fail("direct_oft_sign_quote_mismatch");
  }
  const unsignedBytes = canonicalBase64(plan.unsignedTransactionBase64,
    "direct_oft_sign_unsigned_transaction_invalid");
  const expectedMessage = canonicalBase64(plan.unsignedMessageBase64,
    "direct_oft_sign_unsigned_message_invalid");
  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(unsignedBytes); }
  catch { return fail("direct_oft_sign_unsigned_transaction_invalid"); }
  const message = transaction.message;
  const messageBytes = message.serialize();
  if (transaction.version !== 0 || transaction.signatures.length !== 1 ||
      transaction.signatures[0].some((byte) => byte !== 0) ||
      message.header.numRequiredSignatures !== 1 ||
      message.staticAccountKeys[0]?.toBase58() !== intent.sourceWallet ||
      message.recentBlockhash !== plan.recentBlockhash ||
      message.compiledInstructions.length !== 1 ||
      message.addressTableLookups.length > 1 ||
      message.addressTableLookups.some((lookup) =>
        lookup.accountKey.toBase58() !== DIRECT_CHZ_OFT.solanaAddressLookupTable) ||
      !Buffer.from(messageBytes).equals(Buffer.from(expectedMessage)) ||
      !Buffer.from(transaction.serialize()).equals(Buffer.from(unsignedBytes)) ||
      await sha256Hex(messageBytes) !== plan.expectedMessageSha256) {
    fail("direct_oft_sign_message_mismatch");
  }
  const ix = message.compiledInstructions[0];
  if (message.staticAccountKeys[ix.programIdIndex]?.toBase58() !==
        DIRECT_CHZ_OFT.solanaProgram ||
      !message.staticAccountKeys.some((key) =>
        key.toBase58() === plan.sourceTokenAccount)) {
    fail("direct_oft_sign_program_mismatch");
  }
  const serializer = oft.instructions.getSendInstructionDataSerializer();
  let decoded: ReturnType<typeof serializer.deserialize>[0];
  let consumed: number;
  try { [decoded, consumed] = serializer.deserialize(ix.data); }
  catch { return fail("direct_oft_sign_instruction_invalid"); }
  const to = Buffer.from(padHex(destination as `0x${string}`, { size: 32 }).slice(2), "hex");
  if (consumed !== ix.data.length || decoded.dstEid !== DIRECT_CHZ_OFT.chilizEid ||
      !Buffer.from(decoded.to).equals(to) ||
      decoded.amountLd !== BigInt(intent.sourceAmountAtomic) ||
      decoded.minAmountLd !== BigInt(plan.minimumReceiveAtomic) ||
      decoded.nativeFee !== BigInt(plan.messagingFeeLamports) ||
      decoded.lzTokenFee !== 0n || decoded.composeMsg.__option !== "None" ||
      !Buffer.from(decoded.options).equals(Buffer.from(plan.extraOptionsHex.slice(2), "hex"))) {
    fail("direct_oft_sign_instruction_mismatch");
  }
  return { transaction, messageBytes };
}

/**
 * Sign only an audited direct-OFT unsigned message, then produce a durable
 * journal intent. The adapter does not submit, broadcast, or write to a DB.
 * `intent` must be independently configured from treasury policy and the
 * validated quote; it must not be copied from an untrusted plan/request.
 */
export async function signDirectOftChilizJournal(input: {
  id: string;
  plan: UnsignedDirectOftChzTransfer;
  intent: DirectOftSigningIntent;
  signer: DirectOftMessageSigner;
  solanaRpcUrl: string;
  fetchImpl?: RpcFetch;
  nowMs?: number;
}): Promise<SignedDirectOftChilizJournal> {
  let plan: UnsignedDirectOftChzTransfer;
  try { plan = structuredClone(input.plan); }
  catch { return fail("direct_oft_sign_plan_invalid"); }
  const intent = { ...input.intent };
  const signerPublicKey = input.signer?.publicKey;
  if (typeof signerPublicKey !== "string" ||
      typeof input.signer?.signMessage !== "function") {
    fail("direct_oft_signer_invalid");
  }
  const nowMs = input.nowMs ?? Date.now();
  const { transaction, messageBytes } = await preflight(plan, intent, signerPublicKey, nowMs);
  const url = rpcEndpoint(input.solanaRpcUrl);
  const height = await currentBlockHeight(url, input.fetchImpl ?? fetch);
  if (height + 10 >= plan.lastValidBlockHeight) fail("direct_oft_sign_blockhash_stale");
  let signature: Uint8Array;
  try { signature = await input.signer.signMessage(Uint8Array.from(messageBytes)); }
  catch { return fail("direct_oft_signer_unavailable"); }
  if (!(signature instanceof Uint8Array) || signature.length !== 64 ||
      !ed25519.verify(signature, messageBytes,
        new PublicKey(signerPublicKey).toBytes())) {
    fail("direct_oft_signer_signature_invalid");
  }
  if (plan.quoteExpiresAtMs <= (input.nowMs ?? Date.now()) + 30_000) {
    fail("direct_oft_sign_expired");
  }
  transaction.signatures[0] = Uint8Array.from(signature);
  const signedTransactionBase64 = Buffer.from(transaction.serialize()).toString("base64");
  const journal = await prepareDirectOftChilizBridgeJournalInsert({
    id: input.id,
    plan,
    expectedSourceWallet: intent.sourceWallet,
    expectedDestinationTreasury: intent.destinationTreasury,
    signedTransactionBase64,
    nowMs: input.nowMs ?? Date.now(),
  });
  return {
    journal, signedTransactionBase64,
    signedTransactionSha256: journal.signedTransactionSha256,
    sourceSignature: journal.sourceSignature,
  };
}
