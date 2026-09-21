import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  type TransactionResponse,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { env } from "cloudflare:workers";

import {
  REWARD_FEE_BPS,
  SPORTPAD_FEE_BPS,
  classifyUnindexedDevnetTransaction,
} from "@/lib/protocol/devnet-launch";
import {
  PUMP_CREATE_FEE_CONFIG_DISCRIMINATOR,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  bondingCurvePda,
  bytesEqual,
  decodePumpBondingCurve,
  decodePumpSharingConfig,
  encodePumpCreateV2Data,
  encodePumpFeeSharesV2Data,
  feeSharingConfigPda,
} from "@/lib/protocol/pump-devnet-verification";

function rpcUrl() {
  return env.HELIUS_API_KEY
    ? `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`
    : "https://api.devnet.solana.com";
}

function mainnetRpcUrl() {
  return env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`
    : "https://api.mainnet-beta.solana.com";
}

export function getDevnetConnection() {
  return new Connection(rpcUrl(), { commitment: "confirmed", confirmTransactionInitialTimeout: 45_000 });
}

export function getMainnetConnection() {
  return new Connection(mainnetRpcUrl(), { commitment: "confirmed", confirmTransactionInitialTimeout: 45_000 });
}

type SubmissionWindow = {
  blockhash: string;
  lastValidBlockHeight: number;
};

export async function validateDevnetSubmissionWindow({
  blockhash,
  lastValidBlockHeight,
}: SubmissionWindow) {
  const connection = getDevnetConnection();
  const [validity, currentBlockHeight] = await Promise.all([
    connection.isBlockhashValid(blockhash, { commitment: "confirmed" }),
    connection.getBlockHeight("confirmed"),
  ]);
  return validity.value &&
    lastValidBlockHeight >= currentBlockHeight &&
    lastValidBlockHeight <= currentBlockHeight + 300;
}

export async function validateMainnetSubmissionWindow({
  blockhash,
  lastValidBlockHeight,
}: SubmissionWindow) {
  const connection = getMainnetConnection();
  const [validity, currentBlockHeight] = await Promise.all([
    connection.isBlockhashValid(blockhash, { commitment: "confirmed" }),
    connection.getBlockHeight("confirmed"),
  ]);
  return validity.value &&
    lastValidBlockHeight >= currentBlockHeight &&
    lastValidBlockHeight <= currentBlockHeight + 300;
}

type AnyTransactionResponse = TransactionResponse | VersionedTransactionResponse;

function transactionKeys(transaction: AnyTransactionResponse) {
  const message = transaction.transaction.message as unknown as {
    accountKeys?: PublicKey[];
    staticAccountKeys?: PublicKey[];
    isAccountSigner?: (index: number) => boolean;
  };
  return {
    keys: message.accountKeys ?? message.staticAccountKeys ?? [],
    isSigner: (index: number) => message.isAccountSigner?.(index) ?? false,
  };
}

function transactionBlockhash(transaction: AnyTransactionResponse) {
  return (transaction.transaction.message as unknown as { recentBlockhash?: string }).recentBlockhash ?? null;
}

type NormalizedInstruction = {
  programId: PublicKey;
  keys: PublicKey[];
  data: Uint8Array;
};

function transactionInstructions(transaction: AnyTransactionResponse): NormalizedInstruction[] {
  const message = transaction.transaction.message as unknown as {
    accountKeys?: PublicKey[];
    staticAccountKeys?: PublicKey[];
    instructions?: Array<{ programIdIndex: number; accounts: number[]; data: string | Uint8Array }>;
    compiledInstructions?: Array<{ programIdIndex: number; accountKeyIndexes: number[]; data: Uint8Array }>;
  };
  const loaded = transaction.meta?.loadedAddresses;
  const keys = [
    ...(message.accountKeys ?? message.staticAccountKeys ?? []),
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ];
  const instructions = message.instructions ?? message.compiledInstructions ?? [];
  return instructions.map((instruction) => {
    const indexes = "accounts" in instruction ? instruction.accounts : instruction.accountKeyIndexes;
    return {
      programId: keys[instruction.programIdIndex],
      keys: indexes.map((index) => keys[index]),
      data: typeof instruction.data === "string" ? bs58.decode(instruction.data) : Uint8Array.from(instruction.data),
    };
  });
}

function isExactComputeLimit(instruction: NormalizedInstruction | undefined, units: number) {
  const expected = ComputeBudgetProgram.setComputeUnitLimit({ units });
  return Boolean(
    instruction &&
    instruction.programId.equals(expected.programId) &&
    instruction.keys.length === 0 &&
    bytesEqual(instruction.data, expected.data),
  );
}

export type DevnetTransactionState = "pending" | "failed" | "expired";

export class DevnetTransactionStateError extends Error {
  constructor(
    public readonly txState: DevnetTransactionState,
    message: string,
    public readonly blockhashInvalid = false,
  ) {
    super(message);
    this.name = "DevnetTransactionStateError";
  }
}

export function isDevnetTransactionStateError(error: unknown): error is DevnetTransactionStateError {
  return error instanceof DevnetTransactionStateError;
}

type SubmissionContext = SubmissionWindow & {
  invalidBlockhashObservedAt: number | null;
};

const INVALID_BLOCKHASH_GRACE_MS = 30_000;

async function finalizedTransaction(
  connection: Connection,
  signature: string,
  submission: SubmissionContext,
) {
  let transaction = await connection.getTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction) {
    const signatureStatus = await connection.getSignatureStatuses(
      [signature],
      { searchTransactionHistory: true },
    );
    if (signatureStatus.value[0]?.err) {
      throw new DevnetTransactionStateError("failed", "The transaction failed.");
    }
    if (signatureStatus.value[0]) {
      throw new DevnetTransactionStateError("pending", "The transaction is not finalized yet.");
    }

    const blockhashValidity = await connection.isBlockhashValid(
      submission.blockhash,
      { commitment: "confirmed" },
    );
    if (blockhashValidity.value) {
      throw new DevnetTransactionStateError("pending", "The transaction is not finalized yet.");
    }

    // Invalidity is only a candidate for expiry. Re-read after observing it so
    // a transaction included at the edge of the blockhash window cannot be
    // replaced from an earlier status sample.
    transaction = await connection.getTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction) {
      // Continue into the same instruction and account verification below.
    } else {
      const finalStatus = await connection.getSignatureStatuses(
        [signature],
        { searchTransactionHistory: true },
      );
      const invalidityGraceElapsed = submission.invalidBlockhashObservedAt !== null &&
        Date.now() - submission.invalidBlockhashObservedAt >= INVALID_BLOCKHASH_GRACE_MS;
      const state = classifyUnindexedDevnetTransaction({
        signatureStatus: finalStatus.value[0],
        blockhashValid: false,
        invalidityGraceElapsed,
      });
      if (state === "failed") {
        throw new DevnetTransactionStateError("failed", "The transaction failed.");
      }
      if (state === "expired") {
        throw new DevnetTransactionStateError("expired", "The transaction expired before finalization.");
      }
      throw new DevnetTransactionStateError(
        "pending",
        "The blockhash expired. SportPad is waiting for a final indexing check before allowing a retry.",
        true,
      );
    }
  }
  if (transaction.meta?.err) {
    throw new DevnetTransactionStateError("failed", "The transaction failed.");
  }
  if (transactionBlockhash(transaction) !== submission.blockhash) {
    throw new DevnetTransactionStateError("failed", "The transaction blockhash does not match the submitted launch.");
  }
  return transaction;
}

export async function verifyPumpDevnetCreate({
  signature,
  mintAddress,
  creatorWallet,
  name,
  symbol,
  metadataUri,
  blockhash,
  lastValidBlockHeight,
  invalidBlockhashObservedAt,
  connectionOverride,
}: {
  signature: string;
  mintAddress: string;
  creatorWallet: string;
  name: string;
  symbol: string;
  metadataUri: string;
  blockhash: string;
  lastValidBlockHeight: number;
  invalidBlockhashObservedAt: number | null;
  connectionOverride?: Connection;
}) {
  const connection = connectionOverride ?? getDevnetConnection();
  const transaction = await finalizedTransaction(connection, signature, {
    blockhash,
    lastValidBlockHeight,
    invalidBlockhashObservedAt,
  });
  const mint = new PublicKey(mintAddress);
  const creator = new PublicKey(creatorWallet);
  const instructions = transactionInstructions(transaction);
  const expectedData = encodePumpCreateV2Data({
    name, symbol, uri: metadataUri, creator,
  });
  const create = instructions[1];
  if (
    instructions.length !== 2 ||
    !isExactComputeLimit(instructions[0], 320_000) ||
    !create?.programId.equals(PUMP_PROGRAM_ID) ||
    !bytesEqual(create.data, expectedData) ||
    !create.keys[0]?.equals(mint) ||
    !create.keys[2]?.equals(bondingCurvePda(mint)) ||
    !create.keys[5]?.equals(creator)
  ) {
    throw new Error("The finalized transaction instructions do not match the reviewed SportPad coin creation.");
  }
  const { keys, isSigner } = transactionKeys(transaction);
  const creatorIndex = keys.findIndex((key) => key.equals(creator));
  const mintIndex = keys.findIndex((key) => key.equals(mint));
  if (creatorIndex < 0 || !isSigner(creatorIndex) || mintIndex < 0 || !isSigner(mintIndex)) {
    throw new Error("The finalized transaction does not contain the expected creator and mint signers.");
  }
  if (!keys.some((key) => key.equals(PUMP_PROGRAM_ID))) {
    throw new Error("The finalized transaction is not a Pump coin creation.");
  }
  const [mintInfo, curveInfo] = await connection.getMultipleAccountsInfo([
    mint,
    bondingCurvePda(mint),
  ], "finalized");
  if (!mintInfo || !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("The mint is not owned by the expected Token-2022 program.");
  }
  if (!curveInfo || !curveInfo.owner.equals(PUMP_PROGRAM_ID)) {
    throw new Error("The Pump bonding curve could not be verified onchain.");
  }
  const curve = decodePumpBondingCurve(curveInfo.data);
  if (
    !curve.creator.equals(creator) ||
    curve.isMayhemMode ||
    curve.isCashbackCoin ||
    curve.isHolderReward ||
    !curve.quoteMint.equals(PublicKey.default)
  ) {
    throw new Error("The Pump creator configuration does not match this SportPad launch.");
  }
  return { slot: transaction.slot };
}

export async function verifyPumpDevnetFeeSplit({
  signature,
  mintAddress,
  creatorWallet,
  rewardWallet,
  burnWallet,
  blockhash,
  lastValidBlockHeight,
  invalidBlockhashObservedAt,
  connectionOverride,
}: {
  signature: string;
  mintAddress: string;
  creatorWallet: string;
  rewardWallet: string;
  burnWallet: string;
  blockhash: string;
  lastValidBlockHeight: number;
  invalidBlockhashObservedAt: number | null;
  connectionOverride?: Connection;
}) {
  const connection = connectionOverride ?? getDevnetConnection();
  const transaction = await finalizedTransaction(connection, signature, {
    blockhash,
    lastValidBlockHeight,
    invalidBlockhashObservedAt,
  });
  const mint = new PublicKey(mintAddress);
  const creator = new PublicKey(creatorWallet);
  const reward = new PublicKey(rewardWallet);
  const burn = new PublicKey(burnWallet);
  const configPda = feeSharingConfigPda(mint);
  const instructions = transactionInstructions(transaction);
  const createConfig = instructions[1];
  const updateShares = instructions[2];
  const expectedShares = encodePumpFeeSharesV2Data([
    { address: reward, shareBps: REWARD_FEE_BPS },
    { address: burn, shareBps: SPORTPAD_FEE_BPS },
  ]);
  if (
    instructions.length !== 3 ||
    !isExactComputeLimit(instructions[0], 450_000) ||
    !createConfig?.programId.equals(PUMP_FEE_PROGRAM_ID) ||
    !bytesEqual(createConfig.data, PUMP_CREATE_FEE_CONFIG_DISCRIMINATOR) ||
    !createConfig.keys[2]?.equals(creator) ||
    !createConfig.keys[4]?.equals(mint) ||
    !createConfig.keys[5]?.equals(configPda) ||
    !updateShares?.programId.equals(PUMP_FEE_PROGRAM_ID) ||
    !bytesEqual(updateShares.data, expectedShares) ||
    !updateShares.keys[2]?.equals(creator) ||
    !updateShares.keys[4]?.equals(mint) ||
    !updateShares.keys[5]?.equals(configPda)
  ) {
    throw new Error("The finalized transaction instructions do not match the reviewed SportPad 80/20 fee lock.");
  }
  const { keys, isSigner } = transactionKeys(transaction);
  const creatorIndex = keys.findIndex((key) => key.equals(creator));
  if (creatorIndex < 0 || !isSigner(creatorIndex) || !keys.some((key) => key.equals(PUMP_FEE_PROGRAM_ID))) {
    throw new Error("The finalized transaction is not the expected Pump fee-sharing update.");
  }
  const configInfo = await connection.getAccountInfo(configPda, "finalized");
  if (!configInfo || !configInfo.owner.equals(PUMP_FEE_PROGRAM_ID)) {
    throw new Error("The Pump fee-sharing configuration is missing.");
  }
  const config = decodePumpSharingConfig(configInfo.data);
  const shareholders = new Map(config.shareholders.map((shareholder) => [
    shareholder.address.toBase58(),
    shareholder.shareBps,
  ]));
  if (
    !config.mint.equals(mint) ||
    config.version !== 2 ||
    config.status !== 1 ||
    !config.adminRevoked ||
    config.shareholders.length !== 2 ||
    shareholders.get(rewardWallet) !== REWARD_FEE_BPS ||
    shareholders.get(burnWallet) !== SPORTPAD_FEE_BPS
  ) {
    throw new Error("The immutable Pump fee split does not match the required 80/20 recipients.");
  }
  return { slot: transaction.slot, sharingConfig: configPda.toBase58() };
}

type VerifyCreateInput = Omit<Parameters<typeof verifyPumpDevnetCreate>[0], "connectionOverride">;
type VerifyFeeSplitInput = Omit<Parameters<typeof verifyPumpDevnetFeeSplit>[0], "connectionOverride">;

export function verifyPumpMainnetCreate(input: VerifyCreateInput) {
  return verifyPumpDevnetCreate({ ...input, connectionOverride: getMainnetConnection() });
}

export function verifyPumpMainnetFeeSplit(input: VerifyFeeSplitInput) {
  return verifyPumpDevnetFeeSplit({ ...input, connectionOverride: getMainnetConnection() });
}
