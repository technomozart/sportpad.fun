import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import {
  getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram,
  Keypair, PublicKey, SystemProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction, type AccountInfo,
} from "@solana/web3.js";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import type { JupiterSwapPlan } from "./jupiter-swap.ts";
import { inspectUnsignedSolToChzSwap, type SolChzReadConnection } from "./jupiter-sol-chz-plan.ts";

const signer = Keypair.fromSeed(new Uint8Array(32).fill(9)); // test-only key.
const source = signer.publicKey;
const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const outputAta = getAssociatedTokenAddressSync(mint, source, false, TOKEN_PROGRAM_ID);
const wrappedSolAta = getAssociatedTokenAddressSync(NATIVE_MINT, source, false, TOKEN_PROGRAM_ID);
const altAddress = Keypair.fromSeed(new Uint8Array(32).fill(10)).publicKey;
const metis = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const inputLamports = 10_000_000n;
const chzOutput = 5_000_000n;

function account(owner: PublicKey, data = Buffer.alloc(0), lamports = 1_000_000): AccountInfo<Buffer> {
  return { owner, data, lamports, executable: false, rentEpoch: 0 };
}

function mintData(): Buffer {
  const data = Buffer.alloc(82);
  data[44] = 8; // decimals
  data[45] = 1; // initialized
  return data;
}

function tokenData(tokenMint: PublicKey, owner: PublicKey, amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  data.set(tokenMint.toBytes(), 0);
  data.set(owner.toBytes(), 32);
  writeU64(data, amount, 64);
  data[108] = 1; // initialized
  return data;
}

function writeU64(data: Uint8Array, value: bigint, offset: number): void {
  for (let index = 0; index < 8; index++) {
    data[offset + index] = Number((value >> BigInt(index * 8)) & 255n);
  }
}

function lookupData(addresses: PublicKey[]): Buffer {
  const data = Buffer.alloc(56 + addresses.length * 32);
  data[0] = 1; // lookup table account type
  writeU64(data, 0xffff_ffff_ffff_ffffn, 4); // active
  writeU64(data, 1n, 12); // last extended slot
  for (let index = 0; index < addresses.length; index++) {
    data.set(addresses[index].toBytes(), 56 + index * 32);
  }
  return data;
}

async function fixture(extraMetisKeys: Array<{pubkey: PublicKey; isSigner: boolean; isWritable: boolean}> = []) {
  const table = new AddressLookupTableAccount({
    key: altAddress,
    state: {
      deactivationSlot: 0xffff_ffff_ffff_ffffn,
      lastExtendedSlot: 1,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: [outputAta, wrappedSolAta, ...extraMetisKeys.map((key) => key.pubkey)],
    },
  });
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    SystemProgram.transfer({ fromPubkey: source, toPubkey: wrappedSolAta, lamports: Number(inputLamports) }),
    new TransactionInstruction({
      programId: metis,
      keys: [
        { pubkey: source, isSigner: true, isWritable: true },
        { pubkey: outputAta, isSigner: false, isWritable: true },
        { pubkey: wrappedSolAta, isSigner: false, isWritable: true },
        ...extraMetisKeys,
      ],
      data: Buffer.from([1, 2, 3]),
    }),
  ];
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: source,
    recentBlockhash: altAddress.toBase58(),
    instructions,
  }).compileToV0Message([table]));
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256",
    new Uint8Array(tx.message.serialize()))).toString("hex");
  const plan: JupiterSwapPlan = {
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    transactionMessageHash: digest,
    requestId: "test-jupiter-order",
    lastValidBlockHeight: 200,
    inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    inputAmountAtomic: inputLamports.toString(),
    outputAmountAtomic: "6000000",
    minimumOutputAtomic: "4000000",
    priceImpactPercent: 0.1,
    router: "metis",
  };
  return { plan, tx };
}

