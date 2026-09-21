export type PublicDevnetReceipt = {
  network: "solana:devnet";
  rewardTokenAddress: string;
  mint: string;
  createSignature: string;
  createSlot: number;
  feeSignature: string;
  feeSlot: number;
  rewardWallet: string;
  burnWallet: string;
  metadataUri: string;
  verifiedAt: string;
  publishedAt: string;
};

export type VerifiedDevnetEvidence = Omit<PublicDevnetReceipt, "publishedAt">;

export type PublishableDevnetDraft = {
  status: string;
  name: string;
  symbol: string;
  rewardMint: string | null;
  creatorWallet: string | null;
  devnetMetadataUri: string | null;
  devnetMint: string | null;
  devnetCreateSignature: string | null;
  devnetFeeSignature: string | null;
  devnetRewardWallet: string | null;
  devnetBurnWallet: string | null;
  devnetVerifiedAt: string | null;
  devnetPublishedAt: string | null;
};

export type VerifiedDevnetSubmission = {
  kind: string;
  status: string;
  mint: string;
  creatorWallet: string;
  metadataUri: string;
  rewardWallet: string;
  burnWallet: string;
  tokenName: string;
  tokenSymbol: string;
  signature: string;
  verifiedSlot: number | null;
};

function isTimestamp(value: string | null): value is string {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function matchesFrozenDraft(
  submission: VerifiedDevnetSubmission,
  draft: PublishableDevnetDraft,
) {
  return submission.status === "verified" &&
    submission.mint === draft.devnetMint &&
    submission.creatorWallet === draft.creatorWallet &&
    submission.metadataUri === draft.devnetMetadataUri &&
    submission.rewardWallet === draft.devnetRewardWallet &&
    submission.burnWallet === draft.devnetBurnWallet &&
    submission.tokenName === draft.name &&
    submission.tokenSymbol === draft.symbol &&
    Number.isSafeInteger(submission.verifiedSlot) &&
    submission.verifiedSlot !== null &&
    submission.verifiedSlot >= 0;
}

/**
 * Converts independently verified devnet evidence into the only receipt shape
 * that may cross the public API boundary. Owner IDs, wallet sessions, and the
 * creator wallet are deliberately absent from the returned object.
 */
export function buildPublicDevnetReceipt(
  draft: PublishableDevnetDraft,
  submissions: readonly VerifiedDevnetSubmission[],
): PublicDevnetReceipt | null {
  if (
    draft.status !== "devnet_published" ||
    !isTimestamp(draft.devnetPublishedAt)
  ) {
    return null;
  }

  const evidence = buildVerifiedDevnetEvidence(draft, submissions);
  return evidence ? { ...evidence, publishedAt: draft.devnetPublishedAt } : null;
}

export function buildVerifiedDevnetEvidence(
  draft: PublishableDevnetDraft,
  submissions: readonly VerifiedDevnetSubmission[],
): VerifiedDevnetEvidence | null {
  if (
    !draft.creatorWallet ||
    !draft.rewardMint ||
    !draft.devnetMetadataUri ||
    !draft.devnetMint ||
    !draft.devnetCreateSignature ||
    !draft.devnetFeeSignature ||
    !draft.devnetRewardWallet ||
    !draft.devnetBurnWallet ||
    !isTimestamp(draft.devnetVerifiedAt)
  ) return null;

  const create = submissions.find((submission) =>
    submission.kind === "create" &&
    submission.signature === draft.devnetCreateSignature &&
    matchesFrozenDraft(submission, draft)
  );
  const fee = submissions.find((submission) =>
    submission.kind === "fee" &&
    submission.signature === draft.devnetFeeSignature &&
    matchesFrozenDraft(submission, draft)
  );
  if (!create || !fee || create.verifiedSlot === null || fee.verifiedSlot === null) return null;

  return {
    network: "solana:devnet",
    rewardTokenAddress: draft.rewardMint,
    mint: draft.devnetMint,
    createSignature: draft.devnetCreateSignature,
    createSlot: create.verifiedSlot,
    feeSignature: draft.devnetFeeSignature,
    feeSlot: fee.verifiedSlot,
    rewardWallet: draft.devnetRewardWallet,
    burnWallet: draft.devnetBurnWallet,
    metadataUri: draft.devnetMetadataUri,
    verifiedAt: draft.devnetVerifiedAt,
  };
}
