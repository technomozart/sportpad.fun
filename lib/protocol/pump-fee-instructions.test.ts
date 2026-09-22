import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  PUMP_AMM_PROGRAM_ID,
  PUMP_AMM_TRANSFER_CREATOR_FEES_V2_DISCRIMINATOR,
  buildPumpAmmTransferCreatorFeesToPumpV2Instruction,
  buildPumpDistributeCreatorFeesV2Instruction,
  pumpAmmCreatorVaultPda,
} from "./pump-devnet-instructions.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR,
  PUMP_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  bondingCurvePda,
  creatorVaultPda,
  feeSharingConfigPda,
  pumpEventAuthorityPda,
} from "./pump-devnet-verification.ts";

function key(byte: number) {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte));
}

test("builds the exact Pump AMM V2 fee sweep account layout", () => {
  const payer = key(1);
  const mint = key(2);
  const sharing = feeSharingConfigPda(mint);
  const ammVault = pumpAmmCreatorVaultPda(sharing);
  const instruction = buildPumpAmmTransferCreatorFeesToPumpV2Instruction({ payer, mint });

  assert.equal(instruction.programId.toBase58(), PUMP_AMM_PROGRAM_ID.toBase58());
  assert.deepEqual([...instruction.data], [...PUMP_AMM_TRANSFER_CREATOR_FEES_V2_DISCRIMINATOR]);
  assert.deepEqual(instruction.keys.slice(0, 7).map((item) => item.pubkey.toBase58()), [
    payer,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    sharing,
    ammVault,
  ].map((item) => item.toBase58()));
  assert.equal(instruction.keys[0].isSigner, true);
  assert.equal(instruction.keys[0].isWritable, true);
  assert.equal(instruction.keys[6].isWritable, true);
  assert.equal(instruction.keys.length, 12);
});

test("builds the exact Pump V2 fee distribution account layout", () => {
  const payer = key(3);
  const mint = key(4);
  const reward = key(5);
  const buyback = key(6);
  const sharing = feeSharingConfigPda(mint);
  const instruction = buildPumpDistributeCreatorFeesV2Instruction({ payer, mint, shareholders: [reward, buyback] });

  assert.equal(instruction.programId.toBase58(), PUMP_PROGRAM_ID.toBase58());
  assert.deepEqual([...instruction.data], [...PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR, 0]);
  assert.deepEqual(instruction.keys.map((item) => item.pubkey.toBase58()), [
    payer,
    mint,
    bondingCurvePda(mint),
    sharing,
    creatorVaultPda(sharing),
    SystemProgram.programId,
    pumpEventAuthorityPda(),
    PUMP_PROGRAM_ID,
    instruction.keys[8].pubkey,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    reward,
    buyback,
  ].map((item) => item.toBase58()));
  assert.equal(instruction.keys[4].isWritable, true);
  assert.equal(instruction.keys[12].isWritable, true);
  assert.equal(instruction.keys[13].isWritable, true);
});

test("rejects an invalid Pump shareholder count", () => {
  assert.throws(
    () => buildPumpDistributeCreatorFeesV2Instruction({ payer: key(7), mint: key(8), shareholders: [] }),
    /between one and ten/,
  );
});
