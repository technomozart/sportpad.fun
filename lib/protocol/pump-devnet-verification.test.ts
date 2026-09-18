import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  PUMP_BONDING_CURVE_DISCRIMINATOR,
  PUMP_SHARING_CONFIG_DISCRIMINATOR,
  bondingCurvePda,
  bytesEqual,
  decodePumpBondingCurve,
  decodePumpSharingConfig,
  encodePumpCreateV2Data,
  encodePumpFeeSharesV2Data,
  feeSharingConfigPda,
} from "./pump-devnet-verification.ts";

const zero = new PublicKey("11111111111111111111111111111111");
const mint = new PublicKey("So11111111111111111111111111111111111111112");
const reward = new PublicKey("SysvarRent111111111111111111111111111111111");
const burn = new PublicKey("Vote111111111111111111111111111111111111111");

test("encodes Pump create_v2 bytes exactly", () => {
  const encoded = encodePumpCreateV2Data({ name: "Name", symbol: "SYM", uri: "uri", creator: zero });
  assert.equal(
    Buffer.from(encoded).toString("hex"),
    "d6904cec5f8b31b4040000004e616d650300000053594d0300000075726900000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  );
});

test("encodes the exact ordered 80/20 Pump fee shares", () => {
  const encoded = encodePumpFeeSharesV2Data([
    { address: reward, shareBps: 8000 },
    { address: burn, shareBps: 2000 },
  ]);
  assert.equal(
    Buffer.from(encoded).toString("hex"),
    "6ffb31064e4e6a120200000006a7d517192c5c51218cc94c3d4af17f58daee089ba1fd44e3dbd98a00000000401f0761481d357474bb7c4d7624ebd3bdb3d8355e73d11043fc0da3538000000000d007",
  );
});

test("derives the official Pump PDAs", () => {
  assert.equal(bondingCurvePda(mint).toBase58(), "6PiyjiAPkp2KdZtqkyQYzVsD1Prv7t8v4TaYd8ip4YFd");
  assert.equal(feeSharingConfigPda(mint).toBase58(), "JByeZXCdfwWAbviYMpqZ1scSuopRtz5DwzcLtQ3bd3uH");
});

test("decodes versioned Pump account prefixes safely", () => {
  const curve = new Uint8Array(125);
  curve.set(PUMP_BONDING_CURVE_DISCRIMINATOR);
  curve.set(reward.toBytes(), 49);
  const decodedCurve = decodePumpBondingCurve(curve);
  assert.equal(decodedCurve.creator.toBase58(), reward.toBase58());
  assert.equal(decodedCurve.isHolderReward, false);

  const config = new Uint8Array(148);
  config.set(PUMP_SHARING_CONFIG_DISCRIMINATOR);
  config[9] = 2;
  config[10] = 1;
  config.set(mint.toBytes(), 11);
  config[75] = 1;
  new DataView(config.buffer).setUint32(76, 2, true);
  config.set(reward.toBytes(), 80);
  new DataView(config.buffer).setUint16(112, 8000, true);
  config.set(burn.toBytes(), 114);
  new DataView(config.buffer).setUint16(146, 2000, true);
  const decodedConfig = decodePumpSharingConfig(config);
  assert.equal(decodedConfig.version, 2);
  assert.equal(decodedConfig.status, 1);
  assert.equal(decodedConfig.adminRevoked, true);
  assert.deepEqual(decodedConfig.shareholders.map(({ address, shareBps }) => [address.toBase58(), shareBps]), [
    [reward.toBase58(), 8000],
    [burn.toBase58(), 2000],
  ]);
  assert.equal(bytesEqual(config.subarray(0, 8), PUMP_SHARING_CONFIG_DISCRIMINATOR), true);
});

test("rejects truncated and over-declared account data", () => {
  assert.throws(() => decodePumpBondingCurve(new Uint8Array(20)));
  const config = new Uint8Array(80);
  config.set(PUMP_SHARING_CONFIG_DISCRIMINATOR);
  new DataView(config.buffer).setUint32(76, 11, true);
  assert.throws(() => decodePumpSharingConfig(config));
});
