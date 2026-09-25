# Chiliz replenishment: direct bridge integration in progress

The current SportPad Chiliz purchase worker spends **prefunded native CHZ**.
It does not convert the 80% Solana creator-fee stream into Chiliz liquidity.
`replenish-chiliz.mjs` is a separate, deliberately non-executing route probe.
It does not load private keys, build bridge user steps, sign, broadcast, fund a
wallet, or claim that a discovered path is liquid.

The codebase also has an older LayerZero Value Transfer API inspector and a
default-paused, one-shot bridge journal capped at 10 CHZ. The inspector returns
no transaction bytes to sign; the journal has no seeded authorization or
worker. These components do not make the SOL-to-CHZ route executable.

## Verified keyless bridge route

The [official Chiliz bridge](https://bridge.chilizchain.com/) publishes the
following direct OFT path, and its peers have been checked in both directions
against Solana and Chiliz mainnet:

| Component | Identifier |
| --- | --- |
| Solana CHZ mint | `6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw` (8 decimals) |
| Solana OFT program | `BcRpUE1jvLvgchaYntfi2weReWVG8THCRLFy73CmxjHo` |
| Solana OFT store | `9SBbd5mXvCimWXpggkE8PJpXMjBddDhWWZY1eW1BhvUF` |
| Source / destination LayerZero EIDs | `30168` / `30409` |
| Native Chiliz CHZ adapter | `0xcdE3D1879b81b45c3aA35779C6ceB7E8B6526b4f` |

The public bridge client calls the [Solana OFT SDK](https://docs.layerzero.network/v2/developers/solana/oft/overview)
to quote and build a transfer from Solana RPC. A production LayerZero **Value
Transfer API key is not needed for this direct route**. The verified route
does not by itself prove that our automation, accounting, or payouts work.

## Quote-only CLI

On 2026-09-23, LayerZero's public `GET /chains` and `GET /tokens` directory
listed Solana (`solana`, chain ID 1), Chiliz (`chiliz`, chain ID 88888), the
Solana CHZ mint `6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw`
(8 decimals), and native Chiliz CHZ
`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` (18 decimals) as a reachable
destination from that mint. The CLI rechecks all exact identifiers each run.
This was an earlier route-discovery method, not the direct OFT execution path.

The Value Transfer quote and build-step endpoints require an API key. That
fact no longer blocks the separate, verified direct OFT route. No bridge
transaction has been signed or sent by this CLI.

The quote-only CLI accepts **public addresses** and one amount:

```text
node --experimental-strip-types --env-file-if-exists=.env.local scripts/replenish-chiliz.mjs --sol-lamports 10000000 --solana-wallet PUBLIC_SOLANA_REWARD_TREASURY --chiliz-wallet PUBLIC_CHILIZ_TREASURY
```

The `--chz-atomic` alternative quotes a claimed, already-settled Solana CHZ
amount. One CHZ on Solana is `100000000` atomic units. It does not verify that
the given wallet actually holds that amount. `JUPITER_API_KEY` is needed for
the first-leg swap quote; `HELIUS_API_KEY` or `SOLANA_RPC_URL` provides the
Solana RPC used for the direct OFT quote. The keyless route does **not** read
`LAYERZERO_VT_API_KEY`. The process intentionally exits nonzero because
execution is not implemented. A zero-SOL payer may make the SDK's quote
simulation fail before any transaction is constructed.

For a separately executed *legacy Value Transfer API* bridge, its
provider-reported progress can be inspected without loading a wallet key:

```text
node --experimental-strip-types --env-file-if-exists=.env.local scripts/replenish-chiliz.mjs --status-quote-id QUOTE_ID --source-signature SOLANA_SIGNATURE
```

`SUCCEEDED` is not enough to credit inventory. Source finality and destination
treasury receipt must still be checked against independent chain RPCs.

The SOL path requests a Jupiter Swap V2 order but **discards the unsigned
transaction** after validating exact mints, amount, taker, signer set, fee
payer, router, slippage and price impact. Its minimum CHZ output is used for
an **indicative** direct OFT quote. This does not mean funds can immediately be
bridged: actual CHZ received must first be proven by finalized Solana balance
change, then a new bridge quote must be requested.

## Production execution work still required

1. The verified official direct OFT path now has a bounded, read-only on-chain
   quote. Keep validating the store's mint, escrow, configured peer, enforced
   options, native fee, and destination amount for each transfer. Do not
   require a Value Transfer API key for this path.
2. Connect the default-paused bridge journal to a durable replenishment ledger
   keyed to reconciled 80% fee events. Store source fee IDs, source wallet,
   source SOL amount, quote hashes, route, expiry, maximum spend, Jupiter
   request ID, Solana swap signature, pre/post finalized CHZ token-account
   balances, direct OFT quote digest, bridge transaction signature, destination
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
5. Build direct `oft.send()` instructions with a fresh Solana blockhash. Check
   the exact store, program, mint, source ATA, signer, treasury recipient,
   destination EID, amount, options, fees, lookup table, and resulting message
   before signing. Persist the signed intent and one-way broadcast marker
   before network submission. Never blindly retry an ambiguous transfer.
6. Track the message by Solana signature/GUID through LayerZero Scan, then
   independently verify the Chiliz adapter's `OFTReceived` event, finalized
   transaction receipt, expected treasury, and received amount. Provider
   status alone is not an accounting proof. Only then make CHZ
   available to the Fan Token purchase worker. Maintain a native CHZ gas
   reserve and separate treasury purchase capital from claimant liabilities.
7. Reconcile a low-value canary end to end before enabling any unattended
   flow. Keep a public kill switch, per-batch caps, daily spend caps, route and
   fee limits, RPC health checks and alerting. If any source or destination
   observation is ambiguous, pause and require human reconciliation.

No live replenishment worker or scheduler should be enabled merely because
this read-only route discovery succeeds.

## Primary documentation

- [Official Chiliz bridge](https://bridge.chilizchain.com/)
- [LayerZero direct Solana OFT SDK](https://docs.layerzero.network/v2/developers/solana/oft/overview)
- [LayerZero Value Transfer API (legacy optional inspector)](https://docs.layerzero.network/v2/developers/value-transfer-api/start)
- [LayerZero API reference](https://docs.layerzero.network/v2/developers/value-transfer-api/api-reference/overview)
- [LayerZero token route directory](https://docs.layerzero.network/v2/developers/value-transfer-api/api-reference/tokens)
- [LayerZero Solana transfer example](https://docs.layerzero.network/v2/developers/value-transfer-api/examples/solana)
- [Stargate legacy API status](https://docs.stargate.finance/developers/api-docs/transfer-quotes)
- [Chiliz Bridge scope](https://docs.chiliz.com/learn/about-bridging/using-chiliz-bridge)
- [Chiliz omnichain bridge announcement](https://www.chiliz.com/building-on-an-omnichain-fan-token-ecosystem/)
- [Pump's Solana CHZ mint and Sunrise provenance](https://pump.fun/docs/custom-pairs)
- [Wormhole NTT supported networks](https://wormhole.com/docs/products/token-transfers/native-token-transfers/reference/supported-networks/)
