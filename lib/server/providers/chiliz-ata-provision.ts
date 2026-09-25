import {
  ACCOUNT_SIZE, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, unpackMint,
} from "@solana/spl-token";
import {
  PublicKey, SystemProgram, TransactionMessage, VersionedTransaction,
  type Connection, type MessageV0,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";

const CHZ_MINT = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const MAX_ATA_RENT_LAMPORTS = 2_500_000n;
const MAX_NETWORK_FEE_LAMPORTS = 50_000n;
const MIN_REMAINING_SOL_LAMPORTS = 5_000_000n;
const MAX_UNSIGNED_BYTES = 1_232;

export type ChzAtaProvisionReadConnection = Pick<Connection,
  "getMultipleAccountsInfoAndContext" | "getMinimumBalanceForRentExemption" |
  "getLatestBlockhashAndContext" | "getFeeForMessage" | "getBlockHeight">;

export type UnsignedOfficialChzAtaProvision = {
  readonly rewardTreasury: string;
  readonly officialChzMint: string;
  readonly tokenProgram: string;
  readonly outputAta: string;
  readonly ataRentLamports: string;
  readonly estimatedNetworkFeeLamports: string;
  readonly maximumSetupSpendLamports: string;
  readonly minimumRemainingSolLamports: string;
  readonly sourceBalanceLamports: string;
  readonly accountSlot: number;
  readonly blockhashSlot: number;
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: number;
  readonly unsignedTransactionBase64: string;
  readonly transactionMessageHash: string;
  readonly executionReady: false;
};

function fail(code: string): never { throw new Error(`chz_ata_provision_${code}`); }

async function sha256Hex(message: MessageV0): Promise<string> {
  const bytes = new Uint8Array(message.serialize());
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

/**
 * Plan the one-time ATA setup for the *configured* reward treasury, not a
 * fee-backed swap. Caller supplies only its public address, never a key.
 * This builds no signer, performs no broadcast and does not authorize spend.
 */
export async function prepareUnsignedOfficialChzAtaProvision(input: {
  configuredRewardTreasury: string;
  connection: ChzAtaProvisionReadConnection;
}): Promise<UnsignedOfficialChzAtaProvision> {
  const rawTreasury = input.configuredRewardTreasury;
  let treasury: PublicKey;
  try { treasury = new PublicKey(rawTreasury); }
  catch { return fail("reward_treasury_invalid"); }
  if (treasury.toBase58() !== rawTreasury || !PublicKey.isOnCurve(treasury.toBytes())) {
    fail("reward_treasury_not_canonical_wallet");
  }
  const ata = getAssociatedTokenAddressSync(CHZ_MINT, treasury, false, TOKEN_PROGRAM_ID);
  const accountSnapshot = await input.connection.getMultipleAccountsInfoAndContext(
    [treasury, CHZ_MINT, ata], "finalized",
  );
  if (!Number.isSafeInteger(accountSnapshot.context.slot) || accountSnapshot.context.slot <= 0 ||
      accountSnapshot.value.length !== 3) fail("account_snapshot_invalid");
  const [treasuryInfo, mintInfo, ataInfo] = accountSnapshot.value;
  if (!treasuryInfo || treasuryInfo.executable ||
      !treasuryInfo.owner.equals(SystemProgram.programId) || treasuryInfo.data.length !== 0) {
    fail("reward_treasury_account_invalid");
  }
  if (!mintInfo || mintInfo.executable || !mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    fail("official_chz_mint_owner_invalid");
  }
  const mint = unpackMint(CHZ_MINT, mintInfo, TOKEN_PROGRAM_ID);
  if (!mint.isInitialized || mint.decimals !== 8) fail("official_chz_mint_invalid");
  if (ataInfo !== null) fail("official_chz_ata_already_exists_or_occupied");

  const rent = input.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "finalized");
  // Finalized account reads and blockhash reads can hit different RPC backends.
  // Require the blockhash backend to have reached the account snapshot slot,
  // rather than rejecting a valid plan simply because that backend lags.
  const blockhash = input.connection.getLatestBlockhashAndContext({
    commitment: "finalized", minContextSlot: accountSnapshot.context.slot,
  });
  const [rentLamports, recent] = await Promise.all([rent, blockhash]);
  if (!Number.isSafeInteger(rentLamports) || rentLamports <= 0 ||
      BigInt(rentLamports) > MAX_ATA_RENT_LAMPORTS) fail("rent_out_of_bounds");
  if (!Number.isSafeInteger(recent.context.slot) ||
      recent.context.slot < accountSnapshot.context.slot ||
      !Number.isSafeInteger(recent.value.lastValidBlockHeight) ||
      recent.value.lastValidBlockHeight <= 0) fail("blockhash_context_invalid");
  let recentBlockhash: PublicKey;
  try { recentBlockhash = new PublicKey(recent.value.blockhash); }
  catch { return fail("blockhash_invalid"); }
  if (recentBlockhash.toBase58() !== recent.value.blockhash) fail("blockhash_not_canonical");

  const ix = createAssociatedTokenAccountIdempotentInstruction(
    treasury, ata, treasury, CHZ_MINT, TOKEN_PROGRAM_ID,
  );
  if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6) {
    fail("ata_instruction_noncanonical");
  }
  const message = new TransactionMessage({
    payerKey: treasury, recentBlockhash: recent.value.blockhash, instructions: [ix],
  }).compileToV0Message();
  if (message.header.numRequiredSignatures !== 1 ||
      message.staticAccountKeys[0]?.toBase58() !== rawTreasury ||
      message.addressTableLookups.length !== 0 || message.compiledInstructions.length !== 1) {
    fail("transaction_shape_invalid");
  }
  const unsigned = new VersionedTransaction(message);
  const unsignedBytes = Buffer.from(unsigned.serialize());
  if (unsignedBytes.length > MAX_UNSIGNED_BYTES ||
      unsigned.signatures.length !== 1 || unsigned.signatures[0].some((byte) => byte !== 0)) {
    fail("unsigned_transaction_invalid");
  }
  const feeResponse = await input.connection.getFeeForMessage(message, "finalized");
  if (feeResponse.context.slot < recent.context.slot ||
      !Number.isSafeInteger(feeResponse.value) || feeResponse.value === null ||
      feeResponse.value <= 0 || BigInt(feeResponse.value) > MAX_NETWORK_FEE_LAMPORTS) {
    fail("network_fee_out_of_bounds");
  }
  const currentHeight = await input.connection.getBlockHeight("finalized");
  if (!Number.isSafeInteger(currentHeight) ||
      currentHeight >= recent.value.lastValidBlockHeight) fail("blockhash_expired");
  const maxSpend = BigInt(rentLamports) + MAX_NETWORK_FEE_LAMPORTS;
  if (BigInt(treasuryInfo.lamports) < maxSpend + MIN_REMAINING_SOL_LAMPORTS) {
    fail("insufficient_non_fee_setup_sol");
  }
  return {
    rewardTreasury: rawTreasury,
    officialChzMint: CHZ_MINT.toBase58(),
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    outputAta: ata.toBase58(),
    ataRentLamports: String(rentLamports),
    estimatedNetworkFeeLamports: String(feeResponse.value),
    maximumSetupSpendLamports: maxSpend.toString(),
    minimumRemainingSolLamports: MIN_REMAINING_SOL_LAMPORTS.toString(),
    sourceBalanceLamports: String(treasuryInfo.lamports),
    accountSlot: accountSnapshot.context.slot,
    blockhashSlot: recent.context.slot,
    recentBlockhash: recent.value.blockhash,
    lastValidBlockHeight: recent.value.lastValidBlockHeight,
    unsignedTransactionBase64: unsignedBytes.toString("base64"),
    transactionMessageHash: await sha256Hex(message),
    executionReady: false,
  };
}
