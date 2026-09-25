import { ed25519 } from "@noble/curves/ed25519";
import { Buffer } from "node:buffer";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { getAddress, padHex } from "viem";

/** Public official Chiliz Bridge Solana -> native Chiliz CHZ route. */
const ROUTE = Object.freeze({
  program: "BcRpUE1jvLvgchaYntfi2weReWVG8THCRLFy73CmxjHo",
  store: "9SBbd5mXvCimWXpggkE8PJpXMjBddDhWWZY1eW1BhvUF",
  mint: "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw",
  lookupTable: "AokBxha6VMLLgf97B5VYHEtqztamWmYERBmmFvjuTzJB",
  destinationEid: 30409,
  destinationScale: 10_000_000_000n,
  maximumCanaryAmount: 1_000_000_000n,
  maximumNativeFee: 50_000_000n,
});

const SHA256 = /^[0-9a-f]{64}$/;
const GUID = /^0x[0-9a-fA-F]{64}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const NONNEGATIVE = /^(0|[1-9][0-9]*)$/;
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
const SEND_DISCRIMINATOR = Buffer.from("66fb14bb414b0c45", "hex");

type JsonObject = Record<string, unknown>;
type RpcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type DirectOftSourceExpected = {
  /** Values from the immutable prepared bridge journal and trusted builder. */
  sourceSignature: string;
  sourceWallet: string;
  sourceTokenAccount: string;
  sourceEscrow: string;
  sourceMint: string;
  sourceAmountAtomic: string;
  destinationTreasury: string;
  minimumDestinationWei: string;
  quoteId: string;
  signedTransactionBase64: string;
  signedTransactionSha256: string;
  expectedMessageSha256?: string;
  expectedGuid?: string;
};

export type VerifiedDirectOftSource = {
  guid: string;
  finalizedSlot: number;
  amountSentAtomic: bigint;
  amountReceivedAtomic: bigint;
  /** JSON-safe evidence matching the immutable source journal row. */
  proof: {
    finalized: true;
    sourceSignature: string;
    sourceWallet: string;
    sourceTokenAccount: string;
    sourceMint: typeof ROUTE.mint;
    sourceAmountAtomic: string;
    destinationTreasury: string;
    destinationEid: typeof ROUTE.destinationEid;
    amountReceivedAtomic: string;
    quoteId: string;
    signedTransactionSha256: string;
    finalizedSlot: number;
    bridgeMessageId: string;
  };
};

function fail(code: string): never { throw new Error(code); }

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as JsonObject;
}

function key(value: unknown, code: string): PublicKey {
  if (typeof value !== "string") fail(code);
  try {
    const parsed = new PublicKey(value);
    if (parsed.toBase58() !== value) fail(code);
    return parsed;
  } catch { return fail(code); }
}

function address(value: unknown, code: string): string {
  if (typeof value !== "string") fail(code);
  try { return getAddress(value).toLowerCase(); }
  catch { return fail(code); }
}

function atomic(value: unknown, code: string, allowZero = false): bigint {
  if (typeof value !== "string" || !(allowZero ? NONNEGATIVE : POSITIVE).test(value)) fail(code);
  return BigInt(value);
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value));
  return Buffer.from(digest).toString("hex");
}

function endpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { return fail("direct_oft_source_rpc_url_invalid"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
    fail("direct_oft_source_rpc_url_invalid");
  }
  return url;
}

async function rpc(url: URL, fetchImpl: RpcFetch, method: string, params: unknown[],
  id: number): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { return fail("direct_oft_source_rpc_unavailable"); }
  if (!response.ok) fail("direct_oft_source_rpc_unavailable");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { return fail("direct_oft_source_rpc_invalid"); }
  const record = object(payload, "direct_oft_source_rpc_invalid");
  if (record.jsonrpc !== "2.0" || record.id !== id || record.error || record.result == null) {
    fail("direct_oft_source_rpc_invalid");
  }
  return record.result;
}

function tokenBalance(value: unknown, sourceIndex: number, sourceWallet: string,
  code: string): bigint {
  if (!Array.isArray(value)) fail(code);
  const matches = value.filter((entry) => object(entry, code).accountIndex === sourceIndex);
  if (matches.length !== 1) fail(code);
  const balance = object(matches[0], code);
  const token = object(balance.uiTokenAmount, code);
  if (balance.mint !== ROUTE.mint || balance.owner !== sourceWallet ||
      balance.programId !== TOKEN_PROGRAM_ID.toBase58() || token.decimals !== 8) fail(code);
  return atomic(token.amount, code, true);
}

