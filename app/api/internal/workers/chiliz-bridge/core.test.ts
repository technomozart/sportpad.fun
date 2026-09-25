import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Keypair, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { padHex } from "viem";
import {
  MARK_CHILIZ_BRIDGE_BROADCAST_SQL, SELECT_CHILIZ_BRIDGE_SQL,
  type ChilizBridgeJournalInsert,
} from "../../../../../lib/server/chiliz-bridge-journal.ts";
import { handleChilizBridgeWorkerRequest,
  reservePreparedDirectOftCanary } from "./core.ts";

const wallet = Keypair.fromSeed(new Uint8Array(32).fill(31));
const destination = "0x42c40359da463b480c3dc9e7a4d9c1ac2ef45c21";
const mint = new PublicKey("6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw");
const program = new PublicKey("BcRpUE1jvLvgchaYntfi2weReWVG8THCRLFy73CmxjHo");
const store = new PublicKey("9SBbd5mXvCimWXpggkE8PJpXMjBddDhWWZY1eW1BhvUF");
const sourceAta = getAssociatedTokenAddressSync(mint, wallet.publicKey,
  false, TOKEN_PROGRAM_ID);
const sourceAmount = 100_000_000n;
const minimum = 99_000_000n;
const nowMs = 1_800_000_000_000;
const token = "worker-token-that-remains-private-and-high-entropy";

function initialRow(nativeFee = 345_783n) {
  const send = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: store, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(oft.instructions.getSendInstructionDataSerializer().serialize({
      dstEid: 30_409,
      to: Buffer.from(padHex(destination, { size: 32 }).slice(2), "hex"),
      amountLd: sourceAmount, minAmountLd: minimum,
      options: new Uint8Array(), composeMsg: null,
      nativeFee, lzTokenFee: 0n,
    })),
  });
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [send],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([wallet]);
  const bytes = transaction.serialize();
  return {
    id: "bridge-canary-1",
    policy_key: "initial",
    source_chain: "solana",
    destination_chain_id: 88888,
    source_mint: mint.toBase58(),
    destination_asset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    source_wallet: wallet.publicKey.toBase58(),
    destination_treasury: destination,
    source_amount_atomic: sourceAmount.toString(),
    minimum_destination_wei: (minimum * 10_000_000_000n).toString(),
    quote_id: `oft:${"a".repeat(64)}`,
    quote_expires_at_ms: nowMs + 60_000,
    route_type: "OFT",
    signed_transaction_base64: Buffer.from(bytes).toString("base64"),
    signed_transaction_sha256: createHash("sha256").update(bytes).digest("hex"),
    source_signature: bs58.encode(transaction.signatures[0]),
    state: "prepared",
    broadcast_attempted_at_ms: null as number | null,
    source_finalized_slot: null,
    bridge_message_id: null,
    destination_tx_hash: null,
  };
}

function fixture() {
  let row = initialRow();
  let prepared = 0;
  let updates = 0;
  let forcedZero = false;
  const database = {
    prepare(sql: string) {
      prepared++;
      if (sql === SELECT_CHILIZ_BRIDGE_SQL) return {
        bind(id: string) {
          return { first: async () => row.id === id ? row : null };
        },
      };
      if (sql === MARK_CHILIZ_BRIDGE_BROADCAST_SQL) return {
        bind(id: string, signature: string, atMs: number) {
          return { run: async () => {
            updates++;
            const changed = !forcedZero && row.id === id &&
              row.source_signature === signature && row.state === "prepared" &&
              row.quote_expires_at_ms > atMs;
            if (changed) row = { ...row, state: "broadcast_attempted",
              broadcast_attempted_at_ms: atMs };
            return { success: true, meta: { changes: changed ? 1 : 0 } };
          } };
        },
      };
      throw new Error("unexpected SQL");
    },
  };
  const deps = {
    database: database as unknown as D1Database,
    workerToken: token,
    canaryEnabled: true,
    rewardTreasury: wallet.publicKey.toBase58(),
    chilizTreasury: destination,
    nowMs: () => nowMs,
  };
  const request = (action: "load" | "claim_broadcast", overrides: Record<string, unknown> = {},
    bearer = token) => new Request("https://sportpad.fun/api/internal/workers/chiliz-bridge", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ action, id: row.id,
        workerId: `solana:${wallet.publicKey.toBase58()}`,
        ...(action === "claim_broadcast" ? {
          sourceSignature: row.source_signature,
          signedTransactionSha256: row.signed_transaction_sha256,
        } : {}), ...overrides }),
    });
  return { deps, request, get row() { return row; },
    get prepared() { return prepared; }, get updates() { return updates; },
    forceZero() { forcedZero = true; },
    changeRow(value: Partial<typeof row>) { row = { ...row, ...value }; } };
}

