import { PublicKey } from "@solana/web3.js";

export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_FEE_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export const PUMP_CREATE_V2_DISCRIMINATOR = Uint8Array.from([214, 144, 76, 236, 95, 139, 49, 180]);
export const PUMP_CREATE_FEE_CONFIG_DISCRIMINATOR = Uint8Array.from([195, 78, 86, 76, 111, 52, 251, 213]);
export const PUMP_UPDATE_FEE_SHARES_V2_DISCRIMINATOR = Uint8Array.from([111, 251, 49, 6, 78, 78, 106, 18]);
export const PUMP_BONDING_CURVE_DISCRIMINATOR = Uint8Array.from([23, 183, 248, 55, 96, 216, 172, 96]);
export const PUMP_SHARING_CONFIG_DISCRIMINATOR = Uint8Array.from([216, 74, 9, 0, 56, 140, 93, 75]);

const textEncoder = new TextEncoder();

function concatenate(parts: Uint8Array[]) {
  const total = parts.reduce((length, part) => length + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function borshString(value: string) {
  const bytes = textEncoder.encode(value);
  return concatenate([u32(bytes.length), bytes]);
}

export function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function encodePumpCreateV2Data({
  name,
  symbol,
  uri,
  creator,
}: {
  name: string;
  symbol: string;
  uri: string;
  creator: PublicKey;
}) {
  return concatenate([
    PUMP_CREATE_V2_DISCRIMINATOR,
    borshString(name),
    borshString(symbol),
    borshString(uri),
    creator.toBytes(),
    Uint8Array.of(0), // is_mayhem_mode
    Uint8Array.of(0), // OptionBool(false): cashback
    new Uint8Array(8), // OptionU64(0): creator fee override
    Uint8Array.of(0), // OptionBool(false): holder rewards
  ]);
}

export function encodePumpFeeSharesV2Data(shareholders: Array<{ address: PublicKey; shareBps: number }>) {
  return concatenate([
    PUMP_UPDATE_FEE_SHARES_V2_DISCRIMINATOR,
    u32(shareholders.length),
    ...shareholders.flatMap((shareholder) => [shareholder.address.toBytes(), u16(shareholder.shareBps)]),
  ]);
}

export function bondingCurvePda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("bonding-curve"), mint.toBytes()],
    PUMP_PROGRAM_ID,
  )[0];
}

export function feeSharingConfigPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("sharing-config"), mint.toBytes()],
    PUMP_FEE_PROGRAM_ID,
  )[0];
}

function requireDiscriminator(data: Uint8Array, discriminator: Uint8Array, accountName: string) {
  if (data.length < discriminator.length || !bytesEqual(data.subarray(0, discriminator.length), discriminator)) {
    throw new Error(`The ${accountName} account discriminator is invalid.`);
  }
}

export function decodePumpBondingCurve(data: Uint8Array) {
  requireDiscriminator(data, PUMP_BONDING_CURVE_DISCRIMINATOR, "Pump bonding curve");
  if (data.length < 83) throw new Error("The Pump bonding curve account is incomplete.");
  return {
    creator: new PublicKey(data.slice(49, 81)),
    isMayhemMode: data[81] === 1,
    isCashbackCoin: data[82] === 1,
    quoteMint: data.length >= 115 ? new PublicKey(data.slice(83, 115)) : PublicKey.default,
    isHolderReward: data.length >= 125 ? data[124] === 1 : false,
  };
}

export function decodePumpSharingConfig(data: Uint8Array) {
  requireDiscriminator(data, PUMP_SHARING_CONFIG_DISCRIMINATOR, "Pump fee-sharing configuration");
  if (data.length < 80) throw new Error("The Pump fee-sharing configuration is incomplete.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const shareholderCount = view.getUint32(76, true);
  if (shareholderCount > 10 || 80 + shareholderCount * 34 > data.length) {
    throw new Error("The Pump fee-sharing shareholder list is invalid.");
  }
  const shareholders = Array.from({ length: shareholderCount }, (_, index) => {
    const offset = 80 + index * 34;
    return {
      address: new PublicKey(data.slice(offset, offset + 32)),
      shareBps: view.getUint16(offset + 32, true),
    };
  });
  return {
    bump: data[8],
    version: data[9],
    status: data[10],
    mint: new PublicKey(data.slice(11, 43)),
    admin: new PublicKey(data.slice(43, 75)),
    adminRevoked: data[75] === 1,
    shareholders,
  };
}
