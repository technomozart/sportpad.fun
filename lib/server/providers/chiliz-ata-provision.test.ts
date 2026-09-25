import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair, PublicKey, SystemProgram, TransactionMessage,
  VersionedTransaction, type AccountInfo,
} from "@solana/web3.js";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import {
  prepareUnsignedOfficialChzAtaProvision, type ChzAtaProvisionReadConnection,
} from "./chiliz-ata-provision.ts";

const treasury = Keypair.fromSeed(new Uint8Array(32).fill(33)).publicKey;
const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const ata = getAssociatedTokenAddressSync(mint, treasury, false, TOKEN_PROGRAM_ID);
const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(34)).publicKey.toBase58();

function account(owner: PublicKey, data = Buffer.alloc(0), lamports = 1_000_000): AccountInfo<Buffer> {
  return { owner, data, lamports, executable: false, rentEpoch: 0 };
}

function mintData(): Buffer {
  const data = Buffer.alloc(82);
  data[44] = 8;
  data[45] = 1;
  return data;
}

function rpc(overrides: {
  ataExists?: boolean;
  rentLamports?: number;
  feeLamports?: number;
  treasuryLamports?: number;
  lastValidBlockHeight?: number;
  currentHeight?: number;
  blockhashSlot?: number;
  feeReads?: Array<{ slot: number; value: number | null }>;
} = {}): ChzAtaProvisionReadConnection {
  let feeReadIndex = 0;
  return {
    async getMultipleAccountsInfoAndContext(addresses: PublicKey[]) {
      assert.deepEqual(addresses.map((address) => address.toBase58()),
        [treasury, mint, ata].map((address) => address.toBase58()));
      return { context: { slot: 100 }, value: [
        account(SystemProgram.programId, Buffer.alloc(0), overrides.treasuryLamports ?? 50_000_000),
        account(TOKEN_PROGRAM_ID, mintData()),
        overrides.ataExists ? account(TOKEN_PROGRAM_ID, Buffer.alloc(165)) : null,
      ] };
    },
    async getMinimumBalanceForRentExemption() { return overrides.rentLamports ?? 2_039_280; },
    async getLatestBlockhashAndContext(config: { commitment: string; minContextSlot: number }) {
      assert.deepEqual(config, { commitment: "finalized", minContextSlot: 100 });
      return { context: { slot: overrides.blockhashSlot ?? 101 }, value: {
        blockhash, lastValidBlockHeight: overrides.lastValidBlockHeight ?? 200,
      } };
    },
    async getFeeForMessage() {
      const read = overrides.feeReads?.[Math.min(feeReadIndex++, overrides.feeReads.length - 1)];
      if (read) return { context: { slot: read.slot }, value: read.value };
      return { context: { slot: 102 }, value: overrides.feeLamports ?? 5_000 };
    },
    async getBlockHeight() { return overrides.currentHeight ?? 150; },
  } as unknown as ChzAtaProvisionReadConnection;
}

test("builds only an unsigned canonical CHZ ATA setup for configured treasury", async () => {
  const plan = await prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: treasury.toBase58(), connection: rpc(),
  });
  assert.equal(plan.outputAta, ata.toBase58());
  assert.equal(plan.officialChzMint, mint.toBase58());
  assert.equal(plan.tokenProgram, TOKEN_PROGRAM_ID.toBase58());
  assert.equal(plan.maximumSetupSpendLamports, "2089280");
  assert.equal(plan.estimatedNetworkFeeLamports, "5000");
  assert.equal(plan.executionReady, false);
  const tx = VersionedTransaction.deserialize(Buffer.from(plan.unsignedTransactionBase64, "base64"));
  assert.equal(tx.version, 0);
  assert.equal(tx.signatures.length, 1);
  assert(tx.signatures[0].every((byte) => byte === 0));
  assert.equal(tx.message.staticAccountKeys[0].toBase58(), treasury.toBase58());
  const instructions = TransactionMessage.decompile(tx.message).instructions;
  assert.equal(instructions.length, 1);
  assert.equal(instructions[0].programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  assert.deepEqual([...instructions[0].data], [1]);
  assert.deepEqual(instructions[0].keys.map((key) => key.pubkey.toBase58()), [
    treasury.toBase58(), ata.toBase58(), treasury.toBase58(), mint.toBase58(),
    SystemProgram.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58(),
  ]);
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256",
    new Uint8Array(tx.message.serialize()))).toString("hex");
  assert.equal(plan.transactionMessageHash, digest);
});

test("does not plan a duplicate or occupied ATA", async () => {
  await assert.rejects(prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: treasury.toBase58(), connection: rpc({ ataExists: true }),
  }), /already_exists_or_occupied/);
});

test("caps rent and fee and protects a remaining SOL reserve", async () => {
  await assert.rejects(prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: treasury.toBase58(), connection: rpc({ rentLamports: 2_500_001 }),
  }), /rent_out_of_bounds/);
  await assert.rejects(prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: treasury.toBase58(), connection: rpc({ feeLamports: 50_001 }),
  }), /network_fee_out_of_bounds/);
  await assert.rejects(prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: treasury.toBase58(), connection: rpc({ treasuryLamports: 7_000_000 }),
  }), /insufficient_non_fee_setup_sol/);
});

test("rejects an expired blockhash", async () => {
  await assert.rejects(prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: treasury.toBase58(),
    connection: rpc({ currentHeight: 200, lastValidBlockHeight: 200 }),
  }), /blockhash_expired/);
});

test("rejects an RPC backend that ignores the account snapshot minimum slot", async () => {
  await assert.rejects(prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: treasury.toBase58(),
    connection: rpc({ blockhashSlot: 99 }),
  }), /blockhash_context_invalid/);
});

test("retries a read-only fee estimate after a lagging RPC backend returns null", async () => {
  const plan = await prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: treasury.toBase58(),
    connection: rpc({ feeReads: [
      { slot: 100, value: null },
      { slot: 101, value: 5_000 },
    ] }),
  });
  assert.equal(plan.estimatedNetworkFeeLamports, "5000");
});

test("fails closed when the fee RPC stays behind the blockhash slot", async () => {
  await assert.rejects(prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: treasury.toBase58(),
    connection: rpc({ feeReads: [{ slot: 100, value: null }] }),
  }), /network_fee_out_of_bounds/);
});
