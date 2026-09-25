import { getAddress } from "viem";
import { z } from "zod";
import type { ChilizSignedIntent } from "../../../../../lib/protocol/chiliz-signed-intent.ts";
import { FINALIZE_AFC_BUY_CANARY_SQL, INSERT_AFC_BUY_CANARY_SQL, MARK_AFC_BUY_CANARY_BROADCAST_SQL,
  SELECT_AFC_BUY_CANARY_SQL, afcBuyCanaryInsertBindings } from
  "../../../../../lib/server/chiliz-afc-buy-canary-journal.ts";
import { verifyAfcV2BuyCanaryIntent } from
  "../../../../../lib/server/providers/chiliz-v2-buy-canary-intent.ts";
import type { AfcBuyCanaryIntent } from
  "../../../../../lib/server/providers/chiliz-v2-buy-canary-intent.ts";
import { verifyAfcV2BuyCanaryReceipt,
  type AfcBuyCanaryReceiptProof } from
  "../../../../../lib/server/providers/chiliz-afc-v2-buy-receipt.ts";

const HASH = /^0x[0-9a-f]{64}$/;
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("load"), workerId: z.string() }).strict(),
  z.object({ action: z.literal("prepare"), workerId: z.string(),
    intent: z.record(z.unknown()) }).strict(),
  z.object({ action: z.literal("claim_broadcast"), workerId: z.string(),
    txHash: z.string().regex(HASH) }).strict(),
  z.object({ action: z.literal("finalize"), workerId: z.string(),
    txHash: z.string().regex(HASH) }).strict(),
]);

type RawRow = Record<string, unknown>;
export type AfcBuyCanaryRow = Readonly<{
  id: "initial";
  intent: AfcBuyCanaryIntent;
  state: "prepared" | "broadcast_attempted" | "finalized_success" | "finalized_reverted";
  broadcastAttemptedAtMs: number | null;
  receiptProof: AfcBuyCanaryReceiptProof | null;
}>;
export type AfcBuyCanaryApiDependencies = Readonly<{
  database: D1Database | null | undefined;
  workerToken: string | null;
  canaryEnabled: boolean;
  prepareEnabled: boolean;
  chilizTreasury: string | null;
  primaryRpcUrl?: string;
  secondaryRpcUrl?: string;
  verifyReceipt?: typeof verifyAfcV2BuyCanaryReceipt;
  nowMs?: () => number;
}>;

function respond(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store, max-age=0", Pragma: "no-cache",
  } });
}

