# One-shot direct CHZ OFT canary

This is a separate, off-by-default path for **at most 10 Solana CHZ** from the
configured Solana reward vault to the configured native Chiliz treasury. It
does not enable public launch readiness, buybacks, claims, or a repeatable
bridge. No policy is seeded by a migration.

## Required switches

On the Sites/API deployment, set these to exactly `true` only for the canary
window. The first flag permits the private read-only check that the prior
SOL→CHZ swap is finalized with at least 7 CHZ credited:

```text
SPORTPAD_CHZ_SOLANA_CANARY_API_ENABLED=true
SPORTPAD_CHILIZ_BRIDGE_CANARY_WORKER_API_ENABLED=true
SPORTPAD_CHILIZ_BRIDGE_CANARY_PREPARE_ENABLED=true
```

On the **Solana** Railway worker (where the reward-vault key already lives),
the explicit one-shot action is:

```text
SPORTPAD_CHZ_SOLANA_CANARY_ACTION=direct_oft_prepare_broadcast
SPORTPAD_DIRECT_OFT_CANARY_WORKER_ENABLED=true
```

The worker also requires its existing `SPORTPAD_BASE_URL=https://sportpad.fun`,
`SPORTPAD_WORKER_TOKEN`, `HELIUS_API_KEY`, and
`SOLANA_REWARD_VAULT_PRIVATE_KEY`, plus the public `CHILIZ_TREASURY_ADDRESS`.
The source wallet is derived from the Solana key and checked against the
published reward treasury by the Solana worker. The destination is checked
against the Sites configuration by the private bridge API. The action pins
the journal ID to `initial`, sends 7 CHZ with a 6.65 CHZ minimum, derives the
Solana RPC from the existing Helius key, and uses independent Ankr/PublicNode
Chiliz RPCs. No additional quote/RPC/mode environment variables are needed.
Never put the key in the Chiliz worker, site, database, logs, or a command argument. The
runner can also be invoked directly from the Solana worker environment with
`node --experimental-strip-types scripts/chiliz-direct-oft-canary-worker.mjs`.

The runner fetches the official on-chain OFT quote and exact unsigned send,
signs it locally, then asks the private API to commit paused-policy seed,
arming, signed journal insert, and reservation in **one D1 transaction**.
Only after reloading that persisted signed row does it perform the one-way
broadcast claim and submit the **exact stored bytes**. The private endpoint
never signs or broadcasts. The one-shot signed OFT fee is capped at 500,000
lamports on both API and worker, and the worker requires at least 0.045 SOL
remaining after the fee and a 50,000-lamport network-fee buffer. A
failed/uncertain claim or send is not retried.

## Recovery boundary

The current one-shot journal stores signed bytes and quote identity, but not
the full unsigned OFT plan. If the process stops after reservation or an
unknown send, **do not restart `prepare_broadcast` to recover or create a new
transfer**. The durable claim state prevents replay, but independent finalized
source/destination reconciliation after a process crash requires the original
plan artifact or manual reconstruction/audit. The `reconcile` mode is
read-only and requires that exact plan JSON plus the independently recorded
signed-transaction SHA-256. It does not mark D1 finalized yet. Keep public
readiness gates closed until end-to-end proof and durable recovery are in
place.
