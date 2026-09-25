import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import bs58 from "bs58";

import { REWARD_FEE_BPS, SPORTPAD_FEE_BPS } from "../../protocol/devnet-launch.ts";
import {
  buildPumpAmmTransferCreatorFeesToPumpV2Instruction,
  buildPumpDistributeCreatorFeesV2Instruction,
  pumpAmmCreatorVaultPda,
} from "../../protocol/pump-devnet-instructions.ts";
import {
  NATIVE_MINT,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  bondingCurvePda,
  creatorVaultPda,
  decodePumpBondingCurve,
  decodePumpSharingConfig,
  feeSharingConfigPda,
} from "../../protocol/pump-devnet-verification.ts";

/** Pump's official creator-fee-sharing instructions make the payer a
 * permissionless transaction signer. In this lane the existing 80% treasury
 * pays the network fee; it is NOT a third fee recipient. This module does not
 * broadcast or make the path production-ready. */
const COMPUTE_UNITS = 400_000;
const MAX_NETWORK_FEE_LAMPORTS = 50_000;
const MAX_TRANSACTION_BYTES = 1232;

export type RewardPayerPumpCollectionPlan = {
  kind: "pump_v2_reward_payer";
  mint: string;
  rewardTreasury: string;
  buybackTreasury: string;
  sweptAmm: boolean;
  accountSlot: number;
  simulationSlot: number;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  estimatedNetworkFeeLamports: number;
  unsignedTransactionBase64: string;
  unsignedMessageSha256: string;
};

export type SignedRewardPayerPumpCollection = RewardPayerPumpCollectionPlan & {
  signedTransactionBase64: string;
  signedTransactionSha256: string;
  sourceSignature: string;
};

function sha256(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

function canonicalAddress(value: string, label: string) {
  let key: PublicKey;
  try { key = new PublicKey(value); }
  catch { throw new Error(`pump_collection_${label}_invalid`); }
  if (key.toBase58() !== value) throw new Error(`pump_collection_${label}_invalid`);
  return key;
}

function expectedMessage(input: {
  mint: PublicKey;
  reward: PublicKey;
  buyback: PublicKey;
  sweptAmm: boolean;
  recentBlockhash: string;
}) {
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS })];
  if (input.sweptAmm) instructions.push(buildPumpAmmTransferCreatorFeesToPumpV2Instruction({
    payer: input.reward, mint: input.mint,
  }));
  instructions.push(buildPumpDistributeCreatorFeesV2Instruction({
    payer: input.reward, mint: input.mint, shareholders: [input.reward, input.buyback],
  }));
  return new TransactionMessage({
    payerKey: input.reward,
    recentBlockhash: input.recentBlockhash,
    instructions,
  }).compileToV0Message();
}

function inspectExactMessage(plan: RewardPayerPumpCollectionPlan, transaction: VersionedTransaction) {
  const mint = canonicalAddress(plan.mint, "mint");
  const reward = canonicalAddress(plan.rewardTreasury, "reward_treasury");
  const buyback = canonicalAddress(plan.buybackTreasury, "buyback_treasury");
  if (reward.equals(buyback) || !PublicKey.isOnCurve(reward.toBytes())) {
    throw new Error("pump_collection_wallet_route_invalid");
  }
  if (transaction.message.addressTableLookups.length !== 0 ||
      transaction.message.header.numRequiredSignatures !== 1 ||
      transaction.signatures.length !== 1 ||
      !transaction.message.staticAccountKeys[0]?.equals(reward) ||
      transaction.message.recentBlockhash !== plan.recentBlockhash) {
    throw new Error("pump_collection_message_shape_invalid");
  }
  const expected = expectedMessage({ mint, reward, buyback,
    sweptAmm: plan.sweptAmm, recentBlockhash: plan.recentBlockhash });
  if (!Buffer.from(transaction.message.serialize()).equals(Buffer.from(expected.serialize()))) {
    throw new Error("pump_collection_instruction_effects_invalid");
  }
  return { mint, reward, buyback };
}

