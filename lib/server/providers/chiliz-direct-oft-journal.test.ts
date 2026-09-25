import test from "node:test";
import assert from "node:assert/strict";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction, VersionedTransaction,
} from "@solana/web3.js";
import { padHex } from "viem";
import { DIRECT_CHZ_OFT } from "./chiliz-direct-oft.ts";
import {
  buildUnsignedDirectOftFromSnapshot, directOftOptions, type DirectOftBuildSnapshot,
} from "./chiliz-direct-oft-build.ts";
import { prepareDirectOftChilizBridgeJournalInsert } from "./chiliz-direct-oft-journal.ts";

// Test-only deterministic keypair. No production key is loaded by this module.
const signer = Keypair.fromSeed(new Uint8Array(32).fill(7));
const sourceWallet = signer.publicKey.toBase58();
const destinationTreasury = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const escrow = "CtubJkSzXezmwrX2W67HZkkCiQKCk9oFWHK5K6tdV4yQ";
const sourceAta = getAssociatedTokenAddressSync(
  new PublicKey(DIRECT_CHZ_OFT.solanaMint), signer.publicKey, false, TOKEN_PROGRAM_ID,
).toBase58();
const options = directOftOptions(new Uint8Array());
const amount = 100000000n;
const minimum = 99000000n;
const fee = 345783n;
const nowMs = 1_800_000_000_000;

function snapshot(): DirectOftBuildSnapshot {
  const sendData = oft.instructions.getSendInstructionDataSerializer().serialize({
    dstEid: DIRECT_CHZ_OFT.chilizEid,
    to: Buffer.from(padHex(destinationTreasury, { size: 32 }).slice(2), "hex"),
    amountLd: amount,
    minAmountLd: minimum,
    options,
    composeMsg: null,
    nativeFee: fee,
    lzTokenFee: 0n,
  });
  return {
    storeMint: DIRECT_CHZ_OFT.solanaMint,
    storeEscrow: escrow,
    storePaused: false,
    peer: padHex(DIRECT_CHZ_OFT.chilizNativeAdapter, { size: 32 }),
    sourceTokenAccount: sourceAta,
    sourceTokenAmountAtomic: amount.toString(),
    messagingFeeLamports: fee,
    lzTokenFee: 0n,
    oftQuote: {
      oftLimits: { minAmountLd: 1n, maxAmountLd: 1000000000n },
      oftFeeDetails: [],
      oftReceipt: { amountSentLd: amount, amountReceivedLd: amount },
    },
    options,
    sendInstruction: new TransactionInstruction({
      programId: new PublicKey(DIRECT_CHZ_OFT.solanaProgram),
      keys: [
        { pubkey: signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: new PublicKey(sourceAta), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(escrow), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(DIRECT_CHZ_OFT.solanaMint), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(DIRECT_CHZ_OFT.solanaStore), isSigner: false, isWritable: true },
      ],
      data: Buffer.from(sendData),
    }),
    lookupTable: new AddressLookupTableAccount({
      key: new PublicKey(DIRECT_CHZ_OFT.solanaAddressLookupTable),
      state: {
        deactivationSlot: 0xffff_ffff_ffff_ffffn,
        lastExtendedSlot: 1,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [],
      },
    }),
    blockhash: { blockhash: escrow, lastValidBlockHeight: 100 },
  };
}

async function fixture() {
  const plan = await buildUnsignedDirectOftFromSnapshot({
    amountAtomic: amount.toString(),
    payerSolanaWallet: sourceWallet,
    destinationChilizWallet: destinationTreasury,
    solanaRpcUrl: "https://api.mainnet-beta.solana.com/",
    nowMs,
  }, snapshot());
  const tx = VersionedTransaction.deserialize(Buffer.from(plan.unsignedTransactionBase64, "base64"));
  tx.sign([signer]);
  return { plan, signedTransactionBase64: Buffer.from(tx.serialize()).toString("base64") };
}

test("journal integration accepts only exact signed bytes from verified plan", async () => {
  const { plan, signedTransactionBase64 } = await fixture();
  const insert = await prepareDirectOftChilizBridgeJournalInsert({
    id: "test-direct-oft-1", plan, signedTransactionBase64,
    expectedSourceWallet: sourceWallet, expectedDestinationTreasury: destinationTreasury,
    nowMs,
  });
  assert.equal(insert.sourceWallet, sourceWallet);
  assert.equal(insert.destinationTreasury, destinationTreasury.toLowerCase());
  assert.equal(insert.sourceAmountAtomic, amount.toString());
  assert.equal(insert.minimumDestinationWei, "990000000000000000");
  assert.equal(insert.quoteId, `oft:${plan.onchainQuoteDigestSha256}`);
  assert.equal(insert.routeType, "OFT");
});

test("journal integration binds separately configured source and destination", async () => {
  const { plan, signedTransactionBase64 } = await fixture();
  const base = { id: "test-direct-oft-2", plan, signedTransactionBase64, nowMs };
  await assert.rejects(prepareDirectOftChilizBridgeJournalInsert({
    ...base, expectedSourceWallet: escrow, expectedDestinationTreasury: destinationTreasury,
  }));
  await assert.rejects(prepareDirectOftChilizBridgeJournalInsert({
    ...base, expectedSourceWallet: sourceWallet,
    expectedDestinationTreasury: "0x0000000000000000000000000000000000000001",
  }));
});

test("journal integration rejects mutated plan quote and minimum fields", async () => {
  const { plan, signedTransactionBase64 } = await fixture();
  const base = {
    id: "test-direct-oft-3", signedTransactionBase64,
    expectedSourceWallet: sourceWallet, expectedDestinationTreasury: destinationTreasury, nowMs,
  };
  await assert.rejects(prepareDirectOftChilizBridgeJournalInsert({
    ...base, plan: { ...plan, destinationTreasury: "0x0000000000000000000000000000000000000001" },
  }));
  await assert.rejects(prepareDirectOftChilizBridgeJournalInsert({
    ...base, plan: { ...plan, minimumReceiveAtomic: "95000000" },
  }));
  await assert.rejects(prepareDirectOftChilizBridgeJournalInsert({
    ...base, plan: { ...plan, onchainQuoteDigestSha256: "0".repeat(64) },
  }));
});

test("journal integration rejects bad signature and changed message", async () => {
  const { plan, signedTransactionBase64 } = await fixture();
  const base = {
    id: "test-direct-oft-4", plan,
    expectedSourceWallet: sourceWallet, expectedDestinationTreasury: destinationTreasury, nowMs,
  };
  const brokenSignature = VersionedTransaction.deserialize(Buffer.from(signedTransactionBase64, "base64"));
  brokenSignature.signatures[0][0] ^= 1;
  await assert.rejects(prepareDirectOftChilizBridgeJournalInsert({
    ...base, signedTransactionBase64: Buffer.from(brokenSignature.serialize()).toString("base64"),
  }));
  const changedMessage = VersionedTransaction.deserialize(Buffer.from(signedTransactionBase64, "base64"));
  changedMessage.message.recentBlockhash = sourceWallet;
  changedMessage.sign([signer]);
  await assert.rejects(prepareDirectOftChilizBridgeJournalInsert({
    ...base, signedTransactionBase64: Buffer.from(changedMessage.serialize()).toString("base64"),
  }));
});
