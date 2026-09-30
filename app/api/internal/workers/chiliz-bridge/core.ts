import { ed25519 } from "@noble/curves/ed25519";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "node:buffer";
import bs58 from "bs58";
import { getAddress, padHex } from "viem";
import { z } from "zod";
import {
  ARM_CHILIZ_BRIDGE_POLICY_SQL, INSERT_PREPARED_CHILIZ_BRIDGE_SQL,
  FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL, FINALIZE_CHILIZ_BRIDGE_SOURCE_SQL,
  MARK_CHILIZ_BRIDGE_BROADCAST_SQL, RESERVE_CHILIZ_BRIDGE_POLICY_SQL,
  SELECT_CHILIZ_BRIDGE_SQL, chilizBridgeJournalInsertBindings,
  type ChilizBridgeJournalInsert,
} from "../../../../../lib/server/chiliz-bridge-journal.ts";
import { reconcileClaimedDirectOftBroadcast } from
  "../../../../../lib/server/providers/chiliz-direct-oft-broadcast.ts";
import { prepareDirectOftChilizBridgeJournalInsert } from
  "../../../../../lib/server/providers/chiliz-direct-oft-journal.ts";
import type { UnsignedDirectOftChzTransfer } from
  "../../../../../lib/server/providers/chiliz-direct-oft-build.ts";

const MINT = "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw";
const PROGRAM = "BcRpUE1jvLvgchaYntfi2weReWVG8THCRLFy73CmxjHo";
const LOOKUP_TABLE = "AokBxha6VMLLgf97B5VYHEtqztamWmYERBmmFvjuTzJB";
const NATIVE_CHZ = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
// This one-shot live canary may spend at most 0.0005 SOL on OFT messaging.
// The reusable quote builder has a separate, broader quote-only ceiling.
const MAX_CANARY_MESSAGING_FEE_LAMPORTS = 500_000n;
export const INSERT_CHILIZ_BRIDGE_CANARY_PLAN_SQL = `
  INSERT INTO chiliz_bridge_canary_plans (bridge_id, plan_json, plan_sha256)
  VALUES (?1, ?2, ?3)
`;
export const SELECT_CHILIZ_BRIDGE_CANARY_PLAN_SQL = `
  SELECT plan_json, plan_sha256 FROM chiliz_bridge_canary_plans
  WHERE bridge_id = ?1 LIMIT 1
`;
const SHA256 = /^[0-9a-f]{64}$/;
const EVM_HASH = /^0x[0-9a-f]{64}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("load"),
    id: z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/),
    workerId: z.string().regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  }).strict(),
  z.object({
    action: z.literal("reconcile"),
    id: z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/),
    workerId: z.string().regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  }).strict(),
  z.object({
    action: z.literal("claim_broadcast"),
    id: z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/),
    workerId: z.string().regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    sourceSignature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,96}$/),
    signedTransactionSha256: z.string().regex(SHA256),
  }).strict(),
  z.object({
    action: z.literal("prepare_and_reserve"),
    id: z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/),
    workerId: z.string().regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    plan: z.record(z.unknown()),
    signedTransactionBase64: z.string().min(100).max(2_000),
  }).strict(),
]);

type RawRow = Record<string, unknown>;

export type WorkerBridgeRow = Readonly<{
  id: string;
  policyKey: "initial";
  sourceChain: "solana";
  destinationChainId: 88888;
  sourceMint: typeof MINT;
  destinationAsset: typeof NATIVE_CHZ;
  sourceWallet: string;
  destinationTreasury: string;
  sourceAmountAtomic: string;
  minimumDestinationWei: string;
  quoteId: string;
  quoteExpiresAtMs: number;
  routeType: "OFT";
  signedTransactionBase64: string;
  signedTransactionSha256: string;
  sourceSignature: string;
  state: "prepared" | "broadcast_attempted" | "source_finalized" |
    "destination_finalized" | "held";
  broadcastAttemptedAtMs: number | null;
  sourceFinalizedSlot: number | null;
  bridgeMessageId: string | null;
  destinationTxHash: string | null;
  destinationReceivedWei: string | null;
  plan: UnsignedDirectOftChzTransfer;
  planSha256: string;
}>;

