/**
 * An epoch can only accrue holder weight once a finalized snapshot has
 * established its opening balances. If the first snapshot misses the planned
 * start, move the entire fixed-length window forward to that snapshot rather
 * than assigning weight to a period for which no balances were observed.
 */
export function finalizedHolderBaselineWindow({
  startsAt,
  endsAt,
  firstFinalizedAt,
  hasCheckpoint,
}: {
  startsAt: number;
  endsAt: number;
  firstFinalizedAt: number;
  hasCheckpoint: boolean;
}) {
  if (![startsAt, endsAt, firstFinalizedAt].every(Number.isSafeInteger) ||
    startsAt <= 0 || endsAt <= startsAt || firstFinalizedAt <= 0) {
    throw new RangeError("Invalid finalized holder baseline window.");
  }
  const shiftSeconds = hasCheckpoint ? 0 : Math.max(0, firstFinalizedAt - startsAt);
  const effectiveStartsAt = startsAt + shiftSeconds;
  const effectiveEndsAt = endsAt + shiftSeconds;
  if (!Number.isSafeInteger(effectiveEndsAt)) throw new RangeError("Holder epoch end is out of range.");
  return {
    startsAt: effectiveStartsAt,
    endsAt: effectiveEndsAt,
    shiftSeconds,
  };
}
