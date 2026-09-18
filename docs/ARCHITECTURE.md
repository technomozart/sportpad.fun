# SPORTPAD architecture

Status: product interface, private draft storage, wallet authentication, and a
wallet-approved Pump devnet launch path are implemented. Mainnet execution is
deliberately disabled.

## Implemented application path

```text
Launch builder
  -> POST /api/launch-drafts
  -> draft metadata in Cloudflare D1
  -> validated image bytes in private Cloudflare R2

Wallet verification
  -> one-time signed challenge bound to solana:devnet
  -> Ed25519 verification on the server
  -> opaque HttpOnly wallet session, hashed in D1

Saved draft devnet test
  -> Pump metadata URI
  -> wallet-approved Pump V2 coin creation
  -> finalized creator, mint, and bonding-curve verification
  -> wallet-approved 8,000 / 2,000 bps creator-fee configuration
  -> finalized recipient and revoked-admin verification

Public discovery
  -> creator explicitly accepts devnet-only publication
  -> POST /api/launch-drafts/{id}/publish with the verified wallet session
  -> exact verified submissions checked again
  -> GET /api/public-launches
  -> D1 rows with status = devnet_published
  -> GET /api/public-launches/{id}/image for the stored image
```

The builder accepts a PNG, JPEG, or WebP image up to 5 MB through drag and drop
or a file picker. It validates the declared MIME type and file signature before
storing the object. Description is optional. A failed D1 insert triggers cleanup
of the newly uploaded R2 object.

Drafts are private by default. Devnet verification does not publish a draft.
The creator must reconnect the wallet that created the coin, accept the
devnet-only disclosure, and invoke the publication endpoint. The endpoint
rechecks both exact verified submissions before atomically changing the row to
`devnet_published`. The public API omits owner IDs, wallet-session data, and a
separate creator-wallet field, while exposing the devnet mint, metadata URI,
finalized transaction receipts, configured fee recipients, and slots. The creator
wallet remains discoverable from the linked public Solana transaction. Product
examples disappear when the first valid receipt is published.

## Official Fan Token registry

The catalog currently contains 96 FanTokens entries:

- 82 selectable official Fan Tokens with exact Solana token addresses from the
  Chiliz registry and official token imagery. Fan Tokens are rooted in the
  Chiliz ecosystem and use an omnichain supply model across Chiliz Chain,
  Solana, and Base. The Solana address is not an independent SportPad copy.
- 14 catalog-only assets without a published official Solana address in the
  registry snapshot. They remain visible but are not given an invented route.

Every reward asset is marked `not_enabled`. A published token address proves identity,
not liquidity, inventory, or execution readiness.

## Data stores and migrations

- D1 stores launch drafts and the schemas reserved for fee events, settlements,
  reward epochs, reward claims, and service cursors.
- R2 stores uploaded draft images under per-draft object keys. D1 stores only
  the object key, MIME type, and byte size.
- Drizzle migrations are versioned in `drizzle/`. Migration `0002` adds the
  image metadata columns required by the upload flow. Migration `0003` adds
  signed-wallet challenges, opaque wallet sessions, and verified Pump devnet
  evidence. Migration `0004` adds durable pre-broadcast transaction submissions
  and unique mint and signature constraints. Migration `0005` adds the immutable
  creator and configuration snapshot used to verify each exact signed attempt.
  Migration `0006` adds the persisted blockhash-invalidity observation used to
  prevent an edge-of-window transaction from being replaced prematurely.
  Migration `0007` adds the explicit devnet publication timestamp.
- Cloudflare bindings are named `DB` and `BUCKET`; credentials and signing keys
  are never stored in database rows.

The fee, settlement, epoch, and claim tables are forward-looking schemas. Their
presence does not mean those workers or economic actions are live.

## Implemented devnet coordinator

The creator supplies two distinct public Solana addresses, one for the 80%
reward test recipient and one for the 20% SPORTPAD test recipient. These are
creator-configured devnet addresses, not verified platform treasuries. SportPad
does not create or retain either address's private key.

Pump V2 creates a SOL-paired Token-2022 community coin on devnet. The browser
keeps the new mint signer only long enough to co-sign coin creation; the creator
wallet separately approves the transaction. There is no initial buy and Pump's
own holder-reward mode stays off.

