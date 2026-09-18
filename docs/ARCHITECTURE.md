# SPORTPAD architecture

Status: product interface and private draft storage are implemented. Mainnet
execution is deliberately disabled.

## Implemented application path

```text
Launch builder
  -> POST /api/launch-drafts
  -> draft metadata in Cloudflare D1
  -> validated image bytes in private Cloudflare R2

Public discovery
  -> GET /api/public-launches
  -> D1 rows with status = live
  -> GET /api/public-launches/{id}/image for the stored image
```

The builder accepts a PNG, JPEG, or WebP image up to 5 MB through drag and drop
or a file picker. It validates the declared MIME type and file signature before
storing the object. Description is optional. A failed D1 insert triggers cleanup
of the newly uploaded R2 object.

Drafts are private by default. The public API reads only rows explicitly marked
`live`; that status means published in the SPORTPAD interface, not minted or
tradable onchain. Product examples are clearly labeled and shown only when the
public feed is available and contains no live rows. Any live row replaces the
examples automatically.

## Official Fan Token registry

The catalog currently contains 96 FanTokens entries:

- 82 selectable assets with exact Solana mints from the official Chiliz token
  address registry and official token imagery.
- 14 catalog-only assets without a published official Solana mint in the
  registry snapshot. They remain visible but are not given an invented route.

Every reward asset is marked `not_enabled`. A published mint proves identity,
not liquidity, inventory, or execution readiness.

## Data stores and migrations

- D1 stores launch drafts and the schemas reserved for fee events, settlements,
  reward epochs, reward claims, and service cursors.
- R2 stores uploaded draft images under per-draft object keys. D1 stores only
  the object key, MIME type, and byte size.
- Drizzle migrations are versioned in `drizzle/`. Migration `0002` adds the
  image metadata columns required by the upload flow.
- Cloudflare bindings are named `DB` and `BUCKET`; credentials and signing keys
  are never stored in database rows.

The fee, settlement, epoch, and claim tables are forward-looking schemas. Their
presence does not mean those workers, programs, or economic actions are live.

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

## Planned execution components

None of the following are deployed today:

1. **Launch coordinator**
   - Creates the Solana community-token mint.
   - Configures an exact 8,000 bps reward share and 2,000 bps SPORTPAD buyback
     share before public trading.
   - Verifies addresses and basis points before finalizing any authority.

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