function decodeCanonicalBase64(value: string, label: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`pump_collection_${label}_invalid`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 100 || bytes.length > MAX_TRANSACTION_BYTES ||
      bytes.toString("base64") !== value) throw new Error(`pump_collection_${label}_invalid`);
  return bytes;
}

/** Read finalized Pump state, build the canonical no-ALT message, estimate its
 * network fee, and simulate. There is no signer, storage write, or send here. */
export async function prepareRewardPayerPumpFeeCollection(input: {
  connection: Pick<Connection,
    "getMultipleAccountsInfoAndContext" | "getLatestBlockhashAndContext" |
    "getFeeForMessage" | "simulateTransaction">;
  mint: string;
  rewardTreasury: string;
  buybackTreasury: string;
}): Promise<RewardPayerPumpCollectionPlan> {
  const mint = canonicalAddress(input.mint, "mint");
  const reward = canonicalAddress(input.rewardTreasury, "reward_treasury");
  const buyback = canonicalAddress(input.buybackTreasury, "buyback_treasury");
  if (reward.equals(buyback) || !PublicKey.isOnCurve(reward.toBytes())) {
    throw new Error("pump_collection_wallet_route_invalid");
  }
  const accounts = await input.connection.getMultipleAccountsInfoAndContext(
    [bondingCurvePda(mint), feeSharingConfigPda(mint)], "finalized");
  const [curveAccount, sharingAccount] = accounts.value;
  if (!curveAccount || !sharingAccount ||
      curveAccount.executable || sharingAccount.executable ||
      !curveAccount.owner.equals(PUMP_PROGRAM_ID) ||
      !sharingAccount.owner.equals(PUMP_FEE_PROGRAM_ID)) {
    throw new Error("pump_collection_program_accounts_invalid");
  }
  const curve = decodePumpBondingCurve(curveAccount.data);
  const sharing = decodePumpSharingConfig(sharingAccount.data);
  if (!curve.creator.equals(feeSharingConfigPda(mint)) ||
      !curve.quoteMint.equals(NATIVE_MINT) || !sharing.mint.equals(mint) ||
      sharing.version !== 2 || sharing.status !== 1 || !sharing.adminRevoked ||
      sharing.shareholders.length !== 2 ||
      !sharing.shareholders[0].address.equals(reward) ||
      sharing.shareholders[0].shareBps !== REWARD_FEE_BPS ||
      !sharing.shareholders[1].address.equals(buyback) ||
      sharing.shareholders[1].shareBps !== SPORTPAD_FEE_BPS) {
    throw new Error("pump_collection_immutable_80_20_route_invalid");
  }
  const latest = await input.connection.getLatestBlockhashAndContext({
    commitment: "finalized", minContextSlot: accounts.context.slot,
  });
  if (latest.context.slot < accounts.context.slot ||
      !Number.isSafeInteger(latest.value.lastValidBlockHeight) ||
      latest.value.lastValidBlockHeight <= 0) {
    throw new Error("pump_collection_blockhash_invalid");
  }
  const message = expectedMessage({ mint, reward, buyback,
    sweptAmm: curve.complete, recentBlockhash: latest.value.blockhash });
  const unsigned = new VersionedTransaction(message);
  if (unsigned.serialize().length > MAX_TRANSACTION_BYTES) {
    throw new Error("pump_collection_transaction_too_large");
  }
  const fee = await input.connection.getFeeForMessage(message, "finalized");
  if (fee.context.slot < accounts.context.slot || fee.value === null ||
      !Number.isSafeInteger(fee.value) || fee.value <= 0 ||
      fee.value > MAX_NETWORK_FEE_LAMPORTS) {
    throw new Error("pump_collection_network_fee_unbounded");
  }
  const simulated = await input.connection.simulateTransaction(unsigned, {
    commitment: "finalized", minContextSlot: accounts.context.slot,
    sigVerify: false, replaceRecentBlockhash: false,
  });
  if (simulated.context.slot < accounts.context.slot || simulated.value.err !== null) {
    throw new Error("pump_collection_simulation_failed");
  }
  return {
    kind: "pump_v2_reward_payer", mint: mint.toBase58(),
    rewardTreasury: reward.toBase58(), buybackTreasury: buyback.toBase58(),
    sweptAmm: curve.complete, accountSlot: accounts.context.slot,
    simulationSlot: simulated.context.slot,
    recentBlockhash: latest.value.blockhash,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
    estimatedNetworkFeeLamports: fee.value,
    unsignedTransactionBase64: Buffer.from(unsigned.serialize()).toString("base64"),
    unsignedMessageSha256: sha256(message.serialize()),
  };
}

