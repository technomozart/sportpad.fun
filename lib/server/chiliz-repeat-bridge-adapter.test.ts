import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { padHex } from "viem";
import { DIRECT_CHZ_OFT } from "./providers/chiliz-direct-oft.ts";
import { buildUnsignedDirectOftFromSnapshot, directOftOptions,
  type DirectOftBuildSnapshot } from "./providers/chiliz-direct-oft-build.ts";
import { claimRepeatBridgeAttempt, prepareRepeatBridgeAttempt } from
  "./chiliz-repeat-bridge-adapter.ts";

const signer = Keypair.fromSeed(new Uint8Array(32).fill(7));
const wallet = signer.publicKey.toBase58();
const destination = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const escrow = "CtubJkSzXezmwrX2W67HZkkCiQKCk9oFWHK5K6tdV4yQ";
const amount = "100000000";
const minimum = "990000000000000000";
const sourceAta = getAssociatedTokenAddressSync(
  new PublicKey(DIRECT_CHZ_OFT.solanaMint), signer.publicKey, false,
  TOKEN_PROGRAM_ID).toBase58();

function snapshot(): DirectOftBuildSnapshot {
  const options = directOftOptions(new Uint8Array());
  const data = oft.instructions.getSendInstructionDataSerializer().serialize({
    dstEid: DIRECT_CHZ_OFT.chilizEid,
    to: Buffer.from(padHex(destination, { size: 32 }).slice(2), "hex"),
    amountLd: BigInt(amount), minAmountLd: 99_000_000n,
    options, composeMsg: null, nativeFee: 345_783n, lzTokenFee: 0n,
  });
  return {
    storeMint: DIRECT_CHZ_OFT.solanaMint, storeEscrow: escrow,
    storePaused: false,
    peer: padHex(DIRECT_CHZ_OFT.chilizNativeAdapter, { size: 32 }),
    sourceTokenAccount: sourceAta, sourceTokenAmountAtomic: amount,
    messagingFeeLamports: 345_783n, lzTokenFee: 0n,
    oftQuote: { oftLimits: { minAmountLd: 1n, maxAmountLd: 1_000_000_000n },
      oftFeeDetails: [], oftReceipt: { amountSentLd: BigInt(amount),
        amountReceivedLd: BigInt(amount) } },
    options,
    sendInstruction: new TransactionInstruction({
      programId: new PublicKey(DIRECT_CHZ_OFT.solanaProgram),
      keys: [
        { pubkey: signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: new PublicKey(sourceAta), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(escrow), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(DIRECT_CHZ_OFT.solanaMint),
          isSigner: false, isWritable: true },
        { pubkey: new PublicKey(DIRECT_CHZ_OFT.solanaStore),
          isSigner: false, isWritable: true },
      ], data: Buffer.from(data),
    }),
    lookupTable: new AddressLookupTableAccount({
      key: new PublicKey(DIRECT_CHZ_OFT.solanaAddressLookupTable),
      state: { deactivationSlot: 0xffff_ffff_ffff_ffffn,
        lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0,
        authority: undefined, addresses: [] },
    }),
    blockhash: { blockhash: escrow, lastValidBlockHeight: 100 },
  };
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE chiliz_fee_reservations (id TEXT PRIMARY KEY,
      fee_event_id TEXT, launch_id TEXT, reward_treasury TEXT);
    CREATE TABLE chiliz_sol_chz_swap_journal (id TEXT PRIMARY KEY,
      reservation_id TEXT, state TEXT, output_amount_atomic TEXT,
      output_mint TEXT, source_wallet TEXT);
    CREATE TABLE chiliz_bridge_journal (id TEXT PRIMARY KEY, quote_id TEXT,
      source_signature TEXT, signed_transaction_sha256 TEXT,
      bridge_message_id TEXT, destination_tx_hash TEXT);
  `);
  for (const name of ["0029_living_calypso", "0033_repeat_bridge_attempts"]) {
    db.exec(readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8")
      .replaceAll("--> statement-breakpoint", ""));
  }
  db.prepare("INSERT INTO launch_drafts VALUES ('launch')").run();
  db.prepare("INSERT INTO fee_events VALUES ('fee','launch')").run();
  db.prepare("INSERT INTO chiliz_fee_reservations VALUES ('reservation','fee','launch',?1)")
    .run(wallet);
  db.prepare(`INSERT INTO chiliz_sol_chz_swap_journal VALUES
    ('swap','reservation','finalized_success',?1,?2,?3)`)
    .run(amount, DIRECT_CHZ_OFT.solanaMint, wallet);
  db.prepare(`INSERT INTO chiliz_bridge_transfers
    (id,source_wallet,destination_treasury,source_mint,destination_chain_id,
     source_amount_atomic,minimum_destination_wei)
    VALUES ('bridge',?1,?2,?3,88888,?4,?5)`)
    .run(wallet, destination.toLowerCase(), DIRECT_CHZ_OFT.solanaMint,
      amount, minimum);
  db.prepare(`INSERT INTO chiliz_bridge_allocations
    (id,bridge_id,swap_intent_id,reservation_id,fee_event_id,launch_id,
     swap_output_offset_atomic,amount_atomic)
    VALUES ('allocation','bridge','swap','reservation','fee','launch','0',?1)`)
    .run(amount);
  const d1 = {
    prepare(sql: string) {
      const make = (bindings: unknown[]) => ({
        bind: (...next: unknown[]) => make(next),
        first: async () => db.prepare(sql).get(...bindings as []),
        run: async () => {
          const result = db.prepare(sql).run(...bindings as []);
          return { success: true, meta: { changes: result.changes } };
        },
      });
      return make([]);
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { db, d1 };
}

test("fee-backed bridge attempt only claims exact signed OFT bytes once", async () => {
  const { db, d1 } = database();
  const nowMs = Date.now();
  const plan = await buildUnsignedDirectOftFromSnapshot({
    amountAtomic: amount, minimumReceiveAtomic: "99000000",
    payerSolanaWallet: wallet, destinationChilizWallet: destination,
    solanaRpcUrl: "https://api.mainnet-beta.solana.com/", nowMs,
  }, snapshot());
  const tx = VersionedTransaction.deserialize(Buffer.from(
    plan.unsignedTransactionBase64, "base64"));
  tx.sign([signer]);
  const signedTransactionBase64 = Buffer.from(tx.serialize()).toString("base64");
  const prepared = await prepareRepeatBridgeAttempt({ db: d1,
    bridgeId: "bridge", attemptSequence: 0, plan,
    signedTransactionBase64, expectedSourceWallet: wallet,
    expectedDestinationTreasury: destination.toLowerCase(), nowMs });
  assert.equal(prepared.bridgeId, "bridge");
  assert.equal((db.prepare("SELECT state FROM chiliz_bridge_transfers WHERE id='bridge'")
    .get() as { state: string }).state, "collecting");
  const rpc = { getGenesisHash: async () =>
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    getBlockHeight: async () => 50,
    getSignatureStatuses: async () => ({ value: [null] }) };
  await assert.rejects(claimRepeatBridgeAttempt({ db: d1,
    bridgeId: "bridge", attemptSequence: 0, expectedSourceWallet: wallet,
    expectedDestinationTreasury: destination.toLowerCase(), nowMs,
    rpc: { ...rpc, getSignatureStatuses: async () => ({ value: [{ err: null }] }) },
  }), /repeat_bridge_claim_chain_preflight_invalid/);
  assert.equal((db.prepare("SELECT state FROM chiliz_bridge_transfers WHERE id='bridge'")
    .get() as { state: string }).state, "collecting");
  const claimed = await claimRepeatBridgeAttempt({ db: d1,
    bridgeId: "bridge", attemptSequence: 0, expectedSourceWallet: wallet,
    expectedDestinationTreasury: destination.toLowerCase(), nowMs, rpc });
  assert.equal(claimed.signedTransactionBase64, signedTransactionBase64);
  assert.equal(claimed.sourceSignature, prepared.sourceSignature);
  assert.equal((db.prepare("SELECT state FROM chiliz_bridge_transfers WHERE id='bridge'")
    .get() as { state: string }).state, "broadcast_unknown");
  assert.equal((db.prepare("SELECT state FROM chiliz_bridge_attempts WHERE bridge_id='bridge'")
    .get() as { state: string }).state, "claimed");
  await assert.rejects(claimRepeatBridgeAttempt({ db: d1,
    bridgeId: "bridge", attemptSequence: 0, expectedSourceWallet: wallet,
    expectedDestinationTreasury: destination.toLowerCase(), nowMs, rpc }),
  /repeat_bridge_claim_state_invalid/);
});
