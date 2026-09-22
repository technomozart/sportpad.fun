import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { Buffer } from "buffer";

import {
  PUMP_CREATE_FEE_CONFIG_DISCRIMINATOR,
  PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  bondingCurvePda,
  encodePumpCreateV2Data,
  encodePumpFeeSharesV2Data,
  feeSharingConfigPda,
} from "./pump-devnet-verification.ts";

export const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const MAYHEM_PROGRAM_ID = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
export const PUMP_AMM_TRANSFER_CREATOR_FEES_V2_DISCRIMINATOR = Uint8Array.from([1, 33, 78, 185, 33, 67, 44, 92]);

function pda(programId: PublicKey, ...seeds: Uint8Array[]) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function constantSeed(value: string) {
  return new TextEncoder().encode(value);
}

function eventAuthority(programId: PublicKey) {
  return pda(programId, constantSeed("__event_authority"));
}

function associatedTokenAddress(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey) {
  return pda(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    owner.toBytes(),
    tokenProgram.toBytes(),
    mint.toBytes(),
  );
}

export function pumpAmmCreatorVaultPda(creator: PublicKey) {
  return pda(PUMP_AMM_PROGRAM_ID, constantSeed("creator_vault"), creator.toBytes());
}

function meta(pubkey: PublicKey, isSigner = false, isWritable = false): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

export function buildPumpCreateV2Instruction({
  mint,
  creator,
  name,
  symbol,
  uri,
}: {
  mint: PublicKey;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
}) {
  const curve = bondingCurvePda(mint);
  const mayhemGlobalParams = pda(MAYHEM_PROGRAM_ID, constantSeed("global-params"));
  const mayhemSolVault = pda(MAYHEM_PROGRAM_ID, constantSeed("sol-vault"));
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      meta(mint, true, true),
      meta(pda(PUMP_PROGRAM_ID, constantSeed("mint-authority"))),
      meta(curve, false, true),
      meta(associatedTokenAddress(mint, curve, TOKEN_2022_PROGRAM_ID), false, true),
      meta(pda(PUMP_PROGRAM_ID, constantSeed("global"))),
      meta(creator, true, true),
      meta(SystemProgram.programId),
      meta(TOKEN_2022_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(MAYHEM_PROGRAM_ID, false, true),
      meta(mayhemGlobalParams),
      meta(mayhemSolVault, false, true),
      meta(pda(MAYHEM_PROGRAM_ID, constantSeed("mayhem-state"), mint.toBytes()), false, true),
      meta(associatedTokenAddress(mint, mayhemSolVault, TOKEN_2022_PROGRAM_ID), false, true),
      meta(eventAuthority(PUMP_PROGRAM_ID)),
      meta(PUMP_PROGRAM_ID),
    ],
    data: Buffer.from(encodePumpCreateV2Data({ name, symbol, uri, creator })),
  });
}

export function buildPumpCreateFeeConfigInstruction({ creator, mint }: { creator: PublicKey; mint: PublicKey }) {
  return new TransactionInstruction({
    programId: PUMP_FEE_PROGRAM_ID,
    keys: [
      meta(eventAuthority(PUMP_FEE_PROGRAM_ID)),
      meta(PUMP_FEE_PROGRAM_ID),
      meta(creator, true, true),
      meta(pda(PUMP_PROGRAM_ID, constantSeed("global"))),
      meta(mint),
      meta(feeSharingConfigPda(mint), false, true),
      meta(SystemProgram.programId),
      meta(bondingCurvePda(mint), false, true),
      meta(PUMP_PROGRAM_ID),
      meta(eventAuthority(PUMP_PROGRAM_ID)),
      meta(PUMP_FEE_PROGRAM_ID), // Anchor's null optional-account sentinel for pool.
      meta(PUMP_AMM_PROGRAM_ID),
      meta(eventAuthority(PUMP_AMM_PROGRAM_ID)),
    ],
    data: Buffer.from(PUMP_CREATE_FEE_CONFIG_DISCRIMINATOR),
  });
}

