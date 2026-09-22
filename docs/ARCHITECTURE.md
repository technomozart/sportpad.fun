# SPORTPAD architecture

Status: product interface, private draft storage, wallet authentication, Pump
mainnet launch, immutable 80/20 routing, finalized fee indexing, exact Jupiter
swaps, holder indexing, time-weighted allocations, Fan Token payouts, and
SPORTPAD burn transactions are implemented. Every treasury transaction is
wallet-confirmed. Unattended signing remains locked, and SPORTPAD buyback waits
for the public SPORTPAD mint address.

## Implemented application path

```text
Launch builder
  -> POST /api/launch-drafts
  -> draft metadata in Cloudflare D1
  -> validated image bytes in private Cloudflare R2

Content review
  -> creator submits draft for review
  -> exact Sites user ID checked against the operator allowlist
  -> operator approves content
  -> only content_approved drafts may prepare Pump metadata or transactions

Wallet verification
  -> one-time signed challenge bound to solana:mainnet
  -> Ed25519 verification on the server
  -> opaque HttpOnly wallet session, hashed in D1

Saved draft devnet test
  -> creator accepts permanent public IPFS publication
  -> Pump metadata URI
  -> wallet-approved Pump V2 coin creation
  -> finalized creator, mint, and bonding-curve verification
  -> wallet-approved 8,000 / 2,000 bps creator-fee configuration
  -> finalized recipient and revoked-admin verification

Public discovery
  -> creator submits the verified devnet receipt for review
  -> exact wallet session and verified submissions checked again
  -> operator independently approves the receipt
  -> GET /api/public-launches
  -> D1 rows with status = devnet_published
  -> GET /api/public-launches/{id}/image for the stored image

Mainnet launch after content approval
  -> live Jupiter route check for the selected official Fan Token
  -> frozen creator wallet, metadata URI, and two platform treasuries
  -> wallet-approved Pump V2 coin creation with no initial buy
  -> wallet-approved one-time 8,000 / 2,000 bps fee lock
  -> independent finalized mainnet verification of both exact transactions
  -> D1 row with status = mainnet_published
  -> public receipt with mint, signatures, slots, and treasuries
```

The builder accepts a PNG, JPEG, or WebP image up to 5 MB through drag and drop
or a file picker. It validates the declared MIME type and file signature before
storing the object. Description is optional. A failed D1 insert triggers cleanup
of the newly uploaded R2 object.

Drafts are private by default. Devnet verification does not publish a draft.
The creator must reconnect the wallet that created the coin, accept the
devnet-only disclosure, and submit the receipt for review. That endpoint
rechecks both exact verified submissions and moves the row to `receipt_review`.
Only an allowlisted operator can approve it into `devnet_published`. The public
API omits owner IDs, wallet-session data, and a separate creator-wallet field,
while exposing the devnet mint, metadata URI, finalized transaction receipts,
configured fee recipients, and slots. The creator wallet remains discoverable
from the linked public Solana transaction. Product examples disappear when the
first approved receipt is published.

## Moderation and publication policy

Publication is fail closed. `SPORTPAD_PUBLICATION_MODE` accepts three values:

- `closed`: no content or receipt submissions and no approvals or restores.
  Operators can still reject or suspend items. This is also the fallback for a
  missing or invalid value.
- `moderated`: authenticated creators can submit drafts and verified receipts;
  an allowlisted operator must make each approval.
- `operator_only`: only operator-owned drafts can enter the beta workflow, and
  the same two review stages still apply.

`SPORTPAD_OPERATOR_USER_IDS` is a comma-separated allowlist of exact,
authenticated Sites user IDs. Operator authority never comes from a wallet
address, request body, browser state, or public profile field.

The lifecycle is explicit and one-directional except for documented retries:

```text
draft -> content_review -> content_approved -> devnet_verified
          content_review -> content_rejected

devnet_verified -> receipt_review -> devnet_published -> suspended
                   receipt_review -> receipt_rejected
                   suspended -> devnet_published

content_approved -> mainnet_published -> mainnet_suspended
                    mainnet_suspended -> mainnet_published
```

Creators can withdraw `content_review` back to `draft` and `receipt_review`
back to `devnet_verified`. Every state change compares the expected status and
monotonic moderation version before updating. A D1 trigger writes the actor,
role, action, reason, owner-facing message, from-state, to-state, and timestamp
to `launch_moderation_events` in the same database transaction.

Self-approval is disabled by default. `SPORTPAD_ALLOW_SELF_REVIEW=true` exists
only for a deliberately single-operator, valueless devnet beta and does not
remove the audit event. Production or mainnet operation requires separated
duties.

Public list, detail, and image routes select only `devnet_published` and
`mainnet_published` rows.
Suspension therefore removes all three surfaces immediately, and public images
use `no-store` caching so a takedown is not held by an application cache.

## Official Fan Token registry

The catalog currently contains 96 FanTokens entries:

- 82 selectable official Fan Tokens with exact Solana token addresses from the
  Chiliz registry and official token imagery. Fan Tokens are rooted in the
  Chiliz ecosystem and use an omnichain supply model across Chiliz Chain,
  Solana, and Base. The Solana address is not an independent SportPad copy.
- 14 catalog-only assets without a published official Solana address in the
  registry snapshot. They remain visible but are not given an invented route.

Every selected reward asset receives a live Jupiter route check before mainnet
signing. A published token address proves identity, not liquidity, inventory,
or execution readiness. A route check proves quote availability only; it does
not prove a funded reward vault or claim system.

## Data stores and migrations