test("off-by-default canary gate and Bearer auth never return signed bytes", async () => {
  const f = fixture();
  const off = await handleChilizBridgeWorkerRequest(f.request("load"),
    { ...f.deps, canaryEnabled: false });
  assert.equal(off.status, 404);
  assert.equal((await off.text()).includes(f.row.signed_transaction_base64), false);
  const unauth = await handleChilizBridgeWorkerRequest(f.request("load", {}, "wrong"),
    f.deps);
  assert.equal(unauth.status, 401);
  assert.equal((await unauth.text()).includes(f.row.signed_transaction_base64), false);
  assert.equal(f.prepared, 0);
});

test("authenticated load returns only reserved exact direct-OFT row without caching", async () => {
  const f = fixture();
  const result = await handleChilizBridgeWorkerRequest(f.request("load"), f.deps);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control") ?? "", /no-store/);
  const body = await result.json() as { journal: Record<string, unknown> };
  assert.equal(body.journal.signedTransactionBase64, f.row.signed_transaction_base64);
  assert.equal(body.journal.sourceSignature, f.row.source_signature);
  assert.equal(body.journal.state, "prepared");
  assert.equal(f.updates, 0);
});

test("wrong worker identity cannot read or claim", async () => {
  const f = fixture();
  for (const action of ["load", "claim_broadcast"] as const) {
    const result = await handleChilizBridgeWorkerRequest(
      f.request(action, { workerId: `solana:${Keypair.generate().publicKey.toBase58()}` }), f.deps);
    assert.equal(result.status, 403);
  }
  assert.equal(f.prepared, 0);
});

test("claim uses exact atomic MARK and returns changedRows=1 only once", async () => {
  const f = fixture();
  const first = await handleChilizBridgeWorkerRequest(f.request("claim_broadcast"), f.deps);
  assert.equal(first.status, 200);
  const claimed = await first.json() as { changedRows: number;
    journal: { state: string; broadcastAttemptedAtMs: number } };
  assert.equal(claimed.changedRows, 1);
  assert.equal(claimed.journal.state, "broadcast_attempted");
  assert.equal(claimed.journal.broadcastAttemptedAtMs, nowMs);
  assert.equal(f.updates, 1);
  const repeat = await handleChilizBridgeWorkerRequest(f.request("claim_broadcast"), f.deps);
  assert.equal(repeat.status, 409);
  assert.equal((await repeat.text()).includes(f.row.signed_transaction_base64), false);
  assert.equal(f.updates, 1);
});

test("concurrent claims yield exactly one signed-row response", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    handleChilizBridgeWorkerRequest(f.request("claim_broadcast"), f.deps),
    handleChilizBridgeWorkerRequest(f.request("claim_broadcast"), f.deps),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const [firstBody, secondBody] = await Promise.all([a.text(), b.text()]);
  assert.equal([firstBody, secondBody].filter((body) =>
    body.includes(f.row.signed_transaction_base64)).length, 1);
  assert.equal(f.row.state, "broadcast_attempted");
});

test("changed signature, SHA, or expired quote cannot claim", async () => {
  const f = fixture();
  for (const override of [
    { sourceSignature: bs58.encode(new Uint8Array(64).fill(1)) },
    { signedTransactionSha256: "f".repeat(64) },
  ]) {
    const result = await handleChilizBridgeWorkerRequest(
      f.request("claim_broadcast", override), f.deps);
    assert.equal(result.status, 409);
  }
  f.changeRow({ quote_expires_at_ms: nowMs + 20_000 });
  const expired = await handleChilizBridgeWorkerRequest(f.request("claim_broadcast"), f.deps);
  assert.equal(expired.status, 409);
  assert.equal(f.updates, 0);
});

test("zero-row D1 compare-and-set is rejected without exposing signed bytes", async () => {
  const f = fixture();
  f.forceZero();
  const result = await handleChilizBridgeWorkerRequest(f.request("claim_broadcast"), f.deps);
  assert.equal(result.status, 409);
  assert.equal((await result.text()).includes(f.row.signed_transaction_base64), false);
  assert.equal(f.updates, 1);
});

