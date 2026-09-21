export type PublicMainnetReceipt = {
  network: "solana:mainnet";
  rewardTokenAddress: string;
  mint: string;
  createSignature: string;
  createSlot: number;
  feeSignature: string;
  feeSlot: number;
  rewardTreasury: string;
  buybackTreasury: string;
  metadataUri: string;
  verifiedAt: string;
};

export type PublishableMainnetDraft = {
  status: string;
  rewardMint: string | null;
  mainnetMetadataUri: string | null;
  mainnetMint: string | null;
  mainnetCreateSignature: string | null;
  mainnetCreateSlot: number | null;
  mainnetFeeSignature: string | null;
  mainnetFeeSlot: number | null;
  mainnetRewardTreasury: string | null;
  mainnetBuybackTreasury: string | null;
  mainnetVerifiedAt: string | null;
};

function isTimestamp(value: string | null): value is string {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

export function buildPublicMainnetReceipt(draft: PublishableMainnetDraft): PublicMainnetReceipt | null {
  if (
    draft.status !== "mainnet_published" ||
    !draft.rewardMint ||
    !draft.mainnetMetadataUri ||
    !draft.mainnetMint ||
    !draft.mainnetCreateSignature ||
    !Number.isSafeInteger(draft.mainnetCreateSlot) ||
    draft.mainnetCreateSlot === null ||
    !draft.mainnetFeeSignature ||
    !Number.isSafeInteger(draft.mainnetFeeSlot) ||
    draft.mainnetFeeSlot === null ||
    !draft.mainnetRewardTreasury ||
    !draft.mainnetBuybackTreasury ||
    !isTimestamp(draft.mainnetVerifiedAt)
  ) return null;
  return {
    network: "solana:mainnet",
    rewardTokenAddress: draft.rewardMint,
    mint: draft.mainnetMint,
    createSignature: draft.mainnetCreateSignature,
    createSlot: draft.mainnetCreateSlot,
    feeSignature: draft.mainnetFeeSignature,
    feeSlot: draft.mainnetFeeSlot,
    rewardTreasury: draft.mainnetRewardTreasury,
    buybackTreasury: draft.mainnetBuybackTreasury,
    metadataUri: draft.mainnetMetadataUri,
    verifiedAt: draft.mainnetVerifiedAt,
  };
}
