import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  buildPumpCreateFeeConfigInstruction,
  buildPumpCreateV2Instruction,
  buildPumpUpdateFeeSharesV2Instruction,
} from "./pump-devnet-instructions.ts";

const creator = new PublicKey("11111111111111111111111111111111");
const mint = new PublicKey("So11111111111111111111111111111111111111112");
const reward = new PublicKey("SysvarRent111111111111111111111111111111111");
const burn = new PublicKey("Vote111111111111111111111111111111111111111");

function fixture(instruction: ReturnType<typeof buildPumpCreateV2Instruction>) {
  return instruction.keys.map(({ pubkey, isSigner, isWritable }) => [pubkey.toBase58(), isSigner, isWritable]);
}

test("builds the official Pump create_v2 instruction exactly", () => {
  const instruction = buildPumpCreateV2Instruction({ mint, creator, name: "Name", symbol: "SYM", uri: "uri" });
  assert.equal(instruction.programId.toBase58(), "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  assert.equal(instruction.data.toString("hex"), "d6904cec5f8b31b4040000004e616d650300000053594d0300000075726900000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
  assert.deepEqual(fixture(instruction), [
    ["So11111111111111111111111111111111111111112", true, true],
    ["TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM", false, false],
    ["6PiyjiAPkp2KdZtqkyQYzVsD1Prv7t8v4TaYd8ip4YFd", false, true],
    ["FTk4VJGfmJ62hWvhKWugk4pEk7gZZRJKf4LBRriq36AY", false, true],
    ["4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf", false, false],
    ["11111111111111111111111111111111", true, true],
    ["11111111111111111111111111111111", false, false],
    ["TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", false, false],
    ["ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", false, false],
    ["MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e", false, true],
    ["13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ", false, false],
    ["BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s", false, true],
    ["G4B72nNj73YuTvHThfwfmJuXtzcmFAbv396cxtUVzeN6", false, true],
    ["FUFqcqxrruQi16CfvbvphwvwwS9a2JoMbusVjpWbMRyG", false, true],
    ["Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", false, false],
    ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", false, false],
  ]);
});

test("builds the official Pump fee config and immutable 80/20 update exactly", () => {
  const createConfig = buildPumpCreateFeeConfigInstruction({ creator, mint });
  assert.equal(createConfig.data.toString("hex"), "c34e564c6f34fbd5");
  assert.deepEqual(fixture(createConfig), [
    ["D6QxXDt6hhcCpto4HiZKkN2YQ2iZRF5R7S3caCHpUsML", false, false],
    ["pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ", false, false],
    ["11111111111111111111111111111111", true, true],
    ["4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf", false, false],
    ["So11111111111111111111111111111111111111112", false, false],
    ["JByeZXCdfwWAbviYMpqZ1scSuopRtz5DwzcLtQ3bd3uH", false, true],
    ["11111111111111111111111111111111", false, false],
    ["6PiyjiAPkp2KdZtqkyQYzVsD1Prv7t8v4TaYd8ip4YFd", false, true],
    ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", false, false],
    ["Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", false, false],
    ["pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ", false, false],
    ["pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", false, false],
    ["GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR", false, false],
  ]);

  const update = buildPumpUpdateFeeSharesV2Instruction({
    authority: creator,
    mint,
    rewardWallet: reward,
    burnWallet: burn,
    rewardShareBps: 8000,
    burnShareBps: 2000,
  });
  assert.equal(update.data.toString("hex"), "6ffb31064e4e6a120200000006a7d517192c5c51218cc94c3d4af17f58daee089ba1fd44e3dbd98a00000000401f0761481d357474bb7c4d7624ebd3bdb3d8355e73d11043fc0da3538000000000d007");
  assert.deepEqual(fixture(update), [
    ["D6QxXDt6hhcCpto4HiZKkN2YQ2iZRF5R7S3caCHpUsML", false, false],
    ["pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ", false, false],
    ["11111111111111111111111111111111", true, true],
    ["4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf", false, false],
    ["So11111111111111111111111111111111111111112", false, false],
    ["JByeZXCdfwWAbviYMpqZ1scSuopRtz5DwzcLtQ3bd3uH", false, true],
    ["6PiyjiAPkp2KdZtqkyQYzVsD1Prv7t8v4TaYd8ip4YFd", false, false],
    ["ApCgVZEU2uvGqQvSppxDkGLxeWUJQKdEsUAaRQuUTRfJ", false, true],
    ["YpA93evQd4MS5uQtyAh18xRaDtgTwfWUgULmfToaMiY", false, true],
    ["11111111111111111111111111111111", false, false],
    ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", false, false],
    ["Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", false, false],
    ["pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", false, false],
    ["GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR", false, false],
    ["So11111111111111111111111111111111111111112", false, false],
    ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", false, false],
    ["ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", false, false],
    ["Hp1JCRYDUZ3MVZKR38VGNKKZByCJ4Vu3C8C6qx1XCqtS", false, true],
    ["3K8QVh75ysWbsCbVUXrgYaXStXPF91bSRrLfBqTGVEzJ", false, true],
    ["11111111111111111111111111111111", false, true],
  ]);
});