export type BridgeWorkerApiDependencies = Readonly<{
  database: D1Database | null | undefined;
  workerToken: string | null;
  canaryEnabled: boolean;
  prepareEnabled?: boolean;
  rewardTreasury: string | null;
  chilizTreasury: string | null;
  solanaRpcUrl?: string | null;
  primaryChilizRpcUrl?: string | null;
  secondaryChilizRpcUrl?: string | null;
  reconcileImpl?: typeof reconcileClaimedDirectOftBroadcast;
  nowMs?: () => number;
}>;

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
  } });
}

async function tokenEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([left, right].map((value) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  const first = new Uint8Array(a);
  const second = new Uint8Array(b);
  let difference = first.length ^ second.length;
  for (let index = 0; index < first.length; index++) {
    difference |= first[index] ^ second[index];
  }
  return difference === 0;
}

function canonicalTreasuries(deps: BridgeWorkerApiDependencies): {
  source: string; destination: string;
} | null {
  try {
    if (!deps.rewardTreasury || !deps.chilizTreasury) return null;
    const source = new PublicKey(deps.rewardTreasury);
    if (!PublicKey.isOnCurve(source) || source.toBase58() !== deps.rewardTreasury) return null;
    return { source: deps.rewardTreasury,
      destination: getAddress(deps.chilizTreasury).toLowerCase() };
  } catch { return null; }
}

const SEED_PAUSED_POLICY_SQL = `
  INSERT OR IGNORE INTO chiliz_bridge_policy
    (key, source_wallet, destination_treasury, max_source_amount_atomic)
  VALUES ('initial', ?1, ?2, '1000000000')
`;

// A failed invariant aborts the entire D1 batch rather than leaving an armed
// policy behind. The invalid key deliberately violates the schema CHECK.
const ASSERT_RESERVED_INTENT_SQL = `
  INSERT INTO chiliz_bridge_policy
    (key, source_wallet, destination_treasury, max_source_amount_atomic)
  SELECT 'invalid-canary-assertion', ?2, ?3, '1'
  WHERE NOT EXISTS (
    SELECT 1 FROM chiliz_bridge_policy p
    JOIN chiliz_bridge_journal b ON b.id = p.reserved_bridge_id
    JOIN chiliz_bridge_canary_plans cp ON cp.bridge_id = b.id
    WHERE p.key = 'initial' AND p.state = 'reserved'
      AND p.reserved_bridge_id = ?1
      AND p.source_wallet = ?2 AND p.destination_treasury = ?3
      AND b.state = 'prepared' AND b.source_wallet = ?2
      AND b.destination_treasury = ?3 AND b.source_amount_atomic = ?4
      AND b.minimum_destination_wei = ?5 AND b.quote_id = ?6
      AND b.quote_expires_at_ms = ?7 AND b.route_type = 'OFT'
      AND b.signed_transaction_base64 = ?8
      AND b.signed_transaction_sha256 = ?9
      AND b.source_signature = ?10
      AND cp.plan_json = ?11 AND cp.plan_sha256 = ?12
  )
`;

async function planPayload(plan: UnsignedDirectOftChzTransfer): Promise<{
  json: string; sha256: string;
}> {
  const json = JSON.stringify(plan);
  if (typeof json !== "string" || json.length < 100 || json.length > 30_000) {
    throw new Error("bridge_worker_plan_invalid");
  }
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(json))).toString("hex");
  return { json, sha256 };
}

