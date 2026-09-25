import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey, type Signer, type Umi } from "@metaplex-foundation/umi";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAccount, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, Connection, PublicKey,
  TransactionInstruction, TransactionMessage, VersionedTransaction,
  type BlockhashWithExpiryBlockHeight,
} from "@solana/web3.js";
import { getAddress, padHex } from "viem";
import {
  assertDirectChzOftPeer, DIRECT_CHZ_OFT, validateDirectChzOftFee,
  validateDirectChzOftRequest, type DirectChzOftRequest,
} from "./chiliz-direct-oft.ts";

const CHZ_MINT = new PublicKey(DIRECT_CHZ_OFT.solanaMint);
const CHZ_PROGRAM = new PublicKey(DIRECT_CHZ_OFT.solanaProgram);
const CHZ_STORE = publicKey(DIRECT_CHZ_OFT.solanaStore);
const CHZ_PROGRAM_UMI = publicKey(DIRECT_CHZ_OFT.solanaProgram);
const CHZ_MINT_UMI = publicKey(DIRECT_CHZ_OFT.solanaMint);
const CHZ_ALT = new PublicKey(DIRECT_CHZ_OFT.solanaAddressLookupTable);
const CHZ_ALT_UMI = publicKey(DIRECT_CHZ_OFT.solanaAddressLookupTable);
const DESTINATION_SCALE = 10n ** 10n; // Solana CHZ 8 decimals -> native Chiliz CHZ 18.
const MAX_UNSIGNED_TX_BYTES = 1_232;
const MAX_QUOTE_AGE_MS = 60_000;

type QuoteOftResult = Awaited<ReturnType<typeof oft.quoteOft>>;

export type DirectOftBuildRequest = DirectChzOftRequest & {
  /** 95%-100% of source amount. Defaults to 99% as a canary safety bound. */
  readonly minimumReceiveAtomic?: string;
  readonly nowMs?: number;
};

export type DirectOftBuildSnapshot = {
  readonly storeMint: string;
  readonly storeEscrow: string;
  readonly storePaused: boolean;
  readonly peer: string;
  readonly sourceTokenAccount: string;
  readonly sourceTokenAmountAtomic: string;
  readonly messagingFeeLamports: bigint;
  readonly lzTokenFee: bigint;
  readonly oftQuote: QuoteOftResult;
  readonly options: Uint8Array;
  readonly sendInstruction: TransactionInstruction;
  readonly lookupTable: AddressLookupTableAccount;
  readonly blockhash: BlockhashWithExpiryBlockHeight;
};

export type UnsignedDirectOftChzTransfer = {
  readonly sourceWallet: string;
  readonly sourceMint: typeof DIRECT_CHZ_OFT.solanaMint;
  readonly sourceProgram: typeof DIRECT_CHZ_OFT.solanaProgram;
  readonly sourceStore: typeof DIRECT_CHZ_OFT.solanaStore;
  readonly sourceTokenAccount: string;
  readonly sourceEscrow: string;
  readonly sourceLookupTable: typeof DIRECT_CHZ_OFT.solanaAddressLookupTable;
  readonly destinationTreasury: string;
  readonly destinationEid: typeof DIRECT_CHZ_OFT.chilizEid;
  readonly destinationAdapter: typeof DIRECT_CHZ_OFT.chilizNativeAdapter;
  readonly sourceAmountAtomic: string;
  readonly minimumReceiveAtomic: string;
  readonly quotedReceiveAtomic: string;
  /** Accepted by createDirectOftChilizBridgeJournalInsert after a real signature. */
  readonly minimumDestinationWei: string;
  readonly messagingFeeLamports: string;
  readonly extraOptionsHex: string;
  readonly onchainQuoteDigestSha256: string;
  readonly expectedMessageSha256: string;
  readonly unsignedMessageBase64: string;
  readonly unsignedTransactionBase64: string;
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: number;
  readonly quoteExpiresAtMs: number;
  readonly executionReady: false;
};

