# One-shot direct CHZ OFT canary

This is a separate, off-by-default path for **4–7 Solana CHZ** from the
configured Solana reward vault to the configured native Chiliz treasury. It
does not enable public launch readiness, buybacks, claims, or a repeatable
bridge. No policy is seeded by a migration.

## Required switches

On the Sites/API deployment, set these to exactly `true` only for the canary
window. The first flag permits the private read-only check that the prior
SOL→CHZ swap is finalized with at least 4 CHZ credited:

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
the journal ID to `initial`, bridges at most 7 whole CHZ from the verified
finalized swap output (rounding down to the nearest whole CHZ and requiring at
least 4 CHZ), with a 95% receive minimum. Thus 6.2 CHZ output becomes a
6 CHZ bridge with a 5.7 CHZ minimum. It derives the
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

The 0034 one-shot journal stores the exact unsigned OFT plan and its SHA-256
alongside the signed bytes in the same D1 transaction. The plan is immutable;
the private API revalidates its digest, signed bytes, route, destination,
amount and fee every time it is loaded or claimed. After a crash in
`broadcast_attempted`/`held`, the `prepare_broadcast` action does **read-only
reconciliation** using that durable plan, never another sign or send. A crash
in `prepared` remains held for explicit operator review; an unknown send is
never replayed. The explicit `reconcile` mode needs no local plan JSON or
signed-hash environment variable. The private API independently verifies the
finalized source event and destination receipt using Helius, LayerZero Scan,
and two Chiliz RPCs, then persists the source and destination proofs through
one-way D1 transitions. A failed destination write leaves the verified source
row available for reconciliation; it does not authorize another send. The
one-shot canary does not unlock public readiness or repeatable replenishment.