/** Single transactional prepare+arm+reserve; never available without flags. */
export async function reservePreparedDirectOftCanary(database: D1Database,
  intent: ChilizBridgeJournalInsert,
  plan: UnsignedDirectOftChzTransfer): Promise<boolean> {
  const persistedPlan = await planPayload(plan);
  const statements = [
    database.prepare(SEED_PAUSED_POLICY_SQL).bind(
      intent.sourceWallet, intent.destinationTreasury),
    database.prepare(ARM_CHILIZ_BRIDGE_POLICY_SQL),
    database.prepare(INSERT_PREPARED_CHILIZ_BRIDGE_SQL)
      .bind(...chilizBridgeJournalInsertBindings(intent)),
    database.prepare(INSERT_CHILIZ_BRIDGE_CANARY_PLAN_SQL).bind(
      intent.id, persistedPlan.json, persistedPlan.sha256),
    database.prepare(RESERVE_CHILIZ_BRIDGE_POLICY_SQL).bind(intent.id),
    database.prepare(ASSERT_RESERVED_INTENT_SQL).bind(intent.id,
      intent.sourceWallet, intent.destinationTreasury,
      intent.sourceAmountAtomic, intent.minimumDestinationWei,
      intent.quoteId, intent.quoteExpiresAtMs, intent.signedTransactionBase64,
      intent.signedTransactionSha256, intent.sourceSignature,
      persistedPlan.json, persistedPlan.sha256),
  ];
  // D1 batch is transactional: an assertion CHECK failure rolls back seed,
  // arm, intent and reservation together.
  const result = await database.batch(statements);
  return result.length === 6 && result.every((entry) => entry.success) &&
    result[1].meta.changes === 1 && result[2].meta.changes === 1 &&
    result[3].meta.changes === 1 && result[4].meta.changes === 1 &&
    result[5].meta.changes === 0;
}

function rawString(row: RawRow, name: string): string {
  const value = row[name];
  if (typeof value !== "string") throw new Error("bridge_worker_row_invalid");
  return value;
}

function rawInteger(row: RawRow, name: string): number {
  const value = row[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("bridge_worker_row_invalid");
  }
  return value;
}

function optionalString(row: RawRow, name: string): string | null {
  if (row[name] == null) return null;
  return rawString(row, name);
}

function optionalInteger(row: RawRow, name: string): number | null {
  if (row[name] == null) return null;
  return rawInteger(row, name);
}

