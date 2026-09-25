# Chiliz replenishment: quote-only preparation

The current SportPad Chiliz purchase worker spends **prefunded native CHZ**.
It does not convert the 80% Solana creator-fee stream into Chiliz liquidity.
`replenish-chiliz.mjs` is a separate, deliberately non-executing route probe.
It does not load private keys, build bridge user steps, sign, broadcast, fund a
wallet, or claim that a discovered path is liquid.

The codebase also has an isolated LayerZero quote/build-step inspector and a
default-paused, one-shot bridge journal capped at 10 CHZ. The inspector returns
no transaction bytes to sign; the journal has no seeded authorization or
worker. These components do not make the SOL-to-CHZ route executable.
It can now query LayerZero's transfer status for a known quote and source
signature, binding the reported Solana and Chiliz transactions. This is only
provider evidence: it does not prove the recipient or amount on either chain.

## Verified public route and dry run

On 2026-09-23, LayerZero's public `GET /chains` and `GET /tokens` directory
listed Solana (`solana`, chain ID 1), Chiliz (`chiliz`, chain ID 88888), the
Solana CHZ mint `6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw`
(8 decimals), and native Chiliz CHZ
`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` (18 decimals) as a reachable
destination from that mint. The CLI rechecks all exact identifiers each run.
Only a fresh authenticated quote can establish whether a particular amount
has an available route at a particular time.

In the same read-only audit, the exact unauthenticated Value Transfer quote
returned HTTP 401. Its quote, Solana build-step, and status endpoints require
an API key. The older keyless Stargate quote endpoint returned HTTP 410 and is
documented as deprecated. LayerZero's public OFT registry did not list this
CHZ mint or a Chiliz CHZ peer, and Wormhole's published NTT network list did
not include Chiliz. None of those observations establishes a direct SDK route
around the Value Transfer API. No bridge transaction was signed or sent.

The quote-only CLI accepts **public addresses** and one amount:

```text
node --experimental-strip-types --env-file-if-exists=.env.local scripts/replenish-chiliz.mjs --sol-lamports 10000000 --solana-wallet PUBLIC_SOLANA_REWARD_TREASURY --chiliz-wallet PUBLIC_CHILIZ_TREASURY
```

The `--chz-atomic` alternative quotes a known, already-settled Solana CHZ
amount. One CHZ on Solana is `100000000` atomic units. It does not verify that
the given wallet actually holds that amount. `JUPITER_API_KEY` is needed for
the first-leg swap quote; `LAYERZERO_VT_API_KEY` is needed for an authenticated
bridge quote. Missing keys are reported as blockers and are never printed.
The process intentionally exits nonzero because execution is not implemented.

After a separately executed bridge, its provider-reported progress can be
inspected without loading a wallet key:

```text
node --experimental-strip-types --env-file-if-exists=.env.local scripts/replenish-chiliz.mjs --status-quote-id QUOTE_ID --source-signature SOLANA_SIGNATURE
```

`SUCCEEDED` is not enough to credit inventory. Source finality and destination
treasury receipt must still be checked against independent chain RPCs.

The SOL path requests a Jupiter Swap V2 order but **discards the unsigned
transaction** after validating exact mints, amount, taker, signer set, fee
payer, router, slippage and price impact. Its minimum CHZ output is used for
an **indicative** LayerZero quote. This does not mean funds can immediately be
bridged: actual CHZ received must first be proven by finalized Solana balance
change, then a new bridge quote must be requested.

## Production execution work still required

1. Obtain a production LayerZero Value Transfer API key through LayerZero's
   published contact process, then quote a tiny real amount. A direct OFT SDK
   integration can avoid that API key only for a verified OFT deployment; it
   must **not** be assumed to work for this CHZ mint. Pump's official pair
   registry identifies Solana CHZ as a Sunrise (Wormhole Labs) asset, while
   LayerZero's unauthenticated directory merely lists a reachable route. The
   Chiliz's newer omnichain bridge UI supports Solana, but its public docs do
   not identify the CHZ-specific OFT program/store, native CHZ adapter, or a
   supported automation API. The generic OFT deployment guide creates a new
   token pair; it is not a substitute for the official native CHZ route.
2. Connect the default-paused bridge journal to a durable replenishment ledger
   keyed to reconciled 80% fee events. Store source fee IDs, source wallet,
   source SOL amount, quote hashes, route, expiry, maximum spend, Jupiter
   request ID, Solana swap signature, pre/post finalized CHZ token-account
   balances, LayerZero quote ID, bridge transaction signature, destination
   wallet and pre/post native
   CHZ balances. Never aggregate money from unrelated batches without a
   verifiable allocation ledger.
3. Before signing a Jupiter transaction, resolve all address lookup tables
   and validate every instruction and account writable by the signed message
   against an allowlist and the exact source/destination balance invariants.
   The existing Jupiter quote checks alone are **not sufficient** to sign an
   arbitrary provider-built transaction from a treasury wallet.
4. Persist the `swap_broadcast_unknown` state **before** submitting a signed
   swap. If the RPC or execute API times out, do not submit another purchase.
   Query the specific signature, finalized SOL and CHZ balances, and reconcile
   or require human review. Only after finalized receipt and actual CHZ amount
   are known may the bridge quote be requested.
5. For a Solana-source LayerZero route, call `POST /build-user-steps` for fresh
   blockhash-bound transactions. Validate exact quote ID, signer, chain,
   destination, token program, amounts, programs and instruction effects before
   signing. Persist `bridge_broadcast_unknown` before broadcast. Never retry
   an ambiguous transfer blindly.
6. Track `GET /status/{quoteId}` to `SUCCEEDED`, independently verify a native
   CHZ balance increase at the configured Chiliz treasury and account for
   bridge fees. Status alone is not an accounting proof. Only then make CHZ
   available to the Fan Token purchase worker. Maintain a native CHZ gas
   reserve and separate treasury purchase capital from claimant liabilities.
7. Reconcile a low-value canary end to end before enabling any unattended
   flow. Keep a public kill switch, per-batch caps, daily spend caps, route and
   fee limits, RPC health checks and alerting. If any source or destination
   observation is ambiguous, pause and require human reconciliation.

No live replenishment worker or scheduler should be enabled merely because
this read-only route discovery succeeds.

## Primary documentation

- [LayerZero Value Transfer API](https://docs.layerzero.network/v2/developers/value-transfer-api/start)
- [LayerZero API reference](https://docs.layerzero.network/v2/developers/value-transfer-api/api-reference/overview)
- [LayerZero token route directory](https://docs.layerzero.network/v2/developers/value-transfer-api/api-reference/tokens)
- [LayerZero Solana transfer example](https://docs.layerzero.network/v2/developers/value-transfer-api/examples/solana)
- [LayerZero direct Solana OFT SDK](https://docs.layerzero.network/v2/developers/solana/oft/sdk)
- [Stargate legacy API status](https://docs.stargate.finance/developers/api-docs/transfer-quotes)
- [Chiliz Bridge scope](https://docs.chiliz.com/learn/about-bridging/using-chiliz-bridge)
- [Chiliz omnichain bridge announcement](https://www.chiliz.com/building-on-an-omnichain-fan-token-ecosystem/)
- [Pump's Solana CHZ mint and Sunrise provenance](https://pump.fun/docs/custom-pairs)
- [Wormhole NTT supported networks](https://wormhole.com/docs/products/token-transfers/native-token-transfers/reference/supported-networks/)