export function minimumDirectOftReceiveAtomic(amountAtomic: string, requested?: string): string {
  if (!/^[1-9][0-9]*$/.test(amountAtomic)) throw new Error("Direct OFT source amount is invalid.");
  const amount = BigInt(amountAtomic);
  const minimum = requested === undefined ? amount * 99n / 100n :
    /^[1-9][0-9]*$/.test(requested) ? BigInt(requested) : 0n;
  if (minimum <= 0n || minimum > amount || minimum * 100n < amount * 95n) {
    throw new Error("Direct OFT minimum receive must be within 95%-100% of source amount.");
  }
  return minimum.toString();
}

export function directOftOptions(enforcedSend: Uint8Array): Uint8Array {
  const hasEnforcedReceiveGas = enforcedSend.length > 2 &&
    Options.fromOptions(`0x${Buffer.from(enforcedSend).toString("hex")}`)
      .decodeExecutorLzReceiveOption() !== undefined;
  // Chiliz Bridge publishes 200,000 receive gas for Solana -> Chiliz. Do not
  // duplicate that option when the source OFT already enforces receive gas.
  return hasEnforcedReceiveGas ? new Uint8Array() :
    Options.newOptions().addExecutorLzReceiveOption(200_000, 0).toBytes();
}

function assertQuote(snapshot: DirectOftBuildSnapshot, amount: bigint, minimum: bigint): string {
  const { oftLimits, oftReceipt } = snapshot.oftQuote;
  if (snapshot.storePaused || snapshot.storeMint !== DIRECT_CHZ_OFT.solanaMint ||
      amount > BigInt(snapshot.sourceTokenAmountAtomic) ||
      amount < oftLimits.minAmountLd || amount > oftLimits.maxAmountLd ||
      oftReceipt.amountSentLd !== amount ||
      oftReceipt.amountReceivedLd < minimum ||
      oftReceipt.amountReceivedLd > amount) {
    throw new Error("Direct CHZ OFT source balance, limits, or receive quote is invalid.");
  }
  assertDirectChzOftPeer(snapshot.peer);
  return validateDirectChzOftFee(snapshot.messagingFeeLamports, snapshot.lzTokenFee);
}

