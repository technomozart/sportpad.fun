import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  type SignatureStatus,
} from "@solana/web3.js";
import {
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  observedSolanaRewardPurchaseOutput,
  verifySolanaClaimPayoutReceipt,
  verifySolanaRewardPurchaseReceipt,
  verifySportpadBuybackReceipts,
  type SolanaAutomationReceipt,
} from "./automation-receipt.ts";

const treasury = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const source = getAssociatedTokenAddressSync(mint, treasury);
const destination = getAssociatedTokenAddressSync(mint, recipient);
const outputAta = source;
const wrappedSolAta = getAssociatedTokenAddressSync(NATIVE_MINT, treasury);
const metis = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const decimals = 6;

function signature(byte: number) {
  return bs58.encode(Uint8Array.from({ length: 64 }, () => byte));
}

function tokenRow(keys: PublicKey[], account: PublicKey, owner: PublicKey, amount: string) {
  return {
    accountIndex: keys.findIndex((key) => key.equals(account)),
    mint: mint.toBase58(), owner: owner.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(),
    uiTokenAmount: { amount, decimals },
  };
}

function fixture({
  signer = treasury,
  ix,
  sig,
  slot,
  preTokenBalances,
  postTokenBalances,
  preBalances = [1_000_000_000],
  postBalances = [999_995_000],
  versioned = false,
}: {
  signer?: PublicKey;
  ix: TransactionInstruction[];
  sig: string;
  slot: number;
  preTokenBalances: (keys: PublicKey[]) => unknown[];
  postTokenBalances: (keys: PublicKey[]) => unknown[];
  preBalances?: number[];
  postBalances?: number[];
  versioned?: boolean;
}) {
  const compiler = new TransactionMessage({ payerKey: signer, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: ix });
  const message = versioned ? compiler.compileToV0Message() : compiler.compileToLegacyMessage();
  const keys = (message as unknown as { staticAccountKeys?: PublicKey[]; accountKeys?: PublicKey[] }).staticAccountKeys ??
    (message as unknown as { accountKeys: PublicKey[] }).accountKeys;
  const receipt = {
    slot,
    transaction: { signatures: [sig], message },
    meta: {
      err: null,
      preBalances: [...preBalances, ...Array(keys.length - preBalances.length).fill(0)],
      postBalances: [...postBalances, ...Array(keys.length - postBalances.length).fill(0)],
      preTokenBalances: preTokenBalances(keys),
      postTokenBalances: postTokenBalances(keys),
      loadedAddresses: { writable: [], readonly: [] },
    },
  } as unknown as SolanaAutomationReceipt;
  const status = { slot, err: null, confirmations: null, confirmationStatus: "finalized" } as SignatureStatus;
  return { receipt, status, signature: sig };
}

function claim(versioned = false) {
  const sig = signature(1);
  const evidence = fixture({
    sig, slot: 100, versioned,
    ix: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 90_000 }),
      createTransferCheckedInstruction(source, mint, destination, treasury, 100n, decimals),
    ],
    preTokenBalances: (keys) => [tokenRow(keys, source, treasury, "1000"), tokenRow(keys, destination, recipient, "20")],
    postTokenBalances: (keys) => [tokenRow(keys, source, treasury, "900"), tokenRow(keys, destination, recipient, "120")],
  });
  return {
    ...evidence,
    mint: mint.toBase58(), tokenProgram: TOKEN_PROGRAM_ID.toBase58(), decimals,
    treasury: treasury.toBase58(), recipient: recipient.toBase58(), amountAtomic: "100",
  };
}

