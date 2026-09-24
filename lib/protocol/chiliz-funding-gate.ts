/**
 * A Chiliz purchase must be funded by the same settlement's finalized 80% fee
 * SOL, not by an indicative Jupiter quote against a separately prefunded CHZ
 * treasury. Keep this independent hold until the swap, bridge, destination
 * credit, and non-reuse proofs are persisted and checked for each settlement.
 * A read-only market quote or an online worker is not that proof.
 */
export const CHILIZ_FEE_FUNDING_VERIFIED = false;
