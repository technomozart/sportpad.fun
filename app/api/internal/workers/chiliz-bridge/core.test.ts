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
  FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL, FINALIZE_CHILIZ_BRIDGE_SOURCE_SQL,
  MARK_CHILIZ_BRIDGE_BROADCAST_SQL, SELECT_CHILIZ_BRIDGE_SQL,
  type ChilizBridgeJournalInsert,
} from "../../../../../lib/server/chiliz-bridge-journal.ts";
import { DIRECT_CHZ_OFT } from "../../../../../lib/server/providers/chiliz-direct-oft.ts";
import type { ReconciledDirectOftEvidence } from
  "../../../../../lib/server/providers/direct-oft-reconcile.ts";
import type { UnsignedDirectOftChzTransfer } from
  "../../../../../lib/server/providers/chiliz-direct-oft-build.ts";
import { handleChilizBridgeWorkerRequest,
  reservePreparedDirectOftCanary, SELECT_CHILIZ_BRIDGE_CANARY_PLAN_SQL } from "./core.ts";

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
  const unsignedTransactionBase64 = Buffer.from(transaction.serialize()).toString("base64");
  transaction.sign([wallet]);
  const bytes = transaction.serialize();
  const snapshot = JSON.stringify({
    route: "SOLANA_CHZ_TO_NATIVE_CHILIZ_CHZ_OFT",
    sourceMint: mint.toBase58(), sourceProgram: program.toBase58(),
    sourceStore: store.toBase58(), sourceAta: sourceAta.toBase58(),
    sourceEscrow: store.toBase58(), destinationEid: 30_409,
    destinationAdapter: DIRECT_CHZ_OFT.chilizNativeAdapter,
    destinationWallet: destination, sourceAmountAtomic: sourceAmount.toString(),
    minimumReceiveAtomic: minimum.toString(),
    quotedReceiveAtomic: sourceAmount.toString(),
    messagingFeeLamports: nativeFee.toString(), optionsHex: "",
    blockhash: message.recentBlockhash, lastValidBlockHeight: 100,
  });
  const quoteHash = createHash("sha256").update(snapshot).digest("hex");
  const testPlan = {
    sourceWallet: wallet.publicKey.toBase58(), sourceMint: DIRECT_CHZ_OFT.solanaMint,
    sourceProgram: DIRECT_CHZ_OFT.solanaProgram, sourceStore: DIRECT_CHZ_OFT.solanaStore,
    sourceTokenAccount: sourceAta.toBase58(), sourceEscrow: store.toBase58(),
    sourceLookupTable: DIRECT_CHZ_OFT.solanaAddressLookupTable,
    destinationTreasury: destination, destinationEid: DIRECT_CHZ_OFT.chilizEid,
    destinationAdapter: DIRECT_CHZ_OFT.chilizNativeAdapter,
    sourceAmountAtomic: sourceAmount.toString(),
    minimumReceiveAtomic: minimum.toString(),
    quotedReceiveAtomic: sourceAmount.toString(),
    minimumDestinationWei: (minimum * 10_000_000_000n).toString(),
    messagingFeeLamports: nativeFee.toString(), extraOptionsHex: "0x",
    onchainQuoteDigestSha256: quoteHash,
    expectedMessageSha256: createHash("sha256").update(message.serialize()).digest("hex"),
    unsignedMessageBase64: Buffer.from(message.serialize()).toString("base64"),
    unsignedTransactionBase64, recentBlockhash: message.recentBlockhash,
    lastValidBlockHeight: 100, quoteExpiresAtMs: nowMs + 60_000,
    executionReady: false as const,
  } satisfies UnsignedDirectOftChzTransfer;
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
    quote_id: `oft:${quoteHash}`,
    quote_expires_at_ms: nowMs + 60_000,
    route_type: "OFT",
    signed_transaction_base64: Buffer.from(bytes).toString("base64"),
    signed_transaction_sha256: createHash("sha256").update(bytes).digest("hex"),
    source_signature: bs58.encode(transaction.signatures[0]),
    state: "prepared",
    broadcast_attempted_at_ms: null as number | null,
    source_finalized_slot: null as number | null,
    bridge_message_id: null as string | null,
    destination_tx_hash: null as string | null,
    destination_received_wei: null as string | null,
    _testPlan: testPlan,
  };
}