function buyback() {
  const swap = fixture({
    sig: signature(2), slot: 200,
    ix: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      SystemProgram.transfer({ fromPubkey: treasury, toPubkey: wrappedSolAta, lamports: 50_000_000 }),
      new TransactionInstruction({ programId: metis, keys: [
        { pubkey: treasury, isSigner: true, isWritable: true },
        { pubkey: outputAta, isSigner: false, isWritable: true },
        { pubkey: wrappedSolAta, isSigner: false, isWritable: true },
      ], data: Buffer.from([1, 2, 3]) }),
    ],
    preBalances: [1_000_000_000], postBalances: [949_990_000],
    preTokenBalances: (keys) => [tokenRow(keys, outputAta, treasury, "100")],
    postTokenBalances: (keys) => [tokenRow(keys, outputAta, treasury, "995100")],
  });
  const burn = fixture({
    sig: signature(3), slot: 201,
    ix: [createBurnCheckedInstruction(outputAta, mint, treasury, 995_000n, decimals)],
    preTokenBalances: (keys) => [tokenRow(keys, outputAta, treasury, "995100")],
    postTokenBalances: (keys) => [tokenRow(keys, outputAta, treasury, "100")],
  });
  return {
    mint: mint.toBase58(), tokenProgram: TOKEN_PROGRAM_ID.toBase58(), decimals,
    treasury: treasury.toBase58(), inputAmountLamports: "50000000", purchasedAmountAtomic: "995000",
    swap, burn,
  };
}

test("verifies a finalized exact SPL claim payout", () => {
  const result = verifySolanaClaimPayoutReceipt(claim());
  assert.equal(result.amountAtomic, "100");
  assert.equal(result.destinationTokenAccount, destination.toBase58());
});

test("verifies versioned claim payout instructions", () => {
  assert.equal(verifySolanaClaimPayoutReceipt(claim(true)).slot, 100);
});

test("rejects claim with wrong recipient, amount, or mint", () => {
  assert.throws(() => verifySolanaClaimPayoutReceipt({ ...claim(), recipient: treasury.toBase58() }), /recipient_invalid/);
  assert.throws(() => verifySolanaClaimPayoutReceipt({ ...claim(), amountAtomic: "101" }), /payout_instruction_mismatch/);
  assert.throws(() => verifySolanaClaimPayoutReceipt({ ...claim(), mint: Keypair.generate().publicKey.toBase58() }), /payout_instruction_mismatch/);
  assert.throws(() => verifySolanaClaimPayoutReceipt({ ...claim(), treasury: Keypair.generate().publicKey.toBase58() }), /unexpected_signer/);
});

test("rejects unfinalized, failed, and mismatched claim receipts", () => {
  const input = claim();
  assert.throws(() => verifySolanaClaimPayoutReceipt({ ...input, status: { ...input.status, confirmationStatus: "confirmed" } }), /not_finalized/);
  assert.throws(() => verifySolanaClaimPayoutReceipt({ ...input, signature: signature(8) }), /transaction_mismatch_or_failed/);
  assert.throws(() => verifySolanaClaimPayoutReceipt({ ...input, status: { ...input.status, err: { InstructionError: [1, "InvalidArgument"] } } }), /not_finalized/);
});

test("rejects an unrelated token-account balance movement as a payout", () => {
  const input = claim();
  const receipt = { ...input.receipt, meta: { ...input.receipt!.meta!,
    postTokenBalances: input.receipt!.meta!.postTokenBalances!.map((row, index) => index === 1
      ? { ...row, uiTokenAmount: { ...row.uiTokenAmount, amount: "119" } } : row),
  } } as SolanaAutomationReceipt;
  assert.throws(() => verifySolanaClaimPayoutReceipt({ ...input, receipt }), /payout_balance_delta_mismatch/);
});

test("verifies a finalized exact SOL-funded swap and linked SPORTPAD burn", () => {
  const result = verifySportpadBuybackReceipts(buyback());
  assert.equal(result.boughtAndBurnedAtomic, "995000");
  assert.equal(result.inputDebitLamports, "50010000");
});

test("rejects buyback without finalized swap and burn receipts", () => {
  const input = buyback();
  assert.throws(() => verifySportpadBuybackReceipts({ ...input,
    swap: { ...input.swap, status: { ...input.swap.status, confirmationStatus: "confirmed" } },
  }), /not_finalized/);
  assert.throws(() => verifySportpadBuybackReceipts({ ...input,
    burn: { ...input.burn, status: { ...input.burn.status, err: { InstructionError: [0, "InvalidArgument"] } } },
  }), /not_finalized/);
});