/** Bind the unsigned plan to the configured reward treasury and current
 * finalized block height. This function signs but deliberately never sends. */
export function signRewardPayerPumpFeeCollection(input: {
  plan: RewardPayerPumpCollectionPlan;
  signer: Keypair;
  configuredMint: string;
  configuredRewardTreasury: string;
  configuredBuybackTreasury: string;
  finalizedBlockHeight: number;
}): SignedRewardPayerPumpCollection {
  const { plan } = input;
  if (plan.kind !== "pump_v2_reward_payer" ||
      plan.mint !== input.configuredMint ||
      plan.rewardTreasury !== input.configuredRewardTreasury ||
      plan.buybackTreasury !== input.configuredBuybackTreasury ||
      input.signer.publicKey.toBase58() !== plan.rewardTreasury ||
      !Number.isSafeInteger(input.finalizedBlockHeight) ||
      input.finalizedBlockHeight <= 0 ||
      input.finalizedBlockHeight > plan.lastValidBlockHeight ||
      !Number.isSafeInteger(plan.estimatedNetworkFeeLamports) ||
      plan.estimatedNetworkFeeLamports <= 0 ||
      plan.estimatedNetworkFeeLamports > MAX_NETWORK_FEE_LAMPORTS) {
    throw new Error("pump_collection_signing_scope_invalid");
  }
  const unsignedBytes = decodeCanonicalBase64(plan.unsignedTransactionBase64, "unsigned_transaction");
  const unsigned = VersionedTransaction.deserialize(unsignedBytes);
  inspectExactMessage(plan, unsigned);
  if (unsigned.signatures[0].some((byte) => byte !== 0) ||
      sha256(unsigned.message.serialize()) !== plan.unsignedMessageSha256) {
    throw new Error("pump_collection_unsigned_plan_invalid");
  }
  unsigned.sign([input.signer]);
  const signedBytes = Buffer.from(unsigned.serialize());
  const signature = unsigned.signatures[0];
  if (!ed25519.verify(signature, unsigned.message.serialize(), input.signer.publicKey.toBytes())) {
    throw new Error("pump_collection_signature_invalid");
  }
  return {
    ...plan,
    signedTransactionBase64: signedBytes.toString("base64"),
    signedTransactionSha256: sha256(signedBytes),
    sourceSignature: bs58.encode(signature),
  };
}

export type FinalizedPumpCollectionReceipt = {
  slot: number;
  confirmationStatus: "finalized";
  transactionBase64: string;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
  };
};

function matchesPumpRounding(reward: bigint, buyback: bigint) {
  const received = reward + buyback;
  for (const distributed of [received, received + 1n]) {
    if (distributed * 8_000n / 10_000n === reward &&
        distributed * 2_000n / 10_000n === buyback) return true;
  }
  return false;
}

/** Caller must obtain this receipt and status from finalized Solana RPC. This
 * validates the exact persisted signed bytes and accounts, including the
 * reward treasury's network-fee debit, before any ledger credit is possible. */