function fixture() {
  let row = initialRow();
  let prepared = 0;
  let updates = 0;
  let forcedZero = false;
  let forcedMissingPlan = false;
  let forcedDestinationZero = false;
  let sourceFinalizations = 0;
  let destinationFinalizations = 0;
  const database = {
    prepare(sql: string) {
      prepared++;
      if (sql === SELECT_CHILIZ_BRIDGE_SQL) return {
        bind(id: string) {
          return { first: async () => row.id === id ? row : null };
        },
      };
      if (sql === SELECT_CHILIZ_BRIDGE_CANARY_PLAN_SQL) return {
        bind(id: string) { return { first: async () => !forcedMissingPlan && row.id === id ? {
          plan_json: JSON.stringify(row._testPlan),
          plan_sha256: createHash("sha256")
            .update(JSON.stringify(row._testPlan)).digest("hex"),
        } : null }; },
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
      if (sql === FINALIZE_CHILIZ_BRIDGE_SOURCE_SQL) return {
        bind(id: string, signature: string, slot: number,
          evidenceJson: string, guid: string) {
          return { run: async () => {
            sourceFinalizations++;
            const evidence = JSON.parse(evidenceJson);
            const changed = row.id === id && row.source_signature === signature &&
              row.state === "broadcast_attempted" &&
              evidence.finalized === true && evidence.finalizedSlot === slot &&
              evidence.bridgeMessageId === guid;
            if (changed) row = { ...row, state: "source_finalized",
              source_finalized_slot: slot, bridge_message_id: guid };
            return { success: true, meta: { changes: changed ? 1 : 0 } };
          } };
        },
      };
      if (sql === FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL) return {
        bind(id: string, guid: string, txHash: string, block: string,
          receivedWei: string, evidenceJson: string) {
          return { run: async () => {
            destinationFinalizations++;
            const evidence = JSON.parse(evidenceJson);
            const changed = !forcedDestinationZero && row.id === id &&
              row.bridge_message_id === guid && row.state === "source_finalized" &&
              evidence.finalized === true && evidence.transactionHash === txHash &&
              evidence.finalizedBlock === block &&
              evidence.receivedWei === receivedWei;
            if (changed) row = { ...row, state: "destination_finalized",
              destination_tx_hash: txHash, destination_received_wei: receivedWei };
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
  const request = (action: "load" | "claim_broadcast" | "reconcile",
    overrides: Record<string, unknown> = {},
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
    get sourceFinalizations() { return sourceFinalizations; },
    get destinationFinalizations() { return destinationFinalizations; },
    forceZero() { forcedZero = true; },
    forceDestinationZero() { forcedDestinationZero = true; },
    allowDestination() { forcedDestinationZero = false; },
    forceMissingPlan() { forcedMissingPlan = true; },
    changeRow(value: Partial<typeof row>) { row = { ...row, ...value }; } };
}

function deliveryProof(row: ReturnType<typeof initialRow>) {
  const guid = `0x${"a".repeat(64)}`;
  const transactionHash = `0x${"b".repeat(64)}`;
  const receivedWei = row.minimum_destination_wei;
  return {
    journalId: row.id, guid,
    source: {
      finalized: true as const, sourceSignature: row.source_signature,
      sourceWallet: row.source_wallet, sourceTokenAccount: sourceAta.toBase58(),
      sourceMint: row.source_mint, sourceAmountAtomic: row.source_amount_atomic,
      destinationTreasury: row.destination_treasury, destinationEid: 30_409,
      amountReceivedAtomic: minimum.toString(), quoteId: row.quote_id,
      signedTransactionSha256: row.signed_transaction_sha256,
      finalizedSlot: 1234, bridgeMessageId: guid,
    },
    destination: {
      kind: "direct_chz_oft_delivery" as const, sourceEid: 30_168,
      destinationEid: 30_409, destinationChainId: 88_888,
      sourceStore: DIRECT_CHZ_OFT.solanaStore,
      destinationAdapter: DIRECT_CHZ_OFT.chilizNativeAdapter,
      sourceSignature: row.source_signature, sourceTreasury: row.source_wallet,
      destinationTreasury: row.destination_treasury, guid,
      destinationTransactionHash: transactionHash,
      receiptBlockNumber: "9000", receiptBlockHash: `0x${"c".repeat(64)}`,
      finalizedBlockNumber: "9012", receivedWei,
      finalized: true as const, chainId: 88_888 as const,
      bridgeMessageId: guid, destinationAsset: row.destination_asset,
      transactionHash, finalizedBlock: "9012",
    },
  } as unknown as ReconciledDirectOftEvidence;
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
  assert.deepEqual(body.journal.plan, f.row._testPlan);
  assert.equal(body.journal.planSha256,
    createHash("sha256").update(JSON.stringify(f.row._testPlan)).digest("hex"));
  assert.equal(f.updates, 0);
});

test("wrong worker identity cannot read, claim, or reconcile", async () => {
  const f = fixture();
  for (const action of ["load", "claim_broadcast", "reconcile"] as const) {
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
  f.changeRow({ quote_expires_at_ms: nowMs + 20_000,
    _testPlan: { ...f.row._testPlan, quoteExpiresAtMs: nowMs + 20_000 } });
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

test("missing or altered durable plan blocks both load and atomic claim", async () => {
  const f = fixture();
  f.forceMissingPlan();
  assert.equal((await handleChilizBridgeWorkerRequest(f.request("load"), f.deps)).status, 503);
  assert.equal((await handleChilizBridgeWorkerRequest(
    f.request("claim_broadcast"), f.deps)).status, 503);
  assert.equal(f.updates, 0);
  const changed = fixture();
  changed.changeRow({ _testPlan: { ...changed.row._testPlan,
    sourceAmountAtomic: "200000000" } });
  assert.equal((await handleChilizBridgeWorkerRequest(changed.request("load"),
    changed.deps)).status, 503);
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
  const signedFixture = initialRow();
  const intent: ChilizBridgeJournalInsert = {
    id: "bridge-canary-1", sourceWallet: wallet.publicKey.toBase58(),
    destinationTreasury: destination, sourceAmountAtomic: sourceAmount.toString(),
    minimumDestinationWei: (minimum * 10_000_000_000n).toString(),
    quoteId: signedFixture.quote_id, quoteExpiresAtMs: nowMs + 60_000,
    routeType: "OFT", signedTransactionBase64: signedFixture.signed_transaction_base64,
    signedTransactionSha256: signedFixture.signed_transaction_sha256,
    sourceSignature: signedFixture.source_signature, nowMs,
  };
  let observed: Array<{ sql: string; bindings: unknown[] }> = [];
  const database = {
    prepare(sql: string) {
      return { bind(...bindings: unknown[]) { return { sql, bindings }; }, sql, bindings: [] };
    },
    async batch(statements: Array<{ sql: string; bindings: unknown[] }>) {
      observed = statements;
      return [0, 1, 1, 1, 1, 0].map((changes) => ({ success: true,
        meta: { changes } }));
    },
  } as unknown as D1Database;
  assert.equal(await reservePreparedDirectOftCanary(database, intent,
    signedFixture._testPlan), true);
  assert.equal(observed.length, 6);
  assert.match(observed[0].sql, /INSERT OR IGNORE INTO chiliz_bridge_policy/);
  assert.match(observed[1].sql, /state = 'armed'/);
  assert.match(observed[2].sql, /signed_transaction_base64/);
  assert.match(observed[3].sql, /chiliz_bridge_canary_plans/);
  assert.match(observed[4].sql, /reserved_bridge_id = \?1/);
  assert.match(observed[5].sql, /invalid-canary-assertion/);
  assert.deepEqual(observed[2].bindings.slice(0, 3),
    [intent.id, intent.sourceWallet, intent.destinationTreasury]);
  assert.equal(observed[2].bindings[8], intent.signedTransactionBase64);
  assert.equal(observed[5].bindings[8], intent.signedTransactionSha256);
});

test("reconcile independently verifies the stored plan before finalizing both chains", async () => {
  const f = fixture();
  f.changeRow({ state: "broadcast_attempted", broadcast_attempted_at_ms: nowMs });
  const proof = deliveryProof(f.row);
  let verified = 0;
  const result = await handleChilizBridgeWorkerRequest(f.request("reconcile"), {
    ...f.deps,
    solanaRpcUrl: "https://solana.example/rpc",
    primaryChilizRpcUrl: "https://chiliz-one.example/rpc",
    secondaryChilizRpcUrl: "https://chiliz-two.example/rpc",
    reconcileImpl: async ({ journal, plan }) => {
      verified++;
      assert.equal(journal.sourceSignature, f.row.source_signature);
      assert.deepEqual(plan, f.row._testPlan);
      return proof;
    },
  });
  assert.equal(result.status, 200);
  const body = await result.json() as Record<string, unknown>;
  assert.equal(body.state, "destination_finalized");
  assert.equal(body.destinationTxHash, proof.destination.transactionHash);
  assert.equal(body.receivedWei, proof.destination.receivedWei);
  assert.equal(JSON.stringify(body).includes(f.row.signed_transaction_base64), false);
  assert.equal(f.row.state, "destination_finalized");
  assert.equal(verified, 1);
  assert.equal(f.sourceFinalizations, 1);
  assert.equal(f.destinationFinalizations, 1);
  const again = await handleChilizBridgeWorkerRequest(f.request("reconcile"), {
    ...f.deps,
    reconcileImpl: async () => { throw Error("already finalized"); },
  });
  assert.equal(again.status, 200);
  assert.equal(f.sourceFinalizations, 1);
  assert.equal(f.destinationFinalizations, 1);
});

test("reconcile cannot act before claim or on unavailable delivery proof", async () => {
  const f = fixture();
  let checked = false;
  const deps = { ...f.deps,
    solanaRpcUrl: "https://solana.example/rpc",
    primaryChilizRpcUrl: "https://chiliz-one.example/rpc",
    secondaryChilizRpcUrl: "https://chiliz-two.example/rpc",
    reconcileImpl: async () => { checked = true; throw Error("source pending"); },
  };
  assert.equal((await handleChilizBridgeWorkerRequest(f.request("reconcile"),
    deps)).status, 409);
  assert.equal(checked, false);
  f.changeRow({ state: "broadcast_attempted", broadcast_attempted_at_ms: nowMs });
  const pending = await handleChilizBridgeWorkerRequest(f.request("reconcile"), deps);
  assert.equal(pending.status, 409);
  assert.equal(checked, true);
  assert.equal(f.sourceFinalizations, 0);
  assert.equal(f.destinationFinalizations, 0);
  assert.equal((await pending.text()).includes(f.row.signed_transaction_base64), false);
});

test("destination write failure leaves durable source proof for safe reconciliation retry", async () => {
  const f = fixture();
  f.changeRow({ state: "broadcast_attempted", broadcast_attempted_at_ms: nowMs });
  f.forceDestinationZero();
  const proof = deliveryProof(f.row);
  const deps = { ...f.deps,
    solanaRpcUrl: "https://solana.example/rpc",
    primaryChilizRpcUrl: "https://chiliz-one.example/rpc",
    secondaryChilizRpcUrl: "https://chiliz-two.example/rpc",
    reconcileImpl: async () => proof,
  };
  assert.equal((await handleChilizBridgeWorkerRequest(f.request("reconcile"),
    deps)).status, 409);
  assert.equal(f.row.state, "source_finalized");
  assert.equal(f.sourceFinalizations, 1);
  f.allowDestination();
  assert.equal((await handleChilizBridgeWorkerRequest(f.request("reconcile"),
    deps)).status, 200);
  assert.equal(f.row.state, "destination_finalized");
  assert.equal(f.sourceFinalizations, 1);
  assert.equal(f.destinationFinalizations, 2);
});

test("reconcile rejects a conflicting proof before journal writes", async () => {
  const f = fixture();
  f.changeRow({ state: "broadcast_attempted", broadcast_attempted_at_ms: nowMs });
  const proof = deliveryProof(f.row);
  const result = await handleChilizBridgeWorkerRequest(f.request("reconcile"), {
    ...f.deps,
    solanaRpcUrl: "https://solana.example/rpc",
    primaryChilizRpcUrl: "https://chiliz-one.example/rpc",
    secondaryChilizRpcUrl: "https://chiliz-two.example/rpc",
    reconcileImpl: async () => ({ ...proof, destination: {
      ...proof.destination, destinationTreasury:
        "0x1111111111111111111111111111111111111111" } }),
  });
  assert.equal(result.status, 409);
  assert.equal(f.sourceFinalizations, 0);
  assert.equal(f.destinationFinalizations, 0);
});
