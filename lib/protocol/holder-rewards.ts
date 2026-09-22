export type HolderPosition = {
  tokenSecondsAtomic: bigint;
  endingBalanceAtomic: bigint;
  lastObservedAt: number | null;
};

export function accrueHolderPosition({
  previous,
  nextBalanceAtomic,
  observedAt,
  startsAt,
  endsAt,
}: {
  previous: HolderPosition | null;
  nextBalanceAtomic: bigint;
  observedAt: number;
  startsAt: number;
  endsAt: number;
}) {
  if (nextBalanceAtomic < 0n) throw new RangeError("nextBalanceAtomic must be non-negative");
  if (!Number.isSafeInteger(observedAt) || !Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt)) {
    throw new TypeError("Epoch observation timestamps must be safe integers");
  }
  if (endsAt <= startsAt) throw new RangeError("Epoch end must be after its start");

  const cappedObservation = Math.min(Math.max(observedAt, startsAt), endsAt);
  if (!previous) {
    return {
      tokenSecondsAtomic: 0n,
      endingBalanceAtomic: nextBalanceAtomic,
      lastObservedAt: cappedObservation,
    };
  }

  const previousObservation = previous.lastObservedAt === null
    ? cappedObservation
    : Math.min(Math.max(previous.lastObservedAt, startsAt), endsAt);
  const elapsedSeconds = Math.max(0, cappedObservation - previousObservation);
  return {
    tokenSecondsAtomic: previous.tokenSecondsAtomic + previous.endingBalanceAtomic * BigInt(elapsedSeconds),
    endingBalanceAtomic: nextBalanceAtomic,
    lastObservedAt: Math.max(previousObservation, cappedObservation),
  };
}

export function canonicalHolderSnapshot(entries: ReadonlyArray<{ wallet: string; amountAtomic: bigint }>) {
  return entries
    .filter((entry) => entry.amountAtomic >= 0n)
    .map((entry) => `${entry.wallet}:${entry.amountAtomic}`)
    .sort()
    .join("\n");
}

export function canonicalRewardAllocation(entries: ReadonlyArray<{ wallet: string; rewardAtomic: bigint }>) {
  return entries
    .filter((entry) => entry.rewardAtomic > 0n)
    .map((entry) => `${entry.wallet}:${entry.rewardAtomic}`)
    .sort()
    .join("\n");
}