async function parseRow(raw: unknown, expectedId: string,
  treasuries: { source: string; destination: string },
  database: D1Database): Promise<WorkerBridgeRow> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("bridge_worker_row_invalid");
  }
  const row = raw as RawRow;
  const sourceWallet = rawString(row, "source_wallet");
  const destinationTreasury = rawString(row, "destination_treasury");
  const sourceAmountAtomic = rawString(row, "source_amount_atomic");
  const minimumDestinationWei = rawString(row, "minimum_destination_wei");
  const signedTransactionBase64 = rawString(row, "signed_transaction_base64");
  const signedTransactionSha256 = rawString(row, "signed_transaction_sha256");
  const sourceSignature = rawString(row, "source_signature");
  const quoteId = rawString(row, "quote_id");
  const quoteExpiresAtMs = rawInteger(row, "quote_expires_at_ms");
  const state = rawString(row, "state");
  const broadcastAttemptedAtMs = optionalInteger(row, "broadcast_attempted_at_ms");
  const sourceFinalizedSlot = optionalInteger(row, "source_finalized_slot");
  const bridgeMessageId = optionalString(row, "bridge_message_id");
  const destinationTxHash = optionalString(row, "destination_tx_hash");
  const destinationReceivedWei = optionalString(row, "destination_received_wei");
  if (rawString(row, "id") !== expectedId ||
      rawString(row, "policy_key") !== "initial" ||
      rawString(row, "source_chain") !== "solana" ||
      rawInteger(row, "destination_chain_id") !== 88_888 ||
      rawString(row, "source_mint") !== MINT ||
      rawString(row, "destination_asset") !== NATIVE_CHZ ||
      rawString(row, "route_type") !== "OFT" ||
      sourceWallet !== treasuries.source ||
      destinationTreasury !== treasuries.destination ||
      !POSITIVE.test(sourceAmountAtomic) || BigInt(sourceAmountAtomic) > 1_000_000_000n ||
      !POSITIVE.test(minimumDestinationWei) ||
      BigInt(minimumDestinationWei) > BigInt(sourceAmountAtomic) * 10_000_000_000n ||
      BigInt(minimumDestinationWei) * 100n <
        BigInt(sourceAmountAtomic) * 10_000_000_000n * 95n ||
      !/^oft:[0-9a-f]{64}$/.test(quoteId) ||
      !SHA256.test(signedTransactionSha256) ||
      quoteExpiresAtMs <= 0 ||
      !["prepared", "broadcast_attempted", "source_finalized",
        "destination_finalized", "held"].includes(state) ||
      state === "prepared" && broadcastAttemptedAtMs !== null ||
      state !== "prepared" && (broadcastAttemptedAtMs === null ||
        broadcastAttemptedAtMs <= 0) ||
      (sourceFinalizedSlot === null) !== (bridgeMessageId === null) ||
      sourceFinalizedSlot !== null && sourceFinalizedSlot <= 0 ||
      bridgeMessageId !== null && !EVM_HASH.test(bridgeMessageId) ||
      ["prepared", "broadcast_attempted"].includes(state) &&
        sourceFinalizedSlot !== null ||
      ["source_finalized", "destination_finalized"].includes(state) &&
        sourceFinalizedSlot === null ||
      state === "destination_finalized" &&
        (destinationTxHash === null || !EVM_HASH.test(destinationTxHash) ||
          destinationReceivedWei === null || !POSITIVE.test(destinationReceivedWei) ||
          BigInt(destinationReceivedWei) < BigInt(minimumDestinationWei)) ||
      state !== "destination_finalized" &&
        (destinationTxHash !== null || destinationReceivedWei !== null)) {
    throw new Error("bridge_worker_row_invalid");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signedTransactionBase64)) {
    throw new Error("bridge_worker_row_invalid");
  }
  const bytes = Buffer.from(signedTransactionBase64, "base64");
  if (bytes.length < 100 || bytes.length > 1_232 ||
      bytes.toString("base64") !== signedTransactionBase64 ||
      Buffer.from(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))
        .toString("hex") !== signedTransactionSha256) {
    throw new Error("bridge_worker_row_invalid");
  }
  let transaction: VersionedTransaction;
  let signature: Uint8Array;
  try {
    transaction = VersionedTransaction.deserialize(bytes);
    signature = bs58.decode(sourceSignature);
  } catch { throw new Error("bridge_worker_row_invalid"); }
  if (transaction.version !== 0 || transaction.message.header.numRequiredSignatures !== 1 ||
      transaction.signatures.length !== 1 || signature.length !== 64 ||
      bs58.encode(signature) !== sourceSignature ||
      transaction.message.staticAccountKeys[0]?.toBase58() !== sourceWallet ||
      !Buffer.from(transaction.signatures[0]).equals(Buffer.from(signature)) ||
      !ed25519.verify(signature, transaction.message.serialize(),
        new PublicKey(sourceWallet).toBytes())) {
    throw new Error("bridge_worker_row_invalid");
  }
  const message = transaction.message;
  if (message.compiledInstructions.length !== 1 ||
      message.addressTableLookups.length > 1 ||
      message.addressTableLookups.some((lookup) =>
        lookup.accountKey.toBase58() !== LOOKUP_TABLE) ||
      !message.staticAccountKeys.some((key) => key.toBase58() ===
        getAssociatedTokenAddressSync(new PublicKey(MINT),
          new PublicKey(sourceWallet), false, TOKEN_PROGRAM_ID).toBase58())) {
    throw new Error("bridge_worker_row_invalid");
  }
  const instruction = message.compiledInstructions[0];
  if (message.staticAccountKeys[instruction.programIdIndex]?.toBase58() !== PROGRAM) {
    throw new Error("bridge_worker_row_invalid");
  }
  let decoded: ReturnType<ReturnType<typeof oft.instructions.getSendInstructionDataSerializer>["deserialize"]>[0];
  let consumed: number;
  try {
    [decoded, consumed] = oft.instructions.getSendInstructionDataSerializer()
      .deserialize(instruction.data);
  } catch { throw new Error("bridge_worker_row_invalid"); }
  const recipient = Buffer.from(padHex(destinationTreasury as `0x${string}`,
    { size: 32 }).slice(2), "hex");
  if (consumed !== instruction.data.length || decoded.dstEid !== 30_409 ||
      !Buffer.from(decoded.to).equals(recipient) ||
      decoded.amountLd !== BigInt(sourceAmountAtomic) ||
      decoded.minAmountLd * 10_000_000_000n !== BigInt(minimumDestinationWei) ||
      decoded.composeMsg.__option !== "None" || decoded.lzTokenFee !== 0n ||
      decoded.nativeFee <= 0n ||
      decoded.nativeFee > MAX_CANARY_MESSAGING_FEE_LAMPORTS) {
    throw new Error("bridge_worker_row_invalid");
  }
  const planRow = await database.prepare(SELECT_CHILIZ_BRIDGE_CANARY_PLAN_SQL)
    .bind(expectedId).first<{ plan_json: string; plan_sha256: string }>();
  if (!planRow || typeof planRow.plan_json !== "string" ||
      typeof planRow.plan_sha256 !== "string" || !SHA256.test(planRow.plan_sha256) ||
      planRow.plan_json.length < 100 || planRow.plan_json.length > 30_000) {
    throw new Error("bridge_worker_plan_missing");
  }
  const actualPlanHash = Buffer.from(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(planRow.plan_json))).toString("hex");
  if (actualPlanHash !== planRow.plan_sha256) {
    throw new Error("bridge_worker_plan_digest_mismatch");
  }
  let plan: UnsignedDirectOftChzTransfer;
  try { plan = JSON.parse(planRow.plan_json) as UnsignedDirectOftChzTransfer; }
  catch { throw new Error("bridge_worker_plan_invalid"); }
  // Revalidate exact plan+signed bytes using a historical quote time solely
  // for read-only identity proof. Actual quote freshness is checked at claim.
  const verified = await prepareDirectOftChilizBridgeJournalInsert({
    id: expectedId, plan, expectedSourceWallet: sourceWallet,
    expectedDestinationTreasury: destinationTreasury,
    signedTransactionBase64,
    nowMs: quoteExpiresAtMs - 60_000,
  });
  if (verified.sourceAmountAtomic !== sourceAmountAtomic ||
      verified.minimumDestinationWei !== minimumDestinationWei ||
      verified.quoteId !== quoteId ||
      verified.quoteExpiresAtMs !== quoteExpiresAtMs ||
      verified.sourceSignature !== sourceSignature ||
      verified.signedTransactionSha256 !== signedTransactionSha256 ||
      BigInt(plan.messagingFeeLamports) > MAX_CANARY_MESSAGING_FEE_LAMPORTS) {
    throw new Error("bridge_worker_plan_journal_mismatch");
  }
  return {
    id: expectedId, policyKey: "initial", sourceChain: "solana",
    destinationChainId: 88_888, sourceMint: MINT, destinationAsset: NATIVE_CHZ,
    sourceWallet, destinationTreasury, sourceAmountAtomic, minimumDestinationWei,
    quoteId, quoteExpiresAtMs, routeType: "OFT", signedTransactionBase64,
    signedTransactionSha256, sourceSignature,
    state: state as WorkerBridgeRow["state"], broadcastAttemptedAtMs,
    sourceFinalizedSlot, bridgeMessageId, destinationTxHash,
    destinationReceivedWei,
    plan, planSha256: planRow.plan_sha256,
  };
}

