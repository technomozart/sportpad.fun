export const BPS_DENOMINATOR = 10_000n;
export const REWARD_BPS = 8_000n;
export const BUYBACK_BPS = 2_000n;

export type Allocation = {
  wallet: string;
  tokenSeconds: bigint;
  rewardAtomic: bigint;
};

export function splitCreatorFee(grossAtomic: bigint) {
  if (grossAtomic < 0n) throw new RangeError("grossAtomic must be non-negative");
  const rewardAtomic = (grossAtomic * REWARD_BPS) / BPS_DENOMINATOR;
  const buybackAtomic = grossAtomic - rewardAtomic;
  return { rewardAtomic, buybackAtomic };
}

export function allocateEpochRewards(
  fundedAtomic: bigint,
  balances: ReadonlyArray<{ wallet: string; tokenSeconds: bigint }>,
) {
  if (fundedAtomic < 0n) throw new RangeError("fundedAtomic must be non-negative");
  const eligible = balances.filter((entry) => entry.tokenSeconds > 0n);
  const totalTokenSeconds = eligible.reduce((sum, entry) => sum + entry.tokenSeconds, 0n);

  if (totalTokenSeconds === 0n) {
    return { allocations: [] as Allocation[], dustAtomic: fundedAtomic };
  }

  const allocations = eligible.map((entry) => ({
    ...entry,
    rewardAtomic: (fundedAtomic * entry.tokenSeconds) / totalTokenSeconds,
  }));
  const allocatedAtomic = allocations.reduce((sum, entry) => sum + entry.rewardAtomic, 0n);
  return { allocations, dustAtomic: fundedAtomic - allocatedAtomic };
}

export function feeEventId(sourceSignature: string, instructionIndex: number) {
  const normalized = sourceSignature.trim();
  if (!normalized || !Number.isSafeInteger(instructionIndex) || instructionIndex < 0) {
    throw new TypeError("A source signature and non-negative instruction index are required");
  }
  return `${normalized}:${instructionIndex}`;
}
