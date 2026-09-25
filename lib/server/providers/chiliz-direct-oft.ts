import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { PublicKey } from "@solana/web3.js";
import { getAddress, isAddress, padHex } from "viem";

/**
 * Official Chiliz Bridge mainnet CHZ mesh, as published by
 * https://bridge.chilizchain.com/ and verified against Solana accounts.
 * The Solana CHZ mint uses 8 decimals; native Chiliz CHZ uses 18.
 *
 * This module only reads on-chain OFT configuration and quotes the LayerZero
 * messaging fee. It never builds, signs, simulates, or broadcasts a transfer.
 */
export const DIRECT_CHZ_OFT = Object.freeze({
  solanaMint: "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw",
  solanaProgram: "BcRpUE1jvLvgchaYntfi2weReWVG8THCRLFy73CmxjHo",
  solanaStore: "9SBbd5mXvCimWXpggkE8PJpXMjBddDhWWZY1eW1BhvUF",
  solanaAddressLookupTable: "AokBxha6VMLLgf97B5VYHEtqztamWmYERBmmFvjuTzJB",
  chilizEid: 30409,
  chilizNativeAdapter: "0xcdE3D1879b81b45c3aA35779C6ceB7E8B6526b4f",
  solanaDecimals: 8,
  maximumCanaryAmountAtomic: "1000000000", // 10 CHZ
  maximumQuotedFeeLamports: "50000000", // 0.05 SOL, a quote guard only
  executionReady: false,
} as const);

const CHILIZ_PEER_BYTES32 = padHex(DIRECT_CHZ_OFT.chilizNativeAdapter, { size: 32 }).toLowerCase();
const SOLANA_MINT = publicKey(DIRECT_CHZ_OFT.solanaMint);
const SOLANA_PROGRAM = publicKey(DIRECT_CHZ_OFT.solanaProgram);
const SOLANA_STORE = publicKey(DIRECT_CHZ_OFT.solanaStore);
const SOLANA_ADDRESS_LOOKUP_TABLE = publicKey(DIRECT_CHZ_OFT.solanaAddressLookupTable);

export type DirectChzOftRequest = {
  readonly amountAtomic: string;
  readonly payerSolanaWallet: string;
  readonly destinationChilizWallet: string;
  readonly solanaRpcUrl: string;
};

export type DirectChzOftQuote = {
  readonly sourceMint: typeof DIRECT_CHZ_OFT.solanaMint;
  readonly sourceProgram: typeof DIRECT_CHZ_OFT.solanaProgram;
  readonly sourceStore: typeof DIRECT_CHZ_OFT.solanaStore;
  readonly sourceAddressLookupTable: typeof DIRECT_CHZ_OFT.solanaAddressLookupTable;
  readonly destinationEid: typeof DIRECT_CHZ_OFT.chilizEid;
  readonly destinationAdapter: typeof DIRECT_CHZ_OFT.chilizNativeAdapter;
  readonly amountAtomic: string;
  readonly payerSolanaWallet: string;
  readonly destinationChilizWallet: string;
  readonly messagingFeeLamports: string;
  readonly quotedAt: string;
  /** A fee quote does not prove a send, destination receipt, or funded inventory. */
  readonly executionReady: false;
};

export function validateDirectChzOftRequest(input: DirectChzOftRequest): DirectChzOftRequest {
  if (!/^[1-9][0-9]*$/.test(input.amountAtomic) ||
      BigInt(input.amountAtomic) > BigInt(DIRECT_CHZ_OFT.maximumCanaryAmountAtomic)) {
    throw new Error("Direct CHZ OFT quote must be a positive amount no greater than ten CHZ.");
  }
  let payer: string;
  try {
    payer = new PublicKey(input.payerSolanaWallet).toBase58();
    if (payer !== input.payerSolanaWallet || !PublicKey.isOnCurve(new PublicKey(payer))) {
      throw new Error("invalid payer");
    }
  } catch {
    throw new Error("A canonical on-curve Solana payer address is required.");
  }
  if (!isAddress(input.destinationChilizWallet)) {
    throw new Error("A valid Chiliz EVM treasury address is required.");
  }
  let rpc: URL;
  try { rpc = new URL(input.solanaRpcUrl); }
  catch { throw new Error("A valid HTTPS Solana RPC URL is required."); }
  if (rpc.protocol !== "https:" || !rpc.hostname || rpc.username || rpc.password || rpc.hash) {
    throw new Error("A valid HTTPS Solana RPC URL is required.");
  }
  return {
    amountAtomic: input.amountAtomic,
    payerSolanaWallet: payer,
    destinationChilizWallet: getAddress(input.destinationChilizWallet),
    solanaRpcUrl: rpc.toString(),
  };
}