function reconciledResponse(row: Pick<WorkerBridgeRow,
  "sourceSignature" | "bridgeMessageId" | "destinationTxHash" |
  "destinationReceivedWei">): Response {
  return response({ state: "destination_finalized",
    sourceSignature: row.sourceSignature,
    bridgeMessageId: row.bridgeMessageId,
    destinationTxHash: row.destinationTxHash,
    receivedWei: row.destinationReceivedWei }, 200);
}

/** No prepare, arm, broadcast, or public read operation exists here. */
export async function handleChilizBridgeWorkerRequest(request: Request,
  deps: BridgeWorkerApiDependencies): Promise<Response> {
  if (!deps.canaryEnabled) return response({ error: "Not found." }, 404);
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!deps.workerToken || !supplied ||
      !(await tokenEqual(deps.workerToken, supplied))) {
    return response({ error: "Worker authentication required." }, 401);
  }
  if (!deps.database) return response({ error: "Bridge database unavailable." }, 503);
  const treasuries = canonicalTreasuries(deps);
  if (!treasuries) return response({ error: "Bridge treasury configuration unavailable." }, 503);
  let input: z.infer<typeof requestSchema>;
  try {
    const text = await request.text();
    if (text.length > 20_000) throw new Error("oversized");
    input = requestSchema.parse(JSON.parse(text));
  } catch { return response({ error: "Invalid worker request." }, 400); }
  if (input.workerId !== `solana:${treasuries.source}`) {
    return response({ error: "Worker identity mismatch." }, 403);
  }
  if (input.action === "prepare_and_reserve") {
    if (!deps.prepareEnabled) return response({ error: "Not found." }, 404);
    // Refuse a costly quote before a reservation can arm the policy. Load and
    // claim also independently decode the persisted signed instruction above.
    const fee = (input.plan as Record<string, unknown>).messagingFeeLamports;
    if (typeof fee !== "string" || !POSITIVE.test(fee) ||
        BigInt(fee) > MAX_CANARY_MESSAGING_FEE_LAMPORTS) {
      return response({ error: "Signed bridge intent invalid." }, 400);
    }
    let intent: ChilizBridgeJournalInsert;
    try {
      intent = await prepareDirectOftChilizBridgeJournalInsert({
        id: input.id,
        plan: input.plan as UnsignedDirectOftChzTransfer,
        expectedSourceWallet: treasuries.source,
        expectedDestinationTreasury: treasuries.destination,
        signedTransactionBase64: input.signedTransactionBase64,
        nowMs: deps.nowMs?.() ?? Date.now(),
      });
    } catch { return response({ error: "Signed bridge intent invalid." }, 400); }
    try {
      if (!await reservePreparedDirectOftCanary(deps.database, intent,
        input.plan as UnsignedDirectOftChzTransfer)) {
        return response({ error: "Bridge reservation rejected." }, 409);
      }
      const raw = await deps.database.prepare(SELECT_CHILIZ_BRIDGE_SQL)
        .bind(intent.id).first<RawRow>();
      const row = await parseRow(raw, intent.id, treasuries, deps.database);
      if (row.state !== "prepared" || row.signedTransactionSha256 !==
          intent.signedTransactionSha256 || row.sourceSignature !== intent.sourceSignature) {
        throw new Error("bridge_worker_prepare_readback_invalid");
      }
      return response({ journal: row }, 200);
    } catch { return response({ error: "Bridge reservation unavailable." }, 503); }
  }
  let row: WorkerBridgeRow;
  try {
    const raw = await deps.database.prepare(SELECT_CHILIZ_BRIDGE_SQL)
      .bind(input.id).first<RawRow>();
    if (!raw) return response({ error: "Reserved bridge intent not found." }, 404);
    row = await parseRow(raw, input.id, treasuries, deps.database);
  } catch { return response({ error: "Reserved bridge intent unavailable." }, 503); }
  if (input.action === "load") return response({ journal: row }, 200);
  if (input.action === "reconcile") {
    if (row.state === "destination_finalized") return reconciledResponse(row);
    if (row.state === "prepared") {
      return response({ error: "Bridge broadcast has not been claimed." }, 409);
    }
    if (!deps.solanaRpcUrl || !deps.primaryChilizRpcUrl ||
        !deps.secondaryChilizRpcUrl) {
      return response({ error: "Bridge reconciliation RPC unavailable." }, 503);
    }
    let proof: Awaited<ReturnType<typeof reconcileClaimedDirectOftBroadcast>>;
    try {
      proof = await (deps.reconcileImpl ?? reconcileClaimedDirectOftBroadcast)({
        journal: row, plan: row.plan,
        solanaRpcUrl: deps.solanaRpcUrl,
        primaryChilizRpcUrl: deps.primaryChilizRpcUrl,
        secondaryChilizRpcUrl: deps.secondaryChilizRpcUrl,
      });
    } catch {
      return response({ error: "Bridge delivery not yet verified." }, 409);
    }
    const source = proof.source;
    const destination = proof.destination;
    const finalizedBlock = Number(destination.finalizedBlock);
    if (proof.journalId !== row.id || proof.guid !== source.bridgeMessageId ||
        proof.guid !== destination.bridgeMessageId ||
        source.sourceSignature !== row.sourceSignature ||
        source.sourceWallet !== row.sourceWallet ||
        source.quoteId !== row.quoteId ||
        source.sourceAmountAtomic !== row.sourceAmountAtomic ||
        source.signedTransactionSha256 !== row.signedTransactionSha256 ||
        destination.destinationTreasury !== row.destinationTreasury ||
        destination.destinationAsset !== row.destinationAsset ||
        destination.chainId !== row.destinationChainId ||
        !Number.isSafeInteger(finalizedBlock) || finalizedBlock <= 0 ||
        !POSITIVE.test(destination.receivedWei) ||
        BigInt(destination.receivedWei) < BigInt(row.minimumDestinationWei)) {
      return response({ error: "Bridge delivery proof invalid." }, 409);
    }
    try {
      if (row.sourceFinalizedSlot === null) {
        const saved = await deps.database.prepare(FINALIZE_CHILIZ_BRIDGE_SOURCE_SQL)
          .bind(row.id, row.sourceSignature, source.finalizedSlot,
            JSON.stringify(source), proof.guid).run();
        if (!saved.success || saved.meta.changes !== 1) {
          return response({ error: "Bridge source finalization rejected." }, 409);
        }
      } else if (row.sourceFinalizedSlot !== source.finalizedSlot ||
          row.bridgeMessageId !== proof.guid) {
        return response({ error: "Bridge source proof conflicts." }, 409);
      }
      const saved = await deps.database.prepare(FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL)
        .bind(row.id, proof.guid, destination.transactionHash,
          destination.finalizedBlock,
          destination.receivedWei, JSON.stringify(destination)).run();
      if (!saved.success || saved.meta.changes !== 1) {
        return response({ error: "Bridge destination finalization rejected." }, 409);
      }
    } catch {
      return response({ error: "Bridge finalization unavailable." }, 503);
    }
    return reconciledResponse({ sourceSignature: row.sourceSignature,
      bridgeMessageId: proof.guid,
      destinationTxHash: destination.transactionHash,
      destinationReceivedWei: destination.receivedWei });
  }
  if (row.state !== "prepared" ||
      input.sourceSignature !== row.sourceSignature ||
      input.signedTransactionSha256 !== row.signedTransactionSha256) {
    return response({ error: "Bridge broadcast claim rejected." }, 409);
  }
  const nowMs = deps.nowMs?.() ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      row.quoteExpiresAtMs <= nowMs + 30_000) {
    return response({ error: "Bridge quote expired." }, 409);
  }
  try {
    // D1 serializes statements per database. This single conditional UPDATE
    // is an atomic prepared->attempted compare-and-set; changes=1 is required.
    const claimed = await deps.database.prepare(MARK_CHILIZ_BRIDGE_BROADCAST_SQL)
      .bind(row.id, row.sourceSignature, nowMs).run();
    if (!claimed.success || claimed.meta.changes !== 1) {
      return response({ error: "Bridge broadcast claim rejected." }, 409);
    }
  } catch { return response({ error: "Bridge broadcast claim unavailable." }, 503); }
  return response({ changedRows: 1, journal: {
    ...row, state: "broadcast_attempted", broadcastAttemptedAtMs: nowMs,
  } satisfies WorkerBridgeRow }, 200);
}
