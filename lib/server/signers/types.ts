export const SIGNER_ROLES = ["fee_distributor", "reward_vault", "buyback_executor"] as const;
export type SignerRole = typeof SIGNER_ROLES[number];

export type TransactionPolicyIntent = {
  idempotencyKey: string;
  role: SignerRole;
  network: "solana-mainnet";
  action: "distribute_fees" | "reward_swap" | "buyback_swap" | "burn_sportpad" | "reward_transfer";
  expectedPrograms: string[];
  expectedMints: string[];
  maximumSpendLamports: string;
  expiresAt: string;
};

export type SignAndSendRequest = {
  transactionBase64: string;
  intent: TransactionPolicyIntent;
};

export type SignAndSendResult = {
  providerRequestId: string;
  signature: string;
};

export interface ManagedSignerProvider {
  readonly provider: string;
  getAddress(role: SignerRole): Promise<string>;
  signAndSend(request: SignAndSendRequest): Promise<SignAndSendResult>;
}
