import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { ComputeBudgetProgram, PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";

import { PUMP_AMM_PROGRAM_ID, PUMP_AMM_TRANSFER_CREATOR_FEES_V2_DISCRIMINATOR } from "../../protocol/pump-devnet-instructions.ts";
import {
  NATIVE_MINT,
  PUMP_BONDING_CURVE_DISCRIMINATOR,
  PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_SHARING_CONFIG_DISCRIMINATOR,
  feeSharingConfigPda,
} from "../../protocol/pump-devnet-verification.ts";
import { preflightPumpV2FeeCollection } from "./fee-collector-preflight.ts";

function key(byte: number) {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte));
}

const collector = key(1);
const mint = key(2);
const reward = key(3);
const buyback = key(4);
const address = (value: PublicKey) => value.toBase58();

function fixture(complete = false) {
  const curve = Buffer.alloc(125);
  curve.set(PUMP_BONDING_CURVE_DISCRIMINATOR);
  curve[48] = Number(complete);
  curve.set(feeSharingConfigPda(mint).toBytes(), 49);
  curve.set(NATIVE_MINT.toBytes(), 83);
  const sharing = Buffer.alloc(148);
  sharing.set(PUMP_SHARING_CONFIG_DISCRIMINATOR);
  sharing[9] = 2;
  sharing[10] = 1;
  sharing.set(mint.toBytes(), 11);
  sharing[75] = 1;
  sharing.writeUInt32LE(2, 76);
  sharing.set(reward.toBytes(), 80);
  sharing.writeUInt16LE(8000, 112);
  sharing.set(buyback.toBytes(), 114);
  sharing.writeUInt16LE(2000, 146);
  const curveAccount = { data: curve, executable: false, lamports: 1, owner: PUMP_PROGRAM_ID, rentEpoch: 0 };
  const sharingAccount = { data: sharing, executable: false, lamports: 1, owner: PUMP_FEE_PROGRAM_ID, rentEpoch: 0 };
  let simulated: VersionedTransaction | undefined;
  let simulationConfig: unknown;
  let simulationError: unknown = null;
  const connection = {
    async getMultipleAccountsInfoAndContext(_keys: PublicKey[], commitment: string) {
      assert.equal(commitment, "finalized");
      return { context: { slot: 100 }, value: [curveAccount, sharingAccount] };
    },
    async getLatestBlockhashAndContext(config: { minContextSlot: number; commitment: string }) {
      assert.deepEqual(config, { minContextSlot: 100, commitment: "finalized" });
      return { context: { slot: 101 }, value: { blockhash: address(key(9)), lastValidBlockHeight: 200 } };
    },
    async simulateTransaction(transaction: VersionedTransaction, config: unknown) {
      simulated = transaction;
      simulationConfig = config;
      return { context: { slot: 102 }, value: { err: simulationError, logs: [], unitsConsumed: 121_000 } };
    },
  } as unknown as Connection;
  const input = {
    connection,
    collectorAddress: address(collector),
    mintAddress: address(mint),
    rewardTreasuryAddress: address(reward),
    buybackTreasuryAddress: address(buyback),
  };
  return {
    input, curve, sharing, curveAccount, sharingAccount,
    get simulated() { return simulated; },
    get simulationConfig() { return simulationConfig; },
    failSimulation() { simulationError = { InstructionError: [1, "Custom"] }; },
  };
}

test("inspects a finalized immutable 80/20 Pump route with an unsigned canonical distribution", async () => {
  const setup = fixture();
  const report = await preflightPumpV2FeeCollection(setup.input);
  assert.equal(report.status, "inspection_only");
  assert.equal(report.executionReady, false);
  assert.equal(report.sweptAmmInSimulation, false);
  assert.equal(report.simulationUnitsConsumed, 121_000);
  assert.deepEqual(setup.simulationConfig, {
    commitment: "finalized", minContextSlot: 100, sigVerify: false, replaceRecentBlockhash: false,
  });
  const unsigned = setup.simulated;
  assert.ok(unsigned);
  assert.equal(unsigned.signatures.length, 1);
  assert.ok(unsigned.signatures[0].every((byte) => byte === 0));
  const message = unsigned.message;
  const programs = message.compiledInstructions.map((instruction) =>
    address(message.staticAccountKeys[instruction.programIdIndex]));
  assert.deepEqual(programs, [address(ComputeBudgetProgram.programId), address(PUMP_PROGRAM_ID)]);
  assert.deepEqual([...message.compiledInstructions[1].data], [...PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR, 0]);
  const distribute = message.compiledInstructions[1];
  assert.deepEqual(distribute.accountKeyIndexes.slice(-2).map((index) =>
    address(message.staticAccountKeys[index])), [address(reward), address(buyback)]);
  assert.equal("transaction" in report, false);
  assert.equal("signature" in report, false);
});

test("adds the Pump AMM sweep before distribution when the curve is complete", async () => {
  const setup = fixture(true);
  const report = await preflightPumpV2FeeCollection(setup.input);
  assert.equal(report.sweptAmmInSimulation, true);
  const unsigned = setup.simulated;
  assert.ok(unsigned);
  const message = unsigned.message;
  assert.deepEqual(message.compiledInstructions.map((instruction) =>
    address(message.staticAccountKeys[instruction.programIdIndex])), [
    address(ComputeBudgetProgram.programId), address(PUMP_AMM_PROGRAM_ID), address(PUMP_PROGRAM_ID),
  ]);
  assert.deepEqual([...message.compiledInstructions[1].data],
    [...PUMP_AMM_TRANSFER_CREATOR_FEES_V2_DISCRIMINATOR]);
});

test("rejects recipient and collector overlap before reading chain state", async () => {
  const setup = fixture();
  await assert.rejects(() => preflightPumpV2FeeCollection({
    ...setup.input, collectorAddress: setup.input.rewardTreasuryAddress,
  }), /wallets_not_distinct/);
  await assert.rejects(() => preflightPumpV2FeeCollection({
    ...setup.input, buybackTreasuryAddress: setup.input.rewardTreasuryAddress,
  }), /wallets_not_distinct/);
});

test("rejects forged ownership, mutable or changed sharing, and mismatched curve", async () => {
  const wrongOwner = fixture();
  wrongOwner.sharingAccount.owner = PUMP_PROGRAM_ID;
  await assert.rejects(() => preflightPumpV2FeeCollection(wrongOwner.input), /account_owner_invalid/);

  const mutable = fixture();
  mutable.sharing[75] = 0;
  await assert.rejects(() => preflightPumpV2FeeCollection(mutable.input), /config_not_immutable_v2/);

  const wrongRecipient = fixture();
  wrongRecipient.sharing.set(key(8).toBytes(), 80);
  await assert.rejects(() => preflightPumpV2FeeCollection(wrongRecipient.input), /share_route_mismatch/);

  const wrongCurve = fixture();
  wrongCurve.curve.set(key(8).toBytes(), 49);
  await assert.rejects(() => preflightPumpV2FeeCollection(wrongCurve.input), /curve_config_mismatch/);
});

test("requires a successful simulation and never returns an executable transaction", async () => {
  const setup = fixture();
  setup.failSimulation();
  await assert.rejects(() => preflightPumpV2FeeCollection(setup.input), /simulation_failed/);
  assert.ok(setup.simulated);
  assert.ok(setup.simulated.signatures[0].every((byte) => byte === 0));
});