export function verifyFinalizedRewardPayerPumpFeeCollection(input: {
  signed: SignedRewardPayerPumpCollection;
  receipt: FinalizedPumpCollectionReceipt;
}) {
  const { signed, receipt } = input;
  if (receipt.confirmationStatus !== "finalized" ||
      !Number.isSafeInteger(receipt.slot) || receipt.slot <= 0 ||
      receipt.meta.err !== null ||
      !Number.isSafeInteger(receipt.meta.fee) || receipt.meta.fee <= 0 ||
      receipt.meta.fee > MAX_NETWORK_FEE_LAMPORTS ||
      receipt.meta.fee > signed.estimatedNetworkFeeLamports) {
    throw new Error("pump_collection_receipt_finality_or_fee_invalid");
  }
  const signedBytes = decodeCanonicalBase64(signed.signedTransactionBase64, "signed_transaction");
  const receiptBytes = decodeCanonicalBase64(receipt.transactionBase64, "receipt_transaction");
  if (!receiptBytes.equals(signedBytes) ||
      sha256(signedBytes) !== signed.signedTransactionSha256) {
    throw new Error("pump_collection_receipt_transaction_mismatch");
  }
  const transaction = VersionedTransaction.deserialize(signedBytes);
  const { mint, reward, buyback } = inspectExactMessage(signed, transaction);
  const signature = transaction.signatures[0];
  if (bs58.encode(signature) !== signed.sourceSignature ||
      !ed25519.verify(signature, transaction.message.serialize(), reward.toBytes())) {
    throw new Error("pump_collection_receipt_signature_invalid");
  }
  if (receipt.meta.loadedAddresses &&
      (receipt.meta.loadedAddresses.writable.length || receipt.meta.loadedAddresses.readonly.length)) {
    throw new Error("pump_collection_receipt_unexpected_lookup_accounts");
  }
  const keys = transaction.message.staticAccountKeys.map((key) => key.toBase58());
  const { preBalances, postBalances } = receipt.meta;
  if (preBalances.length !== keys.length || postBalances.length !== keys.length ||
      ![...preBalances, ...postBalances].every((value) =>
        Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("pump_collection_receipt_balances_invalid");
  }
  const allowedBalanceChanges = new Set([
    reward.toBase58(), buyback.toBase58(),
    creatorVaultPda(feeSharingConfigPda(mint)).toBase58(),
  ]);
  if (signed.sweptAmm) {
    const ammVault = pumpAmmCreatorVaultPda(feeSharingConfigPda(mint));
    const pumpVault = creatorVaultPda(feeSharingConfigPda(mint));
    allowedBalanceChanges.add(ammVault.toBase58());
    allowedBalanceChanges.add(getAssociatedTokenAddressSync(
      NATIVE_MINT, ammVault, true, TOKEN_PROGRAM_ID).toBase58());
    allowedBalanceChanges.add(getAssociatedTokenAddressSync(
      NATIVE_MINT, pumpVault, true, TOKEN_PROGRAM_ID).toBase58());
  }
  let totalDelta = 0n;
  for (let index = 0; index < keys.length; index += 1) {
    const delta = BigInt(postBalances[index]) - BigInt(preBalances[index]);
    totalDelta += delta;
    if (delta !== 0n && !allowedBalanceChanges.has(keys[index])) {
      throw new Error("pump_collection_receipt_unexpected_balance_change");
    }
  }
  if (totalDelta !== -BigInt(receipt.meta.fee)) {
    throw new Error("pump_collection_receipt_balance_conservation_invalid");
  }
  const rewardIndex = keys.indexOf(reward.toBase58());
  const buybackIndex = keys.indexOf(buyback.toBase58());
  const rewardNetLamports = BigInt(postBalances[rewardIndex]) - BigInt(preBalances[rewardIndex]);
  const rewardGrossLamports = rewardNetLamports + BigInt(receipt.meta.fee);
  const buybackLamports = BigInt(postBalances[buybackIndex]) - BigInt(preBalances[buybackIndex]);
  if (rewardNetLamports <= 0n || buybackLamports <= 0n ||
      !matchesPumpRounding(rewardGrossLamports, buybackLamports)) {
    throw new Error("pump_collection_receipt_80_20_invalid");
  }
  return {
    signature: signed.sourceSignature,
    signedTransactionSha256: signed.signedTransactionSha256,
    slot: receipt.slot,
    mint: mint.toBase58(),
    rewardTreasury: reward.toBase58(),
    buybackTreasury: buyback.toBase58(),
    networkFeeLamports: receipt.meta.fee.toString(),
    rewardGrossLamports: rewardGrossLamports.toString(),
    rewardNetLamports: rewardNetLamports.toString(),
    buybackLamports: buybackLamports.toString(),
    totalDistributedLamports: (rewardGrossLamports + buybackLamports).toString(),
  };
}