/** Re-decode the SDK instruction so destination and amounts cannot drift. */
export function assertExactDirectOftSendInstruction(input: {
  readonly instruction: TransactionInstruction;
  readonly payer: string;
  readonly sourceAta: string;
  readonly escrow: string;
  readonly destination: string;
  readonly amountAtomic: string;
  readonly minimumAtomic: string;
  readonly options: Uint8Array;
  readonly messagingFeeLamports: string;
}): void {
  const ix = input.instruction;
  if (!ix.programId.equals(CHZ_PROGRAM)) throw new Error("Direct OFT send program changed.");
  const decoded = oft.instructions.getSendInstructionDataSerializer().deserialize(ix.data)[0];
  const to = Buffer.from(padHex(getAddress(input.destination), { size: 32 }).slice(2), "hex");
  if (decoded.dstEid !== DIRECT_CHZ_OFT.chilizEid ||
      !Buffer.from(decoded.to).equals(to) ||
      decoded.amountLd !== BigInt(input.amountAtomic) ||
      decoded.minAmountLd !== BigInt(input.minimumAtomic) ||
      decoded.nativeFee !== BigInt(input.messagingFeeLamports) ||
      decoded.lzTokenFee !== 0n ||
      decoded.composeMsg.__option !== "None" ||
      !Buffer.from(decoded.options).equals(Buffer.from(input.options))) {
    throw new Error("Direct OFT send instruction changed destination, amount, fee, or options.");
  }
  const signers = ix.keys.filter((key) => key.isSigner);
  if (signers.length !== 1 || signers[0].pubkey.toBase58() !== input.payer) {
    throw new Error("Direct OFT send requires an unexpected signer.");
  }
  for (const [address, writable] of [
    [input.sourceAta, true], [input.escrow, true],
    [DIRECT_CHZ_OFT.solanaMint, false], [DIRECT_CHZ_OFT.solanaStore, false],
  ] as const) {
    const matches = ix.keys.filter((key) => key.pubkey.toBase58() === address);
    if (matches.length !== 1 || (writable && !matches[0].isWritable)) {
      throw new Error("Direct OFT send changed a pinned token or store account.");
    }
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
}

/** Pure finalizer for mocked snapshots; cannot sign or broadcast. */
export async function buildUnsignedDirectOftFromSnapshot(
  input: DirectOftBuildRequest, snapshot: DirectOftBuildSnapshot,
): Promise<UnsignedDirectOftChzTransfer> {
  const request = validateDirectChzOftRequest(input);
  const amount = BigInt(request.amountAtomic);
  const minimumReceiveAtomic = minimumDirectOftReceiveAtomic(request.amountAtomic, input.minimumReceiveAtomic);
  const minimum = BigInt(minimumReceiveAtomic);
  const expectedAta = getAssociatedTokenAddressSync(CHZ_MINT, new PublicKey(request.payerSolanaWallet), false,
    TOKEN_PROGRAM_ID).toBase58();
  if (snapshot.sourceTokenAccount !== expectedAta || snapshot.storeEscrow === expectedAta ||
      !/^[1-9][0-9]*$/.test(snapshot.sourceTokenAmountAtomic)) {
    throw new Error("Direct OFT source ATA or escrow is invalid.");
  }
  const fee = assertQuote(snapshot, amount, minimum);
  if (!snapshot.lookupTable.key.equals(CHZ_ALT) ||
      snapshot.lookupTable.state.deactivationSlot !== 0xffff_ffff_ffff_ffffn ||
      !Number.isSafeInteger(snapshot.blockhash.lastValidBlockHeight) ||
      snapshot.blockhash.lastValidBlockHeight <= 0) {
    throw new Error("Direct OFT lookup table or blockhash validity is invalid.");
  }
  assertExactDirectOftSendInstruction({
    instruction: snapshot.sendInstruction,
    payer: request.payerSolanaWallet,
    sourceAta: expectedAta,
    escrow: snapshot.storeEscrow,
    destination: request.destinationChilizWallet,
    amountAtomic: request.amountAtomic,
    minimumAtomic: minimumReceiveAtomic,
    options: snapshot.options,
    messagingFeeLamports: fee,
  });
  const message = new TransactionMessage({
    payerKey: new PublicKey(request.payerSolanaWallet),
    recentBlockhash: snapshot.blockhash.blockhash,
    instructions: [snapshot.sendInstruction],
  }).compileToV0Message([snapshot.lookupTable]);
  if (message.header.numRequiredSignatures !== 1 ||
      message.staticAccountKeys[0]?.toBase58() !== request.payerSolanaWallet ||
      message.compiledInstructions.length !== 1 ||
      message.staticAccountKeys[message.compiledInstructions[0].programIdIndex]?.toBase58() !==
        DIRECT_CHZ_OFT.solanaProgram) {
    throw new Error("Direct OFT unsigned message changed payer or program.");
  }
  const transaction = new VersionedTransaction(message);
  const unsignedBytes = transaction.serialize();
  if (unsignedBytes.length > MAX_UNSIGNED_TX_BYTES ||
      transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
    throw new Error("Direct OFT unsigned transaction is oversized or already signed.");
  }
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("Direct OFT quote timestamp is invalid.");
  const quoteSnapshot = JSON.stringify({
    route: "SOLANA_CHZ_TO_NATIVE_CHILIZ_CHZ_OFT",
    sourceMint: DIRECT_CHZ_OFT.solanaMint,
    sourceProgram: DIRECT_CHZ_OFT.solanaProgram,
    sourceStore: DIRECT_CHZ_OFT.solanaStore,
    sourceAta: expectedAta,
    sourceEscrow: snapshot.storeEscrow,
    destinationEid: DIRECT_CHZ_OFT.chilizEid,
    destinationAdapter: DIRECT_CHZ_OFT.chilizNativeAdapter,
    destinationWallet: request.destinationChilizWallet.toLowerCase(),
    sourceAmountAtomic: request.amountAtomic,
    minimumReceiveAtomic,
    quotedReceiveAtomic: snapshot.oftQuote.oftReceipt.amountReceivedLd.toString(),
    messagingFeeLamports: fee,
    optionsHex: Buffer.from(snapshot.options).toString("hex"),
    blockhash: snapshot.blockhash.blockhash,
    lastValidBlockHeight: snapshot.blockhash.lastValidBlockHeight,
  });
  return {
    sourceWallet: request.payerSolanaWallet,
    sourceMint: DIRECT_CHZ_OFT.solanaMint,
    sourceProgram: DIRECT_CHZ_OFT.solanaProgram,
    sourceStore: DIRECT_CHZ_OFT.solanaStore,
    sourceTokenAccount: expectedAta,
    sourceEscrow: snapshot.storeEscrow,
    sourceLookupTable: DIRECT_CHZ_OFT.solanaAddressLookupTable,
    destinationTreasury: request.destinationChilizWallet,
    destinationEid: DIRECT_CHZ_OFT.chilizEid,
    destinationAdapter: DIRECT_CHZ_OFT.chilizNativeAdapter,
    sourceAmountAtomic: request.amountAtomic,
    minimumReceiveAtomic,
    quotedReceiveAtomic: snapshot.oftQuote.oftReceipt.amountReceivedLd.toString(),
    minimumDestinationWei: (minimum * DESTINATION_SCALE).toString(),
    messagingFeeLamports: fee,
    extraOptionsHex: `0x${Buffer.from(snapshot.options).toString("hex")}`,
    onchainQuoteDigestSha256: await sha256Hex(Buffer.from(quoteSnapshot)),
    expectedMessageSha256: await sha256Hex(message.serialize()),
    unsignedMessageBase64: Buffer.from(message.serialize()).toString("base64"),
    unsignedTransactionBase64: Buffer.from(unsignedBytes).toString("base64"),
    recentBlockhash: snapshot.blockhash.blockhash,
    lastValidBlockHeight: snapshot.blockhash.lastValidBlockHeight,
    quoteExpiresAtMs: nowMs + MAX_QUOTE_AGE_MS,
    executionReady: false,
  };
}

function neverSign(payer: string): Signer {
  const deny = async (): Promise<never> => { throw new Error("Direct OFT builder cannot sign."); };
  return {
    publicKey: publicKey(payer),
    signMessage: deny,
    signTransaction: deny,
    signAllTransactions: deny,
  };
}

function web3Instruction(umiInstruction: Awaited<ReturnType<typeof oft.send>>): TransactionInstruction {
  if (umiInstruction.signers.length !== 1 ||
      umiInstruction.signers[0].publicKey !== umiInstruction.instruction.keys.find((key) => key.isSigner)?.pubkey) {
    throw new Error("Direct OFT SDK instruction introduced an unexpected signer.");
  }
  return new TransactionInstruction({
    programId: new PublicKey(umiInstruction.instruction.programId),
    keys: umiInstruction.instruction.keys.map((key) => ({
      pubkey: new PublicKey(key.pubkey), isSigner: key.isSigner, isWritable: key.isWritable,
    })),
    data: Buffer.from(umiInstruction.instruction.data),
  });
}

/** Actual on-chain OFT quote + unsigned source transaction preparation. */
export async function buildUnsignedDirectOftChzTransfer(
  input: DirectOftBuildRequest,
): Promise<UnsignedDirectOftChzTransfer> {
  const request = validateDirectChzOftRequest(input);
  const minimumReceiveAtomic = minimumDirectOftReceiveAtomic(request.amountAtomic, input.minimumReceiveAtomic);
  const connection = new Connection(request.solanaRpcUrl, "confirmed");
  const umi: Umi = createUmi(request.solanaRpcUrl);
  const store = await oft.accounts.fetchOFTStore(umi, CHZ_STORE);
  const peer = await oft.getPeerAddress(umi.rpc, CHZ_STORE, DIRECT_CHZ_OFT.chilizEid, CHZ_PROGRAM_UMI);
  assertDirectChzOftPeer(peer);
  const enforced = await oft.getEnforcedOptions(umi.rpc, CHZ_STORE, DIRECT_CHZ_OFT.chilizEid,
    CHZ_PROGRAM_UMI);
  const options = directOftOptions(enforced.send);
  const payer = new PublicKey(request.payerSolanaWallet);
  const sourceAta = getAssociatedTokenAddressSync(CHZ_MINT, payer, false, TOKEN_PROGRAM_ID);
  const [mint, tokenAccount, payerLamports, altInfo, latest] = await Promise.all([
    getMint(connection, CHZ_MINT, "confirmed", TOKEN_PROGRAM_ID),
    getAccount(connection, sourceAta, "confirmed", TOKEN_PROGRAM_ID),
    connection.getBalance(payer, "confirmed"),
    connection.getAccountInfo(CHZ_ALT, "confirmed"),
    connection.getLatestBlockhash("confirmed"),
  ]);
  if (mint.decimals !== DIRECT_CHZ_OFT.solanaDecimals ||
      !tokenAccount.owner.equals(payer) || !tokenAccount.mint.equals(CHZ_MINT) ||
      payerLamports <= 0 || !altInfo?.owner.equals(AddressLookupTableProgram.programId)) {
    throw new Error("Direct OFT payer, CHZ mint, ATA, or lookup table failed on-chain checks.");
  }
  const lookupTable = new AddressLookupTableAccount({
    key: CHZ_ALT, state: AddressLookupTableAccount.deserialize(altInfo.data),
  });
  const to = Buffer.from(padHex(getAddress(request.destinationChilizWallet), { size: 32 }).slice(2), "hex");
  const accounts = {
    payer: publicKey(request.payerSolanaWallet), tokenMint: CHZ_MINT_UMI, tokenEscrow: store.tokenEscrow,
  };
  const quoteParams = {
    dstEid: DIRECT_CHZ_OFT.chilizEid,
    to,
    amountLd: BigInt(request.amountAtomic),
    minAmountLd: BigInt(minimumReceiveAtomic),
    options,
    payInLzToken: false,
    composeMsg: undefined,
  };
  const oftQuote = await oft.quoteOft(umi.rpc, accounts, quoteParams, CHZ_PROGRAM_UMI);
  const messaging = await oft.quote(umi.rpc, accounts, quoteParams, { oft: CHZ_PROGRAM_UMI }, [],
    [CHZ_ALT_UMI]);
  const fee = validateDirectChzOftFee(messaging.nativeFee, messaging.lzTokenFee);
  if (payerLamports < messaging.nativeFee) {
    throw new Error("Direct OFT payer lacks SOL for the quoted bridge messaging fee.");
  }
  const send = await oft.send(
    umi.rpc,
    { payer: neverSign(request.payerSolanaWallet), tokenMint: CHZ_MINT_UMI,
      tokenEscrow: store.tokenEscrow, tokenSource: publicKey(sourceAta.toBase58()) },
    { ...quoteParams, nativeFee: messaging.nativeFee, lzTokenFee: 0n },
    { oft: CHZ_PROGRAM_UMI, token: publicKey(TOKEN_PROGRAM_ID.toBase58()) },
  );
  return buildUnsignedDirectOftFromSnapshot(input, {
    storeMint: store.tokenMint,
    storeEscrow: store.tokenEscrow,
    storePaused: store.paused,
    peer,
    sourceTokenAccount: sourceAta.toBase58(),
    sourceTokenAmountAtomic: tokenAccount.amount.toString(),
    messagingFeeLamports: BigInt(fee),
    lzTokenFee: messaging.lzTokenFee,
    oftQuote,
    options,
    sendInstruction: web3Instruction(send),
    lookupTable,
    blockhash: latest,
  });
}
