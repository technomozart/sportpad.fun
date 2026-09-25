import { ed25519 } from "@noble/curves/ed25519";
import { ComputeBudgetProgram, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { validateLayerZeroQuote, validatePublicWallets } from
  "../protocol/replenishment.ts";

/** No policy is seeded. Bind the canonical reward vault, lower-case Chiliz
 * treasury, and at most 1,000,000,000 Solana CHZ atomic units (10 CHZ). */
export const INSERT_PAUSED_CHILIZ_BRIDGE_POLICY_SQL = `
  INSERT INTO chiliz_bridge_policy
    (key, source_wallet, destination_treasury, max_source_amount_atomic)
  VALUES ('initial', ?1, ?2, ?3)
`;

export const ARM_CHILIZ_BRIDGE_POLICY_SQL = `
  UPDATE chiliz_bridge_policy SET state = 'armed', updated_at = CURRENT_TIMESTAMP
  WHERE key = 'initial' AND state = 'paused' AND reserved_bridge_id IS NULL
`;

/** Pausing after reservation forbids a new broadcast. The reservation remains
 * immutable and cannot be armed again; receipt reconciliation is still safe. */
export const PAUSE_CHILIZ_BRIDGE_POLICY_SQL = `
  UPDATE chiliz_bridge_policy SET state = 'paused', updated_at = CURRENT_TIMESTAMP
  WHERE key = 'initial' AND state IN ('armed', 'reserved')
`;

/** Bind via chilizBridgeJournalInsertBindings. INSERT, a one-row assertion,
 * RESERVE, and another one-row assertion must share one D1 batch. No network
 * broadcast may happen until that batch commits. The direct-OFT path checks
 * the signed message against a locally constructed expected-message digest,
 * but this journal does not decode or certify OFT instruction parameters. */
export const INSERT_PREPARED_CHILIZ_BRIDGE_SQL = `
  INSERT INTO chiliz_bridge_journal
    (id, policy_key, source_chain, destination_chain_id, source_mint,
      destination_asset, source_wallet, destination_treasury,
      source_amount_atomic, minimum_destination_wei, quote_id,
      quote_expires_at_ms, route_type, signed_transaction_base64,
      signed_transaction_sha256, source_signature)
  SELECT ?1, p.key, 'solana', 88888,
    '6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    p.source_wallet, p.destination_treasury,
    ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
  FROM chiliz_bridge_policy p
  WHERE p.key = 'initial' AND p.state = 'armed'
    AND p.reserved_bridge_id IS NULL
    AND p.source_wallet = ?2 AND p.destination_treasury = ?3
    AND ?4 GLOB '[1-9]*' AND ?4 NOT GLOB '*[^0-9]*'
    AND (length(?4) < length(p.max_source_amount_atomic) OR
      (length(?4) = length(p.max_source_amount_atomic) AND
        ?4 <= p.max_source_amount_atomic))
    AND ?7 > ?12 + 30000 AND ?7 <= ?12 + 1800000
`;

export const RESERVE_CHILIZ_BRIDGE_POLICY_SQL = `
  UPDATE chiliz_bridge_policy SET state = 'reserved', reserved_bridge_id = ?1,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'initial' AND state = 'armed' AND reserved_bridge_id IS NULL
    AND EXISTS (SELECT 1 FROM chiliz_bridge_journal b
      WHERE b.id = ?1 AND b.policy_key = chiliz_bridge_policy.key
        AND b.state = 'prepared'
        AND b.source_wallet = chiliz_bridge_policy.source_wallet
        AND b.destination_treasury = chiliz_bridge_policy.destination_treasury)
`;

/** The raw signed transaction is bearer-spend data. Serve it only to the
 * authenticated funding worker, never from a public route. */
export const SELECT_CHILIZ_BRIDGE_SQL = `
  SELECT b.* FROM chiliz_bridge_journal b
  JOIN chiliz_bridge_policy p ON p.key = b.policy_key
    AND p.reserved_bridge_id = b.id
  WHERE b.id = ?1 AND p.state = 'reserved' LIMIT 1
`;

/** Persist this one-way marker before the first sendRawTransaction call. A
 * lost response remains broadcast_attempted/held; no automatic replacement
 * or retry of this transaction is authorized by this journal. */
export const MARK_CHILIZ_BRIDGE_BROADCAST_SQL = `
  UPDATE chiliz_bridge_journal SET state = 'broadcast_attempted',
    broadcast_attempted_at_ms = ?3, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2 AND state = 'prepared'
    AND ?3 > 0 AND quote_expires_at_ms > ?3
    AND EXISTS (SELECT 1 FROM chiliz_bridge_policy p
      WHERE p.key = chiliz_bridge_journal.policy_key
        AND p.reserved_bridge_id = chiliz_bridge_journal.id
        AND p.state = 'reserved')
`;

export const HOLD_CHILIZ_BRIDGE_SQL = `
  UPDATE chiliz_bridge_journal SET state = 'held',
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2
    AND state IN ('broadcast_attempted', 'source_finalized')
`;

/** Bind source signature, verified finalized slot, finalized-source proof JSON,
 * and verified LayerZero message ID. A caller must independently verify chain
 * finality and the OFT event; the JSON fields only fence what is persisted. */
export const FINALIZE_CHILIZ_BRIDGE_SOURCE_SQL = `
  UPDATE chiliz_bridge_journal SET state = 'source_finalized',
    source_finalized_slot = ?3, source_evidence_json = ?4,
    bridge_message_id = ?5, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2
    AND state IN ('broadcast_attempted', 'held')
    AND broadcast_attempted_at_ms IS NOT NULL AND ?3 > 0
    AND length(?5) BETWEEN 4 AND 256
    AND json_valid(?4) AND json_type(?4) = 'object'
    AND NOT EXISTS (SELECT 1 FROM json_tree(?4)
      WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
    AND json_extract(?4, '$.finalized') = 1
    AND json_extract(?4, '$.sourceSignature') = source_signature
    AND json_extract(?4, '$.sourceWallet') = source_wallet
    AND json_extract(?4, '$.quoteId') = quote_id
    AND json_extract(?4, '$.sourceAmountAtomic') = source_amount_atomic
    AND json_extract(?4, '$.signedTransactionSha256') = signed_transaction_sha256
    AND json_extract(?4, '$.finalizedSlot') = ?3
    AND json_extract(?4, '$.bridgeMessageId') = ?5
`;

/** Bind bridge message ID, verified Chiliz receipt hash and block, received
 * wei, and destination proof JSON. The caller must prove the OFT message and
 * finalized receipt; arbitrary treasury balance growth is insufficient. */
export const FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL = `
  UPDATE chiliz_bridge_journal SET state = 'destination_finalized',
    destination_tx_hash = ?3, destination_finalized_block = ?4,
    destination_received_wei = ?5, destination_evidence_json = ?6,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND bridge_message_id = ?2
    AND state IN ('source_finalized', 'held')
    AND source_finalized_slot IS NOT NULL AND source_evidence_json IS NOT NULL
    AND ?4 > 0 AND length(?3) = 66 AND substr(?3,1,2) = '0x'
    AND substr(?3,3) NOT GLOB '*[^0-9a-f]*'
    AND ?5 GLOB '[1-9]*' AND ?5 NOT GLOB '*[^0-9]*'
    AND (length(?5) > length(minimum_destination_wei) OR
      (length(?5) = length(minimum_destination_wei) AND
        ?5 >= minimum_destination_wei))
    AND json_valid(?6) AND json_type(?6) = 'object'
    AND NOT EXISTS (SELECT 1 FROM json_tree(?6)
      WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
    AND json_extract(?6, '$.finalized') = 1
    AND json_extract(?6, '$.chainId') = 88888
    AND json_extract(?6, '$.bridgeMessageId') = bridge_message_id
    AND json_extract(?6, '$.destinationTreasury') = destination_treasury
    AND json_extract(?6, '$.destinationAsset') = destination_asset
    AND json_extract(?6, '$.transactionHash') = ?3
    AND json_extract(?6, '$.finalizedBlock') = ?4
    AND json_extract(?6, '$.receivedWei') = ?5
`;

export type ChilizBridgeJournalInsert = {
  id: string;
  sourceWallet: string;
  destinationTreasury: string;
  sourceAmountAtomic: string;
  minimumDestinationWei: string;
  quoteId: string;
  quoteExpiresAtMs: number;
  routeType: "OFT" | "OFT_V2";
  signedTransactionBase64: string;
  signedTransactionSha256: string;
  sourceSignature: string;
  nowMs: number;
};

const DIRECT_OFT_PROGRAM = "BcRpUE1jvLvgchaYntfi2weReWVG8THCRLFy73CmxjHo";
const DIRECT_OFT_LOOKUP_TABLE = "AokBxha6VMLLgf97B5VYHEtqztamWmYERBmmFvjuTzJB";
const DIRECT_OFT_MAX_SOURCE_ATOMIC = 1_000_000_000n;
const DIRECT_OFT_DESTINATION_SCALE = 10_000_000_000n;
const SHA256_HEX = /^[0-9a-f]{64}$/;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateSignedBridgeTransaction(base64: string,
  sourceWallet: string): Promise<{
    transaction: VersionedTransaction;
    signedTransactionSha256: string;
    sourceSignature: string;
  }> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("bridge_signed_transaction_base64_invalid");
  }
  const serialized = Buffer.from(base64, "base64");
  if (serialized.length < 100 || serialized.length > 1232 ||
      serialized.toString("base64") !== base64) {
    throw new Error("bridge_signed_transaction_size_or_encoding_invalid");
  }
  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(serialized); }
  catch { throw new Error("bridge_signed_transaction_invalid"); }
  const signer = transaction.message.staticAccountKeys[0];
  const signature = transaction.signatures[0];
  const required = transaction.message.header.numRequiredSignatures;
  const message = transaction.message.serialize();
  if (!signer || signer.toBase58() !== sourceWallet ||
      !signature || transaction.signatures.length !== required || required < 1 ||
      !transaction.signatures.every((signed, index) =>
        signed.length === 64 && signed.some((byte) => byte !== 0) &&
        ed25519.verify(signed, message,
          transaction.message.staticAccountKeys[index].toBytes()))) {
    throw new Error("bridge_source_signature_invalid");
  }
  return {
    transaction,
    signedTransactionSha256: await sha256Hex(serialized),
    sourceSignature: bs58.encode(signature),
  };
}

