"use client";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

type TransactionSigner = <T extends Transaction>(transaction: T) => Promise<T>;

function supportedTokenProgram(program: PublicKey) {
  return program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID);
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** The claimant, not the reward treasury, pays for their one-time token account. */
export function buildSolanaRewardAccountTransaction(options: {
  walletAddress: string;
  rewardMint: string;
  tokenProgram: PublicKey;
  blockhash: string;
}) {
  if (!supportedTokenProgram(options.tokenProgram)) throw new Error("Unsupported Fan Token program.");
  const owner = new PublicKey(options.walletAddress);
  const mint = new PublicKey(options.rewardMint);
  const tokenAccount = getAssociatedTokenAddressSync(mint, owner, false, options.tokenProgram);
  const transaction = new Transaction({ feePayer: owner, recentBlockhash: options.blockhash }).add(
    createAssociatedTokenAccountIdempotentInstruction(
      owner, tokenAccount, owner, mint, options.tokenProgram,
    ),
  );
  return { transaction, tokenAccount };
}

export async function ensureSolanaRewardTokenAccount(options: {
  walletAddress: string;
  rewardMint: string;
  signTransaction: TransactionSigner;
}) {
  const rpc = new Connection(MAINNET_RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
  const owner = new PublicKey(options.walletAddress);
  const mint = new PublicKey(options.rewardMint);
  const mintInfo = await rpc.getAccountInfo(mint, "finalized");
  const tokenProgram = mintInfo?.owner;
  if (!tokenProgram || !supportedTokenProgram(tokenProgram)) {
    throw new Error("The official Fan Token mint is unavailable on Solana.");
  }
  const tokenAccount = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const verifyAccount = async () => {
    const info = await rpc.getAccountInfo(tokenAccount, "finalized");
    if (!info) return false;
    const account = unpackAccount(tokenAccount, info, tokenProgram);
    if (!account.owner.equals(owner) || !account.mint.equals(mint)) {
      throw new Error("The Fan Token account does not belong to this wallet.");
    }
    return true;
  };
  if (await verifyAccount()) return { created: false, tokenAccount: tokenAccount.toBase58() };

  const latest = await rpc.getLatestBlockhash("confirmed");
  const { transaction } = buildSolanaRewardAccountTransaction({
    walletAddress: options.walletAddress,
    rewardMint: options.rewardMint,
    tokenProgram,
    blockhash: latest.blockhash,
  });
  const originalMessage = transaction.serializeMessage();
  const signed = await options.signTransaction(transaction);
  if (!equalBytes(originalMessage, signed.serializeMessage()) || !signed.signature) {
    throw new Error("The wallet changed or did not sign the Fan Token account transaction.");
  }
  const expectedSignature = bs58.encode(signed.signature);
  const signature = await rpc.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  if (signature !== expectedSignature) throw new Error("The Solana RPC returned a different transaction signature.");
  const confirmation = await rpc.confirmTransaction({ signature, ...latest }, "finalized");
  if (confirmation.value.err || !(await verifyAccount())) {
    throw new Error("The Fan Token account was not finalized. Check your wallet before retrying.");
  }
  return { created: true, tokenAccount: tokenAccount.toBase58(), signature };
}