- D1 stores launch drafts and the schemas reserved for fee events, settlements,
  reward epochs, reward claims, and service cursors. It also stores moderation
  audit events and fixed-window counters for abuse controls.
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
  Migration `0007` adds the explicit devnet publication timestamp. Migration
  `0008` adds moderation state and actor metadata, the moderation audit table,
  rate-limit windows, and the trigger that records each versioned moderation
  transition atomically. Migration `0009` adds frozen mainnet launch evidence,
  finalized slots, treasury addresses, and unique mint and signature indexes.
  Migration `0010` adds pause controls, worker runs and leases, idempotent
  settlement steps, reward vaults, holder epoch positions, treasury
  observations, and a protocol event ledger.
  Migration `0011` adds durable transaction-policy intents for the future
  managed signer boundary.
- Cloudflare bindings are named `DB` and `BUCKET`; credentials and signing keys
  are never stored in database rows.

The economic tables and control plane are durable production foundations. Their
presence does not mean that any transaction-signing worker is enabled.

## Execution control plane

Every economic lane defaults paused and also requires its own deployment flag,
worker authentication token, managed signer provider, lane-specific signer
reference, and other prerequisites such as the SPORTPAD mint. Missing any one
gate keeps that lane locked. A database row cannot override a missing deployment
flag or signer policy.

`POST /api/internal/workers/treasury` is the first worker boundary. It requires
a server-only bearer token and performs finalized Helius balance reads for the
two public treasuries. It writes observations, worker runs, and protocol events,
but it cannot create or sign a transaction. The operator console can trigger
the same read-only observation and can force all lanes into a paused state.

`POST /api/internal/workers/fees` is an authenticated, leased, read-only
indexer. It scans finalized activity for each published launch's exact Pump
sharing-config PDA. It records a fee event and reconciled settlement only when
the Pump program, instruction discriminator, mint, bonding curve, creator
vault, SOL quote mint, ordered treasury recipients, and observed 80/20 lamport
deltas all match. The cursor advances atomically with replay-safe records. A
scan backlog or ambiguous transaction fails closed.

Future transaction workers must record an idempotent `settlement_steps` row
before submission, verify finality through an independent read path, and write
the final signature and slot before advancing the settlement state machine.

## Implemented devnet coordinator

After content approval, the creator supplies two distinct public Solana
addresses, one for the 80% reward test recipient and one for the 20% SPORTPAD
test recipient. These are
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

## Implemented mainnet launch coordinator

The production launcher is a separate wallet-approved path. It is available
only when `MAINNET_EXECUTION_ENABLED=true` and two valid, distinct public Solana
addresses are configured as `SOLANA_REWARD_TREASURY_ADDRESS` and
`SOLANA_BUYBACK_TREASURY_ADDRESS`.

Immediately before signing, the server confirms the reviewed reward address is
still in the official registry and requests a live SOL-to-reward quote from
Jupiter. It then freezes the creator wallet, Pump metadata URI, 80% reward
treasury, and 20% SPORTPAD buyback treasury in D1. The creator wallet signs two
transactions: Pump V2 coin creation with no initial buy, followed by the
one-time fee-sharing configuration and admin revocation.

After finality, the server independently checks the exact instruction bytes,
program accounts, creator and mint signers, Token-2022 ownership, SOL-paired
bonding curve, both treasury recipients, exact 8,000 / 2,000 bps shares, and
revoked fee-share admin. Only then does the draft become
`mainnet_published`. Operators can suspend and restore the public receipt.

This launch coordinator does not sweep fees, execute a swap, credit a holder,
create a claim, buy SPORTPAD, or burn supply. Those are separate systems.

## Current readiness

- The interface, draft storage, wallet challenge, Pump transaction assembly,
  finalized verification, moderation state machine, and public receipt filters
  are implemented.
- Unit tests cover the moderation transitions and private-versus-public receipt
  boundary. Provider, wallet, type, lint, and production build checks remain
  release gates.
- A capped mainnet canary is still required after production treasury policy is
  established and before the launcher flag is enabled.
- The production public feed contains no approved receipt until that process
  completes. Example cards remain explicitly labeled and disappear only after
  the first approved receipt.
- Mainnet launch construction, exact receipt verification, operations state,
  pause controls, audit records, treasury observation, and finalized Pump fee
  ingestion are implemented. Custody, swaps, funded rewards, claims, SPORTPAD
  mint and burn, external security review, and legal approval remain separate
  work.

## Proposed economic model

The implemented launch configuration assigns qualifying Pump creator fees to
this split:

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

## Mainnet execution components

The following components are deployed behind the operator allowlist, database
pause controls, exact transaction intents, and matching treasury wallets:

1. **Settlement keeper**
   - Permissionlessly sweeps post-graduation Pump AMM creator fees and triggers
     Pump's distribution instruction after the operator wallet approves it.
   - Uses Jupiter only after quote age, depth, slippage, price-impact, mint
     allowlist, and daily-limit checks pass.

2. **Holder indexer and reward publisher**
   - Aggregates token accounts by owner and excludes controlled accounts.
   - Uses time-weighted token-seconds instead of an end-of-epoch snapshot.
   - Publishes only fully funded allocations with deterministic proofs and
     single-claim protection.

3. **SPORTPAD burn executor**
   - Buys the deployed SPORTPAD mint from the 20% share.
   - Calls an exact SPL burn after the buyback wallet approves it.
   - Remains inactive until `SPORTPAD_MINT_ADDRESS` identifies the deployed token.

4. **Optional cross-chain replenishment**
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