/** These checks fence an expected OFT send transaction, but cannot prove that
 * the OFT instruction encodes this quote's amount or destination. The caller
 * must supply a digest of the exact message independently constructed from
 * the official SDK quote and intended OFT send instruction. */
function assertDirectOftMessageShape(transaction: VersionedTransaction): void {
  const message = transaction.message;
  if (message.header.numRequiredSignatures !== 1 || transaction.signatures.length !== 1) {
    throw new Error("bridge_direct_oft_signer_count_invalid");
  }
  const lookups = message.addressTableLookups;
  if (lookups.length > 1 || lookups.some((lookup) =>
    lookup.accountKey.toBase58() !== DIRECT_OFT_LOOKUP_TABLE)) {
    throw new Error("bridge_direct_oft_lookup_table_invalid");
  }
  let oftInstructionCount = 0;
  for (const instruction of message.compiledInstructions) {
    // Program IDs loaded through an ALT are deliberately not accepted: the
    // static keys must show exactly which programs are invoked.
    const program = message.staticAccountKeys[instruction.programIdIndex]?.toBase58();
    if (program === DIRECT_OFT_PROGRAM) oftInstructionCount++;
    else if (program !== ComputeBudgetProgram.programId.toBase58()) {
      throw new Error("bridge_direct_oft_program_invalid");
    }
  }
  if (oftInstructionCount !== 1) throw new Error("bridge_direct_oft_instruction_invalid");
}