async function oftSentEvent(meta: JsonObject, sendInstructionIndex: number,
  accountKey: (index: number) => string, sourceTokenAccount: string,
  amountSent: bigint, minimumReceived: bigint, expectedGuid?: string): Promise<{
    guid: string; amountReceived: bigint;
  }> {
  if (!Array.isArray(meta.innerInstructions)) fail("direct_oft_source_event_missing");
  const discriminator = Buffer.from(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode("event:OFTSent"))).subarray(0, 8);
  let found: { guid: string; amountReceived: bigint } | null = null;
  for (const groupValue of meta.innerInstructions) {
    const group = object(groupValue, "direct_oft_source_event_invalid");
    if (group.index !== sendInstructionIndex) continue;
    if (!Array.isArray(group.instructions)) fail("direct_oft_source_event_invalid");
    for (const value of group.instructions) {
      const instruction = object(value, "direct_oft_source_event_invalid");
      if (typeof instruction.programIdIndex !== "number" ||
          !Number.isSafeInteger(instruction.programIdIndex) ||
          accountKey(instruction.programIdIndex) !== ROUTE.program) continue;
      if (typeof instruction.data !== "string") fail("direct_oft_source_event_invalid");
      let bytes: Buffer;
      try { bytes = Buffer.from(bs58.decode(instruction.data)); }
      catch { return fail("direct_oft_source_event_invalid"); }
      if (!Buffer.from(bytes.subarray(0, 8)).equals(EVENT_IX_TAG)) continue;
      if (bytes.length !== 100 ||
          !Buffer.from(bytes.subarray(8, 16)).equals(discriminator)) {
        fail("direct_oft_source_event_invalid");
      }
      const guid = `0x${Buffer.from(bytes.subarray(16, 48)).toString("hex")}`;
      const eventView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const destinationEid = eventView.getUint32(48, true);
      const from = bs58.encode(bytes.subarray(52, 84));
      const eventSent = eventView.getBigUint64(84, true);
      const amountReceived = eventView.getBigUint64(92, true);
      if (found || destinationEid !== ROUTE.destinationEid ||
          from !== sourceTokenAccount || eventSent !== amountSent ||
          amountReceived < minimumReceived || amountReceived > eventSent ||
          expectedGuid && guid !== expectedGuid.toLowerCase()) {
        fail("direct_oft_source_event_mismatch");
      }
      found = { guid, amountReceived };
    }
  }
  if (!found) fail("direct_oft_source_event_missing");
  return found;
}

/**
 * Independent, read-only finalized Solana proof for one prepared direct CHZ
 * OFT send. Unlike Scan, this observes the source chain's exact signed bytes,
 * token-account debit, and Anchor OFTSent self-CPI GUID. The caller must bind
 * `expected` to the immutable journal row and trusted local OFT builder.
 */