The second wallet approval creates Pump's canonical fee-sharing configuration
and locks the exact 8,000 / 2,000 bps recipients. SportPad marks the draft
verified only after server-side finalized RPC checks confirm the Pump programs,
creator, mint, bonding curve, two shareholders, and revoked fee-share admin.
Each signed transaction is recorded in D1 before broadcast. Conditional final
writes and unique database indexes prevent concurrent requests from attaching
different mints or signatures to the same draft. Verification reads the immutable
submission snapshot, so a racing browser tab cannot change the creator, metadata,
or treasury recipients underneath an already signed transaction.

This is execution testing, not a mainnet product. Devnet SOL and devnet tokens
have no intended value. The fee split does not acquire Fan Tokens, distribute
rewards, buy SPORTPAD, or burn supply.

## Proposed economic model

If mainnet execution is later approved and deployed, qualifying creator fees
would follow this split:

- 80% funds acquisition and holder distribution of the launch's selected
  official Fan Token.
- 20% funds SPORTPAD buyback + burn after the SPORTPAD token exists and the
  burn path has been independently verified.

The community token and its official Fan Token reward are separate assets. The
model does not create a literal AMM pair between them.

For a finalized creator-fee amount `G`:

- rewards: `floor(G * 8000 / 10000)`
- SPORTPAD buyback + burn: `G - rewards`

For a funded reward epoch `F` and wallet token-seconds `t_i`:

- wallet reward: `floor(F * t_i / sum(t))`
- integer dust carries into the next epoch

All onchain quantities must remain atomic-unit integer strings. Decimals and
authorities must be read from chain state.

## Planned mainnet execution components

None of the following are deployed today:

1. **Production launch coordinator**
   - Reuses the verified devnet flow only after dependency review, transaction
     limits, monitoring, policy controls, and an external security review.
   - Publishes the production mint and fee-sharing evidence before trading.

2. **Fee indexer and settlement keeper**
   - Observes pre-graduation and post-graduation creator-fee paths.
   - Waits for Solana finalization and deduplicates by transaction signature and
     instruction position.
   - Uses Jupiter only after quote age, depth, slippage, price-impact, mint
     allowlist, and daily-limit checks pass.

3. **Holder indexer and reward publisher**
   - Aggregates token accounts by owner and excludes controlled accounts.
   - Uses time-weighted token-seconds instead of an end-of-epoch snapshot.
   - Publishes only fully funded allocations with deterministic proofs and
     single-claim protection.

4. **SPORTPAD burn executor**
   - Buys the deployed SPORTPAD mint from the 20% share.
   - Calls SPL `BurnChecked`, waits for finalization, and verifies the supply
     reduction.

5. **Optional cross-chain replenishment**
   - Remains a treasury inventory operation, not a user claim dependency.
   - Requires a validated route, capped signer, decimal handling, timeout
     policy, and sufficient prefunded inventory.

## Safety and failure policy

Production private keys must never appear in chat, source control, database
rows, ordinary environment files, logs, screenshots, or analytics. Material
funds require multisig or cold custody, while automated roles require
policy-controlled KMS, HSM, or MPC references with mint allowlists and hard
transaction limits.

There is no credible zero-delay or zero-failure guarantee. Stale quotes,
excessive price impact, RPC disagreement, missing liquidity, bridge timeout, or
insufficient inventory must fail closed. Retrying an operation must not create
a second economic action.

## Required validation before mainnet

1. Local accounting, replay, duplicate, crash-recovery, proof, and burn tests.
2. Devnet tests with disposable tokens and both creator-fee paths.
3. Cross-chain testnet exercises only where a Solana route is unavailable.
4. A tiny capped mainnet canary with prefunded inventory and allowlisted users.
5. Independent security review, incident runbook, monitoring, exposure caps,
   reconciliation evidence, and legal and commercial approval.

## Primary references

- Pump public docs: <https://github.com/pump-fun/pump-public-docs>
- Pump creator fee sharing: <https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md>
- Official Fan Token address registry: <https://docs.chiliz.com/quick-start/token-contract-addresses>
- FanTokens catalog: <https://www.fantokens.com/>
- Jupiter developer docs: <https://dev.jup.ag/>
- LayerZero Value Transfer API: <https://docs.layerzero.network/v2/developers/value-transfer-api/overview>
- Helius fungible token indexing: <https://www.helius.dev/docs/das/fungible-token-extension>
- SPL token burn: <https://solana.com/docs/tokens/basics/burn-tokens>