function assertBridgeQuoteIdentity(payload: unknown, quoteId: string,
  sourceWallet: string, destinationTreasury: string): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("bridge_quote_identity_invalid");
  }
  const quotes = (payload as { quotes?: unknown }).quotes;
  if (!Array.isArray(quotes)) throw new Error("bridge_quote_identity_invalid");
  const matches = quotes.filter((entry) => entry && typeof entry === "object" &&
    !Array.isArray(entry) && (entry as { id?: unknown }).id === quoteId);
  if (matches.length !== 1) throw new Error("bridge_quote_identity_ambiguous");
  const selected = matches[0] as Record<string, unknown>;
  const expected = {
    srcChainKey: "solana",
    dstChainKey: "chiliz",
    srcTokenAddress: "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw",
    dstTokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    srcWalletAddress: sourceWallet,
    dstWalletAddress: destinationTreasury,
  } as const;
  for (const [field, value] of Object.entries(expected)) {
    const observed = selected[field];
    if (observed !== undefined && (field === "dstTokenAddress" || field === "dstWalletAddress"
      ? typeof observed !== "string" || observed.toLowerCase() !== value.toLowerCase()
      : observed !== value)) {
      throw new Error(`bridge_quote_${field}_mismatch`);
    }
  }
  const routeSteps = selected.routeSteps;
  if (!Array.isArray(routeSteps) || routeSteps.length !== 1 ||
    !routeSteps[0] || typeof routeSteps[0] !== "object" ||
    Array.isArray(routeSteps[0])) throw new Error("bridge_quote_route_invalid");
  const destination = (routeSteps[0] as Record<string, unknown>).dstChainKey;
  if (destination !== undefined && destination !== "chiliz") {
    throw new Error("bridge_quote_destination_chain_mismatch");
  }
}