async function equalToken(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([left, right].map((value) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function parseRow(raw: unknown, treasury: string): Promise<AfcBuyCanaryRow> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("afc_buy_canary_row_invalid");
  }
  const row = raw as RawRow;
  let intent: ChilizSignedIntent;
  try { intent = JSON.parse(String(row.intent_json)) as ChilizSignedIntent; }
  catch { throw new Error("afc_buy_canary_row_invalid"); }
  const verified = await verifyAfcV2BuyCanaryIntent({ intent,
    expectedTreasury: treasury, requireFresh: false });
  const state = row.state;
  const attempted = row.broadcast_attempted_at_ms;
  let receiptProof: AfcBuyCanaryReceiptProof | null = null;
  if (state === "finalized_success" || state === "finalized_reverted") {
    try { receiptProof = JSON.parse(String(row.receipt_evidence_json)) as
      AfcBuyCanaryReceiptProof; }
    catch { throw new Error("afc_buy_canary_row_invalid"); }
    if (!receiptProof || receiptProof.txHash !== verified.txHash.toLowerCase() ||
        receiptProof.receiptStatus !== (state === "finalized_success" ? "success" : "reverted") ||
        receiptProof.receiptBlockHash !== row.receipt_block_hash ||
        receiptProof.receiptBlockNumber !== row.receipt_block_number ||
        receiptProof.finalizedBlockNumber !== row.finalized_block_number ||
        receiptProof.outputAmountAtomic !== row.output_amount_atomic ||
        receiptProof.finalizedBlockNumber < receiptProof.receiptBlockNumber ||
        state === "finalized_success" &&
          BigInt(receiptProof.outputAmountAtomic) < BigInt(verified.minimumOutputAtomic) ||
        state === "finalized_reverted" && receiptProof.outputAmountAtomic !== "0") {
      throw new Error("afc_buy_canary_row_invalid");
    }
  }
  if (row.id !== "initial" || row.treasury_address !== verified.treasury.toLowerCase() ||
      row.fan_token_contract !== verified.fanTokenContract.toLowerCase() ||
      row.amount_in_wei !== verified.valueWei ||
      row.minimum_output_atomic !== verified.minimumOutputAtomic ||
      row.nonce !== verified.nonce ||
      row.deadline_epoch_seconds !== verified.deadlineEpochSeconds ||
      row.maximum_network_fee_wei !== verified.maximumNetworkFeeWei ||
      row.tx_hash !== verified.txHash.toLowerCase() ||
      row.raw_transaction !== verified.rawTransaction.toLowerCase() ||
      !(state === "prepared" && attempted === null && receiptProof === null ||
        ["broadcast_attempted", "finalized_success", "finalized_reverted"]
          .includes(String(state)) && typeof attempted === "number" &&
          Number.isSafeInteger(attempted) && attempted > 0 &&
          (state === "broadcast_attempted" ? receiptProof === null : receiptProof !== null))) {
    throw new Error("afc_buy_canary_row_invalid");
  }
  return { id: "initial", intent: verified,
    state: state as AfcBuyCanaryRow["state"],
    broadcastAttemptedAtMs: attempted as number | null, receiptProof };
}

/** No public read or execution endpoint: only the configured Chiliz worker. */
export async function handleAfcV2BuyCanaryRequest(request: Request,
  deps: AfcBuyCanaryApiDependencies): Promise<Response> {
  if (!deps.canaryEnabled) return respond({ error: "Not found." }, 404);
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!deps.workerToken || !token || !await equalToken(deps.workerToken, token)) {
    return respond({ error: "Worker authentication required." }, 401);
  }
  if (!deps.database) return respond({ error: "Canary database unavailable." }, 503);
  let treasury: string;
  try { treasury = getAddress(deps.chilizTreasury ?? ""); }
  catch { return respond({ error: "Canary treasury unavailable." }, 503); }
  let input: z.infer<typeof requestSchema>;
  try {
    const body = await request.text();
    if (body.length > 20_000) throw Error();
    input = requestSchema.parse(JSON.parse(body));
  } catch { return respond({ error: "Invalid canary request." }, 400); }
  if (input.workerId !== `chiliz:${treasury.toLowerCase()}`) {
    return respond({ error: "Worker identity mismatch." }, 403);
  }
  if (input.action === "prepare") {
    if (!deps.prepareEnabled) return respond({ error: "Not found." }, 404);
    let verified: AfcBuyCanaryIntent;
    try { verified = await verifyAfcV2BuyCanaryIntent({
      intent: input.intent as ChilizSignedIntent, expectedTreasury: treasury,
      nowEpochSeconds: Math.floor((deps.nowMs?.() ?? Date.now()) / 1_000),
    }); }
    catch { return respond({ error: "Signed canary intent invalid." }, 400); }
    try {
      const inserted = await deps.database.prepare(INSERT_AFC_BUY_CANARY_SQL)
        .bind(...afcBuyCanaryInsertBindings(verified)).run();
      if (!inserted.success || inserted.meta.changes !== 1) {
        return respond({ error: "Canary reservation rejected." }, 409);
      }
      const raw = await deps.database.prepare(SELECT_AFC_BUY_CANARY_SQL)
        .first<RawRow>();
      const row = await parseRow(raw, treasury);
      if (row.state !== "prepared" || row.intent.txHash !== verified.txHash) {
        throw new Error("afc_buy_canary_readback_invalid");
      }
      return respond({ journal: row }, 200);
    } catch { return respond({ error: "Canary reservation unavailable." }, 503); }
  }
  let row: AfcBuyCanaryRow;
  try {
    const raw = await deps.database.prepare(SELECT_AFC_BUY_CANARY_SQL)
      .first<RawRow>();
    if (!raw) return respond({ error: "Canary intent not found." }, 404);
    row = await parseRow(raw, treasury);
  } catch { return respond({ error: "Canary intent unavailable." }, 503); }
  if (input.action === "load") return respond({ journal: row }, 200);
  if (input.action === "finalize") {
    if (row.state !== "broadcast_attempted" ||
        input.txHash !== row.intent.txHash.toLowerCase()) {
      return respond({ error: "Canary finalization rejected." }, 409);
    }
    let proof: AfcBuyCanaryReceiptProof;
    try {
      proof = await (deps.verifyReceipt ?? verifyAfcV2BuyCanaryReceipt)({
        intent: row.intent,
        primaryRpcUrl: deps.primaryRpcUrl ?? "https://rpc.ankr.com/chiliz",
        secondaryRpcUrl: deps.secondaryRpcUrl ?? "https://chiliz-rpc.publicnode.com",
      });
    } catch { return respond({ error: "Canary finality not yet verified." }, 409); }
    if (proof.txHash !== row.intent.txHash.toLowerCase() ||
        proof.receiptStatus !== "success" && proof.receiptStatus !== "reverted" ||
        proof.receiptStatus === "success" &&
          BigInt(proof.outputAmountAtomic) < BigInt(row.intent.minimumOutputAtomic) ||
        proof.receiptStatus === "reverted" && proof.outputAmountAtomic !== "0") {
      return respond({ error: "Canary receipt invalid." }, 409);
    }
    const finalState = proof.receiptStatus === "success" ?
      "finalized_success" : "finalized_reverted";
    try {
      const finalized = await deps.database.prepare(FINALIZE_AFC_BUY_CANARY_SQL)
        .bind(row.intent.txHash.toLowerCase(), finalState, proof.receiptStatus,
          proof.receiptBlockHash, proof.receiptBlockNumber,
          proof.finalizedBlockNumber, proof.outputAmountAtomic,
          JSON.stringify(proof)).run();
      if (!finalized.success || finalized.meta.changes !== 1) {
        return respond({ error: "Canary finalization rejected." }, 409);
      }
    } catch { return respond({ error: "Canary finalization unavailable." }, 503); }
    return respond({ finalized: true, state: finalState,
      txHash: row.intent.txHash, outputAmountAtomic: proof.outputAmountAtomic }, 200);
  }
  if (row.state !== "prepared" || input.txHash !== row.intent.txHash.toLowerCase() ||
      row.broadcastAttemptedAtMs !== null) {
    return respond({ error: "Canary broadcast claim rejected." }, 409);
  }
  const nowMs = deps.nowMs?.() ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      row.intent.deadlineEpochSeconds <= Math.floor(nowMs / 1_000) + 15) {
    return respond({ error: "Canary transaction expired." }, 409);
  }
  try {
    const marked = await deps.database.prepare(MARK_AFC_BUY_CANARY_BROADCAST_SQL)
      .bind(row.intent.txHash.toLowerCase(), nowMs).run();
    if (!marked.success || marked.meta.changes !== 1) {
      return respond({ error: "Canary broadcast claim rejected." }, 409);
    }
  } catch { return respond({ error: "Canary broadcast claim unavailable." }, 503); }
  return respond({ changedRows: 1, journal: { ...row,
    state: "broadcast_attempted", broadcastAttemptedAtMs: nowMs } }, 200);
}