export function buildPumpUpdateFeeSharesV2Instruction({
  authority,
  mint,
  rewardWallet,
  burnWallet,
  rewardShareBps,
  burnShareBps,
}: {
  authority: PublicKey;
  mint: PublicKey;
  rewardWallet: PublicKey;
  burnWallet: PublicKey;
  rewardShareBps: number;
  burnShareBps: number;
}) {
  const sharingConfig = feeSharingConfigPda(mint);
  const pumpCreatorVault = pda(PUMP_PROGRAM_ID, constantSeed("creator-vault"), sharingConfig.toBytes());
  const ammCreatorVault = pda(PUMP_AMM_PROGRAM_ID, constantSeed("creator_vault"), sharingConfig.toBytes());
  return new TransactionInstruction({
    programId: PUMP_FEE_PROGRAM_ID,
    keys: [
      meta(eventAuthority(PUMP_FEE_PROGRAM_ID)),
      meta(PUMP_FEE_PROGRAM_ID),
      meta(authority, true, true),
      meta(pda(PUMP_PROGRAM_ID, constantSeed("global"))),
      meta(mint),
      meta(sharingConfig, false, true),
      meta(bondingCurvePda(mint)),
      meta(pumpCreatorVault, false, true),
      meta(associatedTokenAddress(NATIVE_MINT, pumpCreatorVault, TOKEN_PROGRAM_ID), false, true),
      meta(SystemProgram.programId),
      meta(PUMP_PROGRAM_ID),
      meta(eventAuthority(PUMP_PROGRAM_ID)),
      meta(PUMP_AMM_PROGRAM_ID),
      meta(eventAuthority(PUMP_AMM_PROGRAM_ID)),
      meta(NATIVE_MINT),
      meta(TOKEN_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(ammCreatorVault, false, true),
      meta(associatedTokenAddress(NATIVE_MINT, ammCreatorVault, TOKEN_PROGRAM_ID), false, true),
      meta(authority, false, true),
    ],
    data: Buffer.from(encodePumpFeeSharesV2Data([
      { address: rewardWallet, shareBps: rewardShareBps },
      { address: burnWallet, shareBps: burnShareBps },
    ])),
  });
}

export function buildPumpAmmTransferCreatorFeesToPumpV2Instruction({
  payer,
  mint,
}: {
  payer: PublicKey;
  mint: PublicKey;
}) {
  const sharingConfig = feeSharingConfigPda(mint);
  const ammCreatorVault = pumpAmmCreatorVaultPda(sharingConfig);
  const pumpCreatorVault = pda(PUMP_PROGRAM_ID, constantSeed("creator-vault"), sharingConfig.toBytes());
  return new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM_ID,
    keys: [
      meta(payer, true, true),
      meta(NATIVE_MINT),
      meta(TOKEN_PROGRAM_ID),
      meta(SystemProgram.programId),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(sharingConfig),
      meta(ammCreatorVault, false, true),
      meta(associatedTokenAddress(NATIVE_MINT, ammCreatorVault, TOKEN_PROGRAM_ID), false, true),
      meta(pumpCreatorVault, false, true),
      meta(associatedTokenAddress(NATIVE_MINT, pumpCreatorVault, TOKEN_PROGRAM_ID), false, true),
      meta(eventAuthority(PUMP_AMM_PROGRAM_ID)),
      meta(PUMP_AMM_PROGRAM_ID),
    ],
    data: Buffer.from(PUMP_AMM_TRANSFER_CREATOR_FEES_V2_DISCRIMINATOR),
  });
}

export function buildPumpDistributeCreatorFeesV2Instruction({
  payer,
  mint,
  shareholders,
}: {
  payer: PublicKey;
  mint: PublicKey;
  shareholders: PublicKey[];
}) {
  if (shareholders.length === 0 || shareholders.length > 10) {
    throw new Error("Pump fee distribution requires between one and ten shareholders.");
  }
  const sharingConfig = feeSharingConfigPda(mint);
  const pumpCreatorVault = pda(PUMP_PROGRAM_ID, constantSeed("creator-vault"), sharingConfig.toBytes());
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      meta(payer, true, true),
      meta(mint),
      meta(bondingCurvePda(mint)),
      meta(sharingConfig),
      meta(pumpCreatorVault, false, true),
      meta(SystemProgram.programId),
      meta(eventAuthority(PUMP_PROGRAM_ID)),
      meta(PUMP_PROGRAM_ID),
      meta(associatedTokenAddress(NATIVE_MINT, pumpCreatorVault, TOKEN_PROGRAM_ID), false, true),
      meta(NATIVE_MINT),
      meta(TOKEN_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      ...shareholders.map((shareholder) => meta(shareholder, false, true)),
    ],
    data: Buffer.from([...PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR, 0]),
  });
}