export async function verifyDirectOftSource(input: {
  rpcUrl: string;
  expected: DirectOftSourceExpected;
  fetchImpl?: RpcFetch;
}): Promise<VerifiedDirectOftSource> {
  const url = endpoint(input.rpcUrl);
  const expected = input.expected;
  const wallet = key(expected.sourceWallet, "direct_oft_source_wallet_invalid");
  const sourceTokenAccount = key(expected.sourceTokenAccount,
    "direct_oft_source_token_account_invalid");
  const escrow = key(expected.sourceEscrow, "direct_oft_source_escrow_invalid");
  if (!PublicKey.isOnCurve(wallet) || expected.sourceMint !== ROUTE.mint ||
      !getAssociatedTokenAddressSync(new PublicKey(ROUTE.mint), wallet, false,
        TOKEN_PROGRAM_ID).equals(sourceTokenAccount)) {
    fail("direct_oft_source_identity_mismatch");
  }
  const destination = address(expected.destinationTreasury,
    "direct_oft_source_destination_invalid");
  const amount = atomic(expected.sourceAmountAtomic, "direct_oft_source_amount_invalid");
  const minimumWei = atomic(expected.minimumDestinationWei,
    "direct_oft_source_minimum_invalid");
  if (amount > ROUTE.maximumCanaryAmount || minimumWei % ROUTE.destinationScale !== 0n ||
      minimumWei > amount * ROUTE.destinationScale) {
    fail("direct_oft_source_amount_invalid");
  }
  const minimum = minimumWei / ROUTE.destinationScale;
  if (!/^oft:[0-9a-f]{64}$/.test(expected.quoteId) ||
      !SHA256.test(expected.signedTransactionSha256) ||
      expected.expectedMessageSha256 !== undefined &&
        !SHA256.test(expected.expectedMessageSha256) ||
      expected.expectedGuid !== undefined && !GUID.test(expected.expectedGuid)) {
    fail("direct_oft_source_expected_digest_invalid");
  }
  let expectedSignature: Uint8Array;
  try { expectedSignature = bs58.decode(expected.sourceSignature); }
  catch { return fail("direct_oft_source_signature_invalid"); }
  if (expectedSignature.length !== 64 ||
      bs58.encode(expectedSignature) !== expected.sourceSignature) {
    fail("direct_oft_source_signature_invalid");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(expected.signedTransactionBase64)) {
    fail("direct_oft_source_signed_bytes_invalid");
  }
  const signedBytes = Buffer.from(expected.signedTransactionBase64, "base64");
  if (signedBytes.length < 100 || signedBytes.length > 1232 ||
      signedBytes.toString("base64") !== expected.signedTransactionBase64 ||
      await sha256Hex(signedBytes) !== expected.signedTransactionSha256) {
    fail("direct_oft_source_signed_bytes_invalid");
  }
  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(signedBytes); }
  catch { return fail("direct_oft_source_signed_bytes_invalid"); }
  const message = transaction.message;
  const messageBytes = message.serialize();
  if (transaction.version !== 0 || message.header.numRequiredSignatures !== 1 ||
      message.staticAccountKeys[0]?.toBase58() !== expected.sourceWallet ||
      transaction.signatures.length !== 1 ||
      !Buffer.from(transaction.signatures[0]).equals(Buffer.from(expectedSignature)) ||
      !ed25519.verify(expectedSignature, messageBytes, wallet.toBytes()) ||
      expected.expectedMessageSha256 &&
        await sha256Hex(messageBytes) !== expected.expectedMessageSha256) {
    fail("direct_oft_source_signed_message_mismatch");
  }
  const lookups = message.addressTableLookups;
  if (lookups.length > 1 || lookups.some((entry) =>
      entry.accountKey.toBase58() !== ROUTE.lookupTable)) {
    fail("direct_oft_source_lookup_invalid");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const [transactionValue, statusValue] = await Promise.all([
    rpc(url, fetchImpl, "getTransaction", [expected.sourceSignature,
      { encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0 }], 1),
    rpc(url, fetchImpl, "getSignatureStatuses", [[expected.sourceSignature],
      { searchTransactionHistory: true }], 2),
  ]);
  const recorded = object(transactionValue, "direct_oft_source_receipt_invalid");
  const meta = object(recorded.meta, "direct_oft_source_receipt_invalid");
  const statusArray = object(statusValue, "direct_oft_source_status_invalid").value;
  if (!Array.isArray(recorded.transaction) || recorded.transaction.length !== 2 ||
      recorded.transaction[1] !== "base64" ||
      recorded.transaction[0] !== expected.signedTransactionBase64 ||
      recorded.version !== 0 || !Number.isSafeInteger(recorded.slot) ||
      (recorded.slot as number) <= 0 || meta.err !== null ||
      !Array.isArray(statusArray) || statusArray.length !== 1) {
    fail("direct_oft_source_receipt_mismatch");
  }
  const status = object(statusArray[0], "direct_oft_source_status_invalid");
  if (status.err !== null || status.confirmationStatus !== "finalized" ||
      status.slot !== recorded.slot) fail("direct_oft_source_not_finalized");
  const loaded = object(meta.loadedAddresses, "direct_oft_source_loaded_accounts_invalid");
  if (!Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly)) {
    fail("direct_oft_source_loaded_accounts_invalid");
  }
  const writableLookupCount = lookups.reduce((count, entry) =>
    count + entry.writableIndexes.length, 0);
  const readonlyLookupCount = lookups.reduce((count, entry) =>
    count + entry.readonlyIndexes.length, 0);
  if (loaded.writable.length !== writableLookupCount ||
      loaded.readonly.length !== readonlyLookupCount) {
    fail("direct_oft_source_loaded_accounts_invalid");
  }
  let keys: ReturnType<typeof message.getAccountKeys>;
  try {
    keys = message.getAccountKeys({ accountKeysFromLookups: {
      writable: loaded.writable.map((value) => key(value, "direct_oft_source_loaded_accounts_invalid")),
      readonly: loaded.readonly.map((value) => key(value, "direct_oft_source_loaded_accounts_invalid")),
    } });
  } catch { return fail("direct_oft_source_loaded_accounts_invalid"); }
  const accountKey = (index: number) => keys.get(index)?.toBase58() ?? "";
  const instructions = message.compiledInstructions;
  const oftInstructions = instructions.map((instruction, index) => ({ instruction, index }))
    .filter(({ instruction }) => accountKey(instruction.programIdIndex) === ROUTE.program);
  if (oftInstructions.length !== 1 || instructions.some((instruction) =>
      ![ROUTE.program, ComputeBudgetProgram.programId.toBase58()]
        .includes(accountKey(instruction.programIdIndex)))) {
    fail("direct_oft_source_program_mismatch");
  }
  const { instruction, index: sendInstructionIndex } = oftInstructions[0];
  const accounts = instruction.accountKeyIndexes.map(accountKey);
  const eidBytes = Buffer.alloc(4);
  eidBytes.writeUInt32BE(ROUTE.destinationEid);
  const [peer] = PublicKey.findProgramAddressSync([Buffer.from("Peer"),
    new PublicKey(ROUTE.store).toBuffer(), eidBytes], new PublicKey(ROUTE.program));
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")], new PublicKey(ROUTE.program));
  if (accounts[0] !== expected.sourceWallet || accounts[1] !== peer.toBase58() ||
      accounts[2] !== ROUTE.store || accounts[3] !== sourceTokenAccount.toBase58() ||
      accounts[4] !== escrow.toBase58() || accounts[5] !== ROUTE.mint ||
      accounts[6] !== TOKEN_PROGRAM_ID.toBase58() ||
      accounts[7] !== eventAuthority.toBase58() || accounts[8] !== ROUTE.program) {
    fail("direct_oft_source_accounts_mismatch");
  }
  const serializer = oft.instructions.getSendInstructionDataSerializer();
  let decoded: ReturnType<typeof serializer.deserialize>[0];
  let consumed: number;
  try { [decoded, consumed] = serializer.deserialize(instruction.data); }
  catch { return fail("direct_oft_source_instruction_invalid"); }
  const recipientBytes = Buffer.from(padHex(destination as `0x${string}`, { size: 32 }).slice(2), "hex");
  if (consumed !== instruction.data.length ||
      !Buffer.from(decoded.discriminator).equals(SEND_DISCRIMINATOR) ||
      !Buffer.from(decoded.to).equals(recipientBytes) ||
      decoded.dstEid !== ROUTE.destinationEid || decoded.amountLd !== amount ||
      decoded.minAmountLd !== minimum || decoded.minAmountLd > decoded.amountLd ||
      decoded.lzTokenFee !== 0n || decoded.nativeFee <= 0n ||
      decoded.nativeFee > ROUTE.maximumNativeFee || decoded.composeMsg.__option !== "None") {
    fail("direct_oft_source_instruction_mismatch");
  }
  const sourceIndex = instruction.accountKeyIndexes[3];
  const before = tokenBalance(meta.preTokenBalances, sourceIndex, expected.sourceWallet,
    "direct_oft_source_prebalance_invalid");
  const after = tokenBalance(meta.postTokenBalances, sourceIndex, expected.sourceWallet,
    "direct_oft_source_postbalance_invalid");
  if (before < after || before - after !== amount) fail("direct_oft_source_debit_mismatch");
  const event = await oftSentEvent(meta, sendInstructionIndex, accountKey,
    sourceTokenAccount.toBase58(), amount, minimum, expected.expectedGuid);
  const slot = recorded.slot as number;
  return {
    guid: event.guid,
    finalizedSlot: slot,
    amountSentAtomic: amount,
    amountReceivedAtomic: event.amountReceived,
    proof: {
      finalized: true, sourceSignature: expected.sourceSignature,
      sourceWallet: expected.sourceWallet,
      sourceTokenAccount: sourceTokenAccount.toBase58(), sourceMint: ROUTE.mint,
      sourceAmountAtomic: expected.sourceAmountAtomic, destinationTreasury: destination,
      destinationEid: ROUTE.destinationEid,
      amountReceivedAtomic: event.amountReceived.toString(), quoteId: expected.quoteId,
      signedTransactionSha256: expected.signedTransactionSha256,
      finalizedSlot: slot, bridgeMessageId: event.guid,
    },
  };
}