/** The configured treasury addresses must be supplied by trusted server config
 * and compared to the same values in the LayerZero request. This helper
 * validates the quote, the first Solana signer, and signed-byte integrity.
 * It cannot certify the transaction's bridge instructions by itself. */
export async function createChilizBridgeJournalInsert(input: {
  id: string;
  sourceWallet: string;
  destinationTreasury: string;
  expectedSourceAmountAtomic: string;
  quoteResponse: unknown;
  signedTransactionBase64: string;
  nowMs?: number;
}): Promise<ChilizBridgeJournalInsert> {
  if (!input.id || input.id.length > 128) throw new Error("bridge_id_invalid");
  const wallets = validatePublicWallets(input.sourceWallet, input.destinationTreasury);
  const destinationTreasury = wallets.chilizWallet.toLowerCase();
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("bridge_time_invalid");
  const quote = validateLayerZeroQuote(input.quoteResponse,
    input.expectedSourceAmountAtomic, nowMs);
  assertBridgeQuoteIdentity(input.quoteResponse, quote.quoteId,
    wallets.solanaWallet, wallets.chilizWallet);
  if (quote.sourceAmountAtomic !== input.expectedSourceAmountAtomic ||
      quote.routeType !== "OFT" && quote.routeType !== "OFT_V2") {
    throw new Error("bridge_quote_mismatch");
  }
  const { signedTransactionSha256, sourceSignature } =
    await validateSignedBridgeTransaction(input.signedTransactionBase64,
      wallets.solanaWallet);
  return {
    id: input.id,
    sourceWallet: wallets.solanaWallet,
    destinationTreasury,
    sourceAmountAtomic: quote.sourceAmountAtomic,
    minimumDestinationWei: quote.minimumDestinationAmountAtomic,
    quoteId: quote.quoteId,
    quoteExpiresAtMs: Date.parse(quote.expiresAt),
    routeType: quote.routeType as "OFT" | "OFT_V2",
    signedTransactionBase64: input.signedTransactionBase64,
    signedTransactionSha256,
    sourceSignature,
    nowMs,
  };
}