test("rejects worker-reported buyback output or input that differs from the chain", () => {
  assert.throws(() => verifySportpadBuybackReceipts({ ...buyback(), purchasedAmountAtomic: "995001" }), /swap_output_delta_mismatch/);
  assert.throws(() => verifySportpadBuybackReceipts({ ...buyback(), inputAmountLamports: "49999999" }), /swap_route_or_input_mismatch/);
  assert.throws(() => verifySportpadBuybackReceipts({ ...buyback(), treasury: recipient.toBase58() }), /unexpected_signer/);
});

test("credits a Solana Fan Token purchase only from the finalized treasury delta", () => {
  const input = buyback();
  assert.equal(observedSolanaRewardPurchaseOutput({
    ...input.swap, mint: input.mint, tokenProgram: input.tokenProgram,
    decimals: input.decimals, treasury: input.treasury,
  }), "995000");
  const result = verifySolanaRewardPurchaseReceipt({
    ...input, ...input.swap, minimumOutputAtomic: "990000",
  });
  assert.equal(result.purchasedAmountAtomic, "995000");
  assert.equal(result.inputDebitLamports, "50010000");
  assert.equal(result.tokenAccount, outputAta.toBase58());
});

test("rejects underfilled, misreported, or unfinalized Solana reward purchases", () => {
  const input = buyback();
  const reward = { ...input, ...input.swap, minimumOutputAtomic: "990000" };
  assert.throws(() => verifySolanaRewardPurchaseReceipt({ ...reward, minimumOutputAtomic: "995001" }), /reward_output_below_minimum/);
  assert.throws(() => verifySolanaRewardPurchaseReceipt({ ...reward, purchasedAmountAtomic: "995001" }), /swap_output_delta_mismatch/);
  assert.throws(() => verifySolanaRewardPurchaseReceipt({ ...reward,
    status: { ...input.swap.status!, confirmationStatus: "confirmed" },
  }), /not_finalized/);
  assert.throws(() => verifySolanaRewardPurchaseReceipt({ ...reward, treasury: recipient.toBase58() }), /unexpected_signer/);
});

test("rejects an extra system transfer from the buyback treasury", () => {
  const input = buyback();
  const maliciousSwap = fixture({
    sig: input.swap.signature, slot: 200,
    ix: [
      SystemProgram.transfer({ fromPubkey: treasury, toPubkey: wrappedSolAta, lamports: 50_000_000 }),
      SystemProgram.transfer({ fromPubkey: treasury, toPubkey: recipient, lamports: 1 }),
      new TransactionInstruction({ programId: metis, keys: [
        { pubkey: treasury, isSigner: true, isWritable: true },
        { pubkey: outputAta, isSigner: false, isWritable: true },
      ], data: Buffer.from([1]) }),
    ],
    preBalances: [1_000_000_000], postBalances: [949_990_000],
    preTokenBalances: (keys) => [tokenRow(keys, outputAta, treasury, "100")],
    postTokenBalances: (keys) => [tokenRow(keys, outputAta, treasury, "995100")],
  });
  assert.throws(() => verifySportpadBuybackReceipts({ ...input, swap: maliciousSwap }), /swap_sol_transfer_mismatch/);
});

test("rejects a burn that differs from the swap output", () => {
  const input = buyback();
  const receipt = { ...input.burn.receipt!, meta: { ...input.burn.receipt!.meta!,
    postTokenBalances: input.burn.receipt!.meta!.postTokenBalances!.map((row, index) => index === 0
      ? { ...row, uiTokenAmount: { ...row.uiTokenAmount, amount: "101" } } : row),
  } } as SolanaAutomationReceipt;
  assert.throws(() => verifySportpadBuybackReceipts({ ...input, burn: { ...input.burn, receipt } }), /burn_balance_delta_mismatch/);
});

test("rejects a burn preceding the swap or using the same signature", () => {
  const input = buyback();
  const status = { ...input.burn.status!, slot: 199 };
  const receipt = { ...input.burn.receipt!, slot: 199 } as SolanaAutomationReceipt;
  assert.throws(() => verifySportpadBuybackReceipts({ ...input, burn: { ...input.burn, receipt, status } }), /swap_burn_link_mismatch/);
  assert.throws(() => verifySportpadBuybackReceipts({ ...input, burn: { ...input.burn, signature: input.swap.signature } }), /same_signature/);
});
