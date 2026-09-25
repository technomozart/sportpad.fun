# Chiliz bridge ledger (inactive)

Migration 0029 adds repeatable, fee-attributed CHZ bridge accounting. It does not
start a worker, sign or broadcast transactions, or make the launchpad ready.

Every bridge transfer is capped at 10 Solana CHZ. Its minimum Chiliz-chain
receive amount must be an exact 8-to-18-decimal conversion representing
95%–100% of the source CHZ. Allocations consume only finalized SOL→CHZ swap
output, and the full source amount must be allocated before a transfer can be
sealed for broadcast. An unresolved broadcast retains its allocations.

**Legacy-lane mutual exclusion:** The old one-shot bridge canary and this new
repeatable ledger use the same physical Solana CHZ treasury. The migration
prevents reuse of the same quote, signed transaction, source signature, bridge
message, or destination transaction across their two journals, but it cannot
serialize two *different* treasury spends. Do not arm/run both bridge lanes at
once. Before enabling a repeatable worker, disable the legacy lane and add a
shared treasury execution lease plus a finalized on-chain balance preflight.