/** Prepare a direct, on-chain-quoted OFT intent without the LayerZero Value
 * Transfer API. `onchainQuoteDigestSha256` is the caller's digest of its
 * verified quote snapshot; the journal cannot independently fetch that quote.
 * `expectedMessageSha256` MUST come from a separately constructed official OFT
 * transaction using the same quote, source amount, destination, and minimum.
 * This helper verifies signed-byte identity and a narrow program shape, not
 * the semantics of the OFT instruction. It does not arm or broadcast. */
export async function createDirectOftChilizBridgeJournalInsert(input: {
  id: string;
  sourceWallet: string;
  destinationTreasury: string;
  sourceAmountAtomic: string;
  minimumDestinationWei: string;
  onchainQuoteDigestSha256: string;
  quoteExpiresAtMs: number;
  expectedMessageSha256: string;
  signedTransactionBase64: string;
  nowMs?: number;
}): Promise<ChilizBridgeJournalInsert> {
  if (!input.id || input.id.length > 128) throw new Error("bridge_id_invalid");
  const wallets = validatePublicWallets(input.sourceWallet, input.destinationTreasury);
  const destinationTreasury = wallets.chilizWallet.toLowerCase();
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("bridge_time_invalid");
  if (!/^[1-9][0-9]*$/.test(input.sourceAmountAtomic) ||
      BigInt(input.sourceAmountAtomic) > DIRECT_OFT_MAX_SOURCE_ATOMIC) {
    throw new Error("bridge_direct_oft_source_amount_invalid");
  }
  if (!/^[1-9][0-9]*$/.test(input.minimumDestinationWei)) {
    throw new Error("bridge_direct_oft_minimum_destination_invalid");
  }
  const parityWei = BigInt(input.sourceAmountAtomic) * DIRECT_OFT_DESTINATION_SCALE;
  const minimumWei = BigInt(input.minimumDestinationWei);
  if (minimumWei > parityWei || minimumWei * 100n < parityWei * 95n) {
    throw new Error("bridge_direct_oft_minimum_destination_out_of_range");
  }
  if (!SHA256_HEX.test(input.onchainQuoteDigestSha256)) {
    throw new Error("bridge_direct_oft_quote_digest_invalid");
  }
  if (!Number.isSafeInteger(input.quoteExpiresAtMs) ||
      input.quoteExpiresAtMs <= nowMs + 30_000 ||
      input.quoteExpiresAtMs > nowMs + 1_800_000) {
    throw new Error("bridge_direct_oft_quote_expiry_invalid");
  }
  if (!SHA256_HEX.test(input.expectedMessageSha256)) {
    throw new Error("bridge_direct_oft_message_digest_invalid");
  }
  const signed = await validateSignedBridgeTransaction(input.signedTransactionBase64,
    wallets.solanaWallet);
  assertDirectOftMessageShape(signed.transaction);
  const actualMessageSha256 = await sha256Hex(signed.transaction.message.serialize());
  if (actualMessageSha256 !== input.expectedMessageSha256) {
    throw new Error("bridge_direct_oft_message_digest_mismatch");
  }
  return {
    id: input.id,
    sourceWallet: wallets.solanaWallet,
    destinationTreasury,
    sourceAmountAtomic: input.sourceAmountAtomic,
    minimumDestinationWei: input.minimumDestinationWei,
    quoteId: `oft:${input.onchainQuoteDigestSha256}`,
    quoteExpiresAtMs: input.quoteExpiresAtMs,
    routeType: "OFT",
    signedTransactionBase64: input.signedTransactionBase64,
    signedTransactionSha256: signed.signedTransactionSha256,
    sourceSignature: signed.sourceSignature,
    nowMs,
  };
}

export function chilizBridgeJournalInsertBindings(intent: ChilizBridgeJournalInsert) {
  return [intent.id, intent.sourceWallet, intent.destinationTreasury,
    intent.sourceAmountAtomic, intent.minimumDestinationWei, intent.quoteId,
    intent.quoteExpiresAtMs, intent.routeType, intent.signedTransactionBase64,
    intent.signedTransactionSha256, intent.sourceSignature, intent.nowMs] as const;
}
