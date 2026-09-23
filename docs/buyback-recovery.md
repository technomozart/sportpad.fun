# SPORTPAD buyback recovery gate

The Solana worker's SPORTPAD buyback lane is deliberately disabled. Its quote
validator rejects unexpected Jupiter V2 swap signers, fee payers, programs,
accounts, transfers, token output, and fees before signing. That is necessary
but not sufficient to run unattended treasury swaps: swap and burn are two
separate irreversible transactions.

The validator's pre-sign simulation is a fail-closed estimate, not an on-chain
spend limit. Runtime state can change between simulation and inclusion, and a
top-level aggregator instruction can make cross-program calls. Before enabling
the lane, keep only a capped float in the signing wallet or use an on-chain
spend guard, and test actual Jupiter mainnet order shapes against the pinned
program/account allowlist. Unapproved route shapes must remain rejected.

## Durable stages required before enabling

The automation database needs one unique record per fee-derived buyback job,
with immutable mint, treasury, SOL input cap, destination ATA, quote minimum
output, and these monotonic stages:

1. `prepared`: Persist the exact Jupiter order `requestId`, unsigned message,
   and its verified deterministic treasury signature **before** `/execute`.
2. `swap_broadcast`: On timeout, query that signature on Solana and retry only
   the same signed transaction/request ID while it is valid. Never request a
   fresh order for this job after a possible broadcast.
3. `swap_confirmed`: Persist the confirmed receipt, measured treasury SOL debit,
   and exact SPORTPAD token delta for the expected ATA. The token delta, not a
   wallet snapshot, fixes the amount to burn.
4. `burn_prepared`: Persist the exact signed burn transaction and signature
   before sending it. The burn amount must equal this job's measured swap
   output and cannot exceed the treasury ATA balance.
5. `burn_broadcast`: On timeout, query/rebroadcast only the same signed burn.
   Never build a second burn while the first outcome is uncertain.
6. `burn_confirmed`: Store the confirmed burn receipt and mark the job complete.
   Publish both swap and burn signatures in the public receipt.

Before marking the broader fee settlement complete, the database must also
prove the independent 80% reward-purchase leg reached its own terminal success
state. A completed settlement must never be overwritten by later purchase
seeding, and a burn completion alone must not exclude a missing reward purchase
from the scheduler. These are separate ordering/compare-and-swap invariants,
not conditions that can be inferred from a worker's return value.

If a signature cannot be conclusively classified before its blockhash expires,
the lane stops for operator reconciliation. It must **not** automatically retry
with a new swap or new burn. Record every stage transition in the same durable
job ledger, with a single worker lease and compare-and-swap update. A crash at
every boundary above must be exercised in tests before a low-value canary.

The existing generic `broadcasting` job state stops automatic re-lease after
an ambiguous financial action. The swap order and signature are now persisted,
but swap/burn stage receipts and a pre-broadcast burn intent are still missing.
Keep `BUYBACK_EXECUTION_SAFE=false` until recovery from every stage is tested,
signer matching is verified in production, and a capped canary burn is
observed end to end. The burn proof should use the
burn transaction's own token-account delta: a global mint-supply before/after
snapshot can be changed concurrently by unrelated mint or burn transactions.

## Bind a swap to its pre-broadcast order

The existing `transaction_intents` table already has the fields needed to
record an automatic Jupiter order's exact message without a new migration:
`settlement_id`, unique `idempotency_key`, `signer_address`,
`provider_request_id`, `unsigned_transaction_base64`,
`transaction_message_hash`, unique `tx_signature`, input/output mint and
amount fields, and a minimum output. The automated worker and authenticated
worker API now prepare this row before Jupiter `/execute`, but the lane remains
disabled while crash recovery and canary validation are incomplete.

Before the first `/execute` call, the worker validates the Jupiter order with
the pinned-route pre-sign inspector. An authenticated worker API action then
verifies the current armed job and settlement snapshot, verifies the treasury
signature over the exact unsigned message with
`inspectPreparedAutomaticBuybackOrder`, then durably insert one immutable
`transaction_intents` row. Use action `sportpad_buyback_automation`,
idempotency key `automation:buyback:swap:<settlementId>`, signer role
`buyback_treasury`, state `prepared`, exact unsigned order, message hash,
deterministic signature, Jupiter request ID, official SPORTPAD mint, SOL input,
and quoted minimum output. A conflicting row must stop execution; it must
never be overwritten with a newly requested order. Only after the database
confirms this insert may the worker send `/execute`.

At completion, the server fetches the row by that idempotency key. After the finalized
swap/burn receipt checks, it calls `verifyPersistedAutomaticBuybackIntent` with
the row, the settlement's immutable input terms, and the finalized swap
receipt/status. This independently checks the on-chain transaction's exact
message bytes and verified treasury signature against the pre-broadcast row,
plus the minimum output. A missing row or mismatch requires reconciliation,
not ledger credit. The Jupiter request ID correlates API calls but is not a
cryptographic provider attestation; the signed message and finalized chain
receipt are the authoritative proof. The server does not yet independently
repeat the full pre-sign instruction and account simulation, so a worker-key
compromise could still spend funds. A crash-recovery loop must query the
persisted signature and, if safe, rebroadcast only that same signed message.
That crash-recovery loop and a durable, pre-broadcast burn intent are still
pending. Never enable `BUYBACK_EXECUTION_SAFE` or the financial ledger gate
based on swap-intent persistence alone.

Primary references: [Jupiter V2 Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute),
[Solana versioned transactions and address lookup tables](https://solana.com/docs/core/transactions/versioned-transactions),
[Solana transaction metadata](https://solana.com/docs/rpc/json-structures).