export function assertDirectChzOftPeer(peer: string): void {
  const normalized = peer.startsWith("0x") ? peer.toLowerCase() : `0x${peer.toLowerCase()}`;
  if (normalized !== CHILIZ_PEER_BYTES32) {
    throw new Error("On-chain CHZ OFT peer differs from Chiliz's published native adapter.");
  }
}

export function validateDirectChzOftFee(nativeFee: bigint, lzTokenFee: bigint): string {
  if (nativeFee <= 0n || nativeFee > BigInt(DIRECT_CHZ_OFT.maximumQuotedFeeLamports) || lzTokenFee !== 0n) {
    throw new Error("Direct CHZ OFT messaging fee is missing, non-native, or above the canary cap.");
  }
  return nativeFee.toString();
}

/**
 * Get a fresh permissionless quote directly from the deployed Solana OFT. The
 * SDK reads the Solana endpoint on-chain; no LayerZero Value Transfer API key
 * is required. The result is intentionally not transaction-ready.
 */
export async function quoteDirectChzOft(input: DirectChzOftRequest): Promise<DirectChzOftQuote> {
  const request = validateDirectChzOftRequest(input);
  const umi = createUmi(request.solanaRpcUrl);
  const store = await oft.accounts.fetchOFTStore(umi, SOLANA_STORE);
  if (store.tokenMint !== SOLANA_MINT || store.paused) {
    throw new Error("On-chain Solana CHZ OFT store changed mint or is paused.");
  }
  assertDirectChzOftPeer(
    await oft.getPeerAddress(umi.rpc, SOLANA_STORE, DIRECT_CHZ_OFT.chilizEid, SOLANA_PROGRAM),
  );
  const enforced = await oft.getEnforcedOptions(
    umi.rpc, SOLANA_STORE, DIRECT_CHZ_OFT.chilizEid, SOLANA_PROGRAM,
  );
  const enforcedHasReceiveGas = enforced.send.length > 2 &&
    Options.fromOptions(`0x${Buffer.from(enforced.send).toString("hex")}`)
      .decodeExecutorLzReceiveOption() !== undefined;
  // Add receive gas only when it is not already enforced by the CHZ OFT. A
  // duplicate extra option would make users pay twice for the same gas.
  // The official Chiliz Bridge currently quotes 200,000 destination gas for
  // Solana -> EVM. Keep its ALT and options aligned with that public route.
  const extraOptions = enforcedHasReceiveGas ? undefined :
    Options.newOptions().addExecutorLzReceiveOption(200_000, 0).toBytes();
  const quote = await oft.quote(
    umi.rpc,
    {
      payer: publicKey(request.payerSolanaWallet),
      tokenMint: SOLANA_MINT,
      tokenEscrow: store.tokenEscrow,
    },
    {
      payInLzToken: false,
      to: Buffer.from(padHex(getAddress(request.destinationChilizWallet), { size: 32 }).slice(2), "hex"),
      dstEid: DIRECT_CHZ_OFT.chilizEid,
      amountLd: BigInt(request.amountAtomic),
      minAmountLd: BigInt(request.amountAtomic),
      options: extraOptions,
      composeMsg: undefined,
    },
    { oft: SOLANA_PROGRAM },
    [],
    [SOLANA_ADDRESS_LOOKUP_TABLE],
  );
  return {
    sourceMint: DIRECT_CHZ_OFT.solanaMint,
    sourceProgram: DIRECT_CHZ_OFT.solanaProgram,
    sourceStore: DIRECT_CHZ_OFT.solanaStore,
    sourceAddressLookupTable: DIRECT_CHZ_OFT.solanaAddressLookupTable,
    destinationEid: DIRECT_CHZ_OFT.chilizEid,
    destinationAdapter: DIRECT_CHZ_OFT.chilizNativeAdapter,
    amountAtomic: request.amountAtomic,
    payerSolanaWallet: request.payerSolanaWallet,
    destinationChilizWallet: request.destinationChilizWallet,
    messagingFeeLamports: validateDirectChzOftFee(quote.nativeFee, quote.lzTokenFee),
    quotedAt: new Date().toISOString(),
    executionReady: false,
  };
}