function rpc(overrides: {
  outputMissing?: boolean;
  simulatedChzCredit?: bigint;
  extraAccounts?: Map<string, AccountInfo<Buffer>>;
  inactiveAlt?: boolean;
} = {}): SolChzReadConnection {
  const extras = overrides.extraAccounts ?? new Map();
  const lookup = lookupData([outputAta, wrappedSolAta, ...[...extras.keys()].map((key) => new PublicKey(key))]);
  if (overrides.inactiveAlt) writeU64(lookup, 1n, 4);
  const accounts = new Map<string, AccountInfo<Buffer> | null>([
    [source.toBase58(), account(SystemProgram.programId, Buffer.alloc(0), 100_000_000)],
    [mint.toBase58(), account(TOKEN_PROGRAM_ID, mintData())],
    [outputAta.toBase58(), overrides.outputMissing ? null : account(TOKEN_PROGRAM_ID, tokenData(mint, source, 0n))],
    [wrappedSolAta.toBase58(), null],
    [altAddress.toBase58(), account(AddressLookupTableProgram.programId, lookup)],
    ...[...extras.entries()],
  ]);
  let reads = 0;
  return {
    async getMultipleAccountsInfoAndContext(addresses: PublicKey[]) {
      reads++;
      return { context: { slot: reads === 1 ? 10 : 11 },
        value: addresses.map((address) => accounts.get(address.toBase58()) ?? null) };
    },
    async getBlockHeight() { return 100; },
    async simulateTransaction() {
      const output = tokenData(mint, source, overrides.simulatedChzCredit ?? chzOutput);
      return {
        context: { slot: 12 },
        value: {
          err: null,
          accounts: [
            { owner: SystemProgram.programId.toBase58(), executable: false, lamports: 89_900_000,
              data: ["", "base64"] },
            { owner: TOKEN_PROGRAM_ID.toBase58(), executable: false, lamports: 1_000_000,
              data: [Buffer.from(output).toString("base64"), "base64"] },
            null,
          ],
          unitsConsumed: 300_000,
        },
      };
    },
  } as unknown as SolChzReadConnection;
}

test("unsigned SOL to official CHZ plan resolves ALT and verifies simulated deltas", async () => {
  const { plan } = await fixture();
  const result = await inspectUnsignedSolToChzSwap({ plan, sourceWallet: source.toBase58(), connection: rpc() });
  assert.equal(result.sourceWallet, source.toBase58());
  assert.equal(result.outputAta, outputAta.toBase58());
  assert.equal(result.outputTokenProgram, TOKEN_PROGRAM_ID.toBase58());
  assert.deepEqual(result.lookupTableAddresses, [altAddress.toBase58()]);
  assert.equal(result.simulatedSolDebitLamports, "10100000");
  assert.equal(result.simulatedOverheadLamports, "100000");
  assert.equal(result.simulatedChzCreditAtomic, chzOutput.toString());
  assert.equal(result.transactionMessageHash, plan.transactionMessageHash);
  assert.equal(result.executionReady, false);
});

test("fee-backed swap rejects a missing output CHZ ATA", async () => {
  const { plan } = await fixture();
  await assert.rejects(inspectUnsignedSolToChzSwap({
    plan, sourceWallet: source.toBase58(), connection: rpc({ outputMissing: true }),
  }));
});

test("swap rejects inadequate simulated CHZ credit or inactive ALT", async () => {
  const { plan } = await fixture();
  await assert.rejects(inspectUnsignedSolToChzSwap({
    plan, sourceWallet: source.toBase58(), connection: rpc({ simulatedChzCredit: 1n }),
  }));
  await assert.rejects(inspectUnsignedSolToChzSwap({
    plan, sourceWallet: source.toBase58(), connection: rpc({ inactiveAlt: true }),
  }));
});

test("swap rejects an unexpected writable treasury token account", async () => {
  const otherMint = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey;
  const otherAta = getAssociatedTokenAddressSync(otherMint, source, false, TOKEN_PROGRAM_ID);
  const { plan } = await fixture([{ pubkey: otherAta, isSigner: false, isWritable: true }]);
  const extraAccounts = new Map([[otherAta.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(otherMint, source, 123n))]]);
  await assert.rejects(inspectUnsignedSolToChzSwap({
    plan, sourceWallet: source.toBase58(), connection: rpc({ extraAccounts }),
  }));
});

test("swap also rejects a writable treasury Token-2022 account", async () => {
  const otherMint = Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey;
  const otherAta = getAssociatedTokenAddressSync(otherMint, source, false, TOKEN_2022_PROGRAM_ID);
  const { plan } = await fixture([{ pubkey: otherAta, isSigner: false, isWritable: true }]);
  const extraAccounts = new Map([[otherAta.toBase58(),
    account(TOKEN_2022_PROGRAM_ID, tokenData(otherMint, source, 123n))]]);
  await assert.rejects(inspectUnsignedSolToChzSwap({
    plan, sourceWallet: source.toBase58(), connection: rpc({ extraAccounts }),
  }));
});
