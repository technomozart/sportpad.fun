import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";

import { REWARD_FEE_BPS, SPORTPAD_FEE_BPS } from "../../protocol/devnet-launch.ts";
import {
  buildPumpAmmTransferCreatorFeesToPumpV2Instruction,
  buildPumpDistributeCreatorFeesV2Instruction,
} from "../../protocol/pump-devnet-instructions.ts";
import {
  NATIVE_MINT,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  bondingCurvePda,
  decodePumpBondingCurve,
  decodePumpSharingConfig,
  feeSharingConfigPda,
} from "../../protocol/pump-devnet-verification.ts";

/**
 * Checks a prospective dedicated fee collector against finalized Pump state.
 * The unsigned transaction exists only inside this function for RPC simulation.
 * This does not authorize collection or establish that a future send will succeed.
 */
export async function preflightPumpV2FeeCollection(input: {
  connection: Pick<Connection,
    "getMultipleAccountsInfoAndContext" | "getLatestBlockhashAndContext" | "simulateTransaction">;
  collectorAddress: string;
  mintAddress: string;
  rewardTreasuryAddress: string;
  buybackTreasuryAddress: string;
}) {
  const collector = new PublicKey(input.collectorAddress);
  const mint = new PublicKey(input.mintAddress);
  const reward = new PublicKey(input.rewardTreasuryAddress);
  const buyback = new PublicKey(input.buybackTreasuryAddress);
  if (collector.equals(reward) || collector.equals(buyback) || reward.equals(buyback)) {
    throw new Error("pump_fee_preflight_wallets_not_distinct");
  }

  const curveAddress = bondingCurvePda(mint);
  const sharingAddress = feeSharingConfigPda(mint);
  const accounts = await input.connection.getMultipleAccountsInfoAndContext(
    [curveAddress, sharingAddress], "finalized",
  );
  const [curveAccount, sharingAccount] = accounts.value;
  if (!curveAccount || !sharingAccount) throw new Error("pump_fee_preflight_accounts_missing");
  if (curveAccount.executable || !curveAccount.owner.equals(PUMP_PROGRAM_ID) ||
    sharingAccount.executable || !sharingAccount.owner.equals(PUMP_FEE_PROGRAM_ID)) {
    throw new Error("pump_fee_preflight_account_owner_invalid");
  }

  const curve = decodePumpBondingCurve(curveAccount.data);
  const sharing = decodePumpSharingConfig(sharingAccount.data);
  if (!curve.creator.equals(sharingAddress) || !sharing.mint.equals(mint)) {
    throw new Error("pump_fee_preflight_curve_config_mismatch");
  }
  if (!curve.quoteMint.equals(NATIVE_MINT)) throw new Error("pump_fee_preflight_not_sol_paired");
  if (sharing.version !== 2 || sharing.status !== 1 || !sharing.adminRevoked) {
    throw new Error("pump_fee_preflight_config_not_immutable_v2");
  }
  if (sharing.shareholders.length !== 2 ||
    !sharing.shareholders[0].address.equals(reward) ||
    sharing.shareholders[0].shareBps !== REWARD_FEE_BPS ||
    !sharing.shareholders[1].address.equals(buyback) ||
    sharing.shareholders[1].shareBps !== SPORTPAD_FEE_BPS) {
    throw new Error("pump_fee_preflight_share_route_mismatch");
  }

  const blockhash = await input.connection.getLatestBlockhashAndContext({
    commitment: "finalized", minContextSlot: accounts.context.slot,
  });
  if (blockhash.context.slot < accounts.context.slot) {
    throw new Error("pump_fee_preflight_blockhash_slot_stale");
  }
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];
  if (curve.complete) {
    instructions.push(buildPumpAmmTransferCreatorFeesToPumpV2Instruction({ payer: collector, mint }));
  }
  instructions.push(buildPumpDistributeCreatorFeesV2Instruction({
    payer: collector, mint, shareholders: [reward, buyback],
  }));
  const unsigned = new VersionedTransaction(new TransactionMessage({
    payerKey: collector,
    recentBlockhash: blockhash.value.blockhash,
    instructions,
  }).compileToV0Message());
  const simulation = await input.connection.simulateTransaction(unsigned, {
    commitment: "finalized",
    minContextSlot: accounts.context.slot,
    sigVerify: false,
    replaceRecentBlockhash: false,
  });
  if (simulation.context.slot < accounts.context.slot) {
    throw new Error("pump_fee_preflight_simulation_slot_stale");
  }
  if (simulation.value.err !== null) throw new Error("pump_fee_preflight_simulation_failed");

  return {
    status: "inspection_only" as const,
    executionReady: false as const,
    collectorAddress: collector.toBase58(),
    mintAddress: mint.toBase58(),
    rewardTreasuryAddress: reward.toBase58(),
    buybackTreasuryAddress: buyback.toBase58(),
    rewardShareBps: REWARD_FEE_BPS,
    buybackShareBps: SPORTPAD_FEE_BPS,
    sweptAmmInSimulation: curve.complete,
    accountSlot: accounts.context.slot,
    simulationSlot: simulation.context.slot,
    simulationUnitsConsumed: simulation.value.unitsConsumed ?? null,
  };
}