test("corrupt persisted signed transaction fails closed", async () => {
  const f = fixture();
  f.changeRow({ signed_transaction_sha256: "b".repeat(64) });
  const result = await handleChilizBridgeWorkerRequest(f.request("load"), f.deps);
  assert.equal(result.status, 503);
  assert.equal((await result.text()).includes(f.row.signed_transaction_base64), false);
});

test("one-shot fee ceiling rejects costly persisted signed instructions", async () => {
  const f = fixture();
  f.changeRow(initialRow(500_001n));
  const loaded = await handleChilizBridgeWorkerRequest(f.request("load"), f.deps);
  assert.equal(loaded.status, 503);
  const claimed = await handleChilizBridgeWorkerRequest(
    f.request("claim_broadcast"), f.deps);
  assert.equal(claimed.status, 503);
  assert.equal(f.updates, 0);
});

test("prepare is independently off and rejects a forged plan before D1 writes", async () => {
  const f = fixture();
  const prepare = () => new Request("https://sportpad.fun/api/internal/workers/chiliz-bridge", {
    method: "POST", headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "prepare_and_reserve", id: f.row.id,
      workerId: `solana:${wallet.publicKey.toBase58()}`,
      plan: { sourceWallet: wallet.publicKey.toBase58() },
      signedTransactionBase64: f.row.signed_transaction_base64 }),
  });
  const off = await handleChilizBridgeWorkerRequest(prepare(), f.deps);
  assert.equal(off.status, 404);
  const invalid = await handleChilizBridgeWorkerRequest(prepare(),
    { ...f.deps, prepareEnabled: true });
  assert.equal(invalid.status, 400);
  assert.equal(f.prepared, 0);
});

test("prepare rejects >500000 lamport quote without any database access", async () => {
  const f = fixture();
  const request = new Request("https://sportpad.fun/api/internal/workers/chiliz-bridge", {
    method: "POST", headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "prepare_and_reserve", id: f.row.id,
      workerId: `solana:${wallet.publicKey.toBase58()}`,
      plan: { messagingFeeLamports: "500001" },
      signedTransactionBase64: f.row.signed_transaction_base64 }),
  });
  const result = await handleChilizBridgeWorkerRequest(request,
    { ...f.deps, prepareEnabled: true });
  assert.equal(result.status, 400);
  assert.equal(f.prepared, 0);
});

test("reservation batches paused seed, arm, exact signed intent, reserve and rollback assertion", async () => {
  const intent: ChilizBridgeJournalInsert = {
    id: "bridge-canary-1", sourceWallet: wallet.publicKey.toBase58(),
    destinationTreasury: destination, sourceAmountAtomic: sourceAmount.toString(),
    minimumDestinationWei: (minimum * 10_000_000_000n).toString(),
    quoteId: `oft:${"a".repeat(64)}`, quoteExpiresAtMs: nowMs + 60_000,
    routeType: "OFT", signedTransactionBase64: initialRow().signed_transaction_base64,
    signedTransactionSha256: initialRow().signed_transaction_sha256,
    sourceSignature: initialRow().source_signature, nowMs,
  };
  let observed: Array<{ sql: string; bindings: unknown[] }> = [];
  const database = {
    prepare(sql: string) {
      return { bind(...bindings: unknown[]) { return { sql, bindings }; }, sql, bindings: [] };
    },
    async batch(statements: Array<{ sql: string; bindings: unknown[] }>) {
      observed = statements;
      return [0, 1, 1, 1, 0].map((changes) => ({ success: true,
        meta: { changes } }));
    },
  } as unknown as D1Database;
  assert.equal(await reservePreparedDirectOftCanary(database, intent), true);
  assert.equal(observed.length, 5);
  assert.match(observed[0].sql, /INSERT OR IGNORE INTO chiliz_bridge_policy/);
  assert.match(observed[1].sql, /state = 'armed'/);
  assert.match(observed[2].sql, /signed_transaction_base64/);
  assert.match(observed[3].sql, /reserved_bridge_id = \?1/);
  assert.match(observed[4].sql, /invalid-canary-assertion/);
  assert.deepEqual(observed[2].bindings.slice(0, 3),
    [intent.id, intent.sourceWallet, intent.destinationTreasury]);
  assert.equal(observed[2].bindings[8], intent.signedTransactionBase64);
  assert.equal(observed[4].bindings[8], intent.signedTransactionSha256);
});
