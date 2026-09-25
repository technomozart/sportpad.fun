# Integration checklist

Mainnet launch execution is currently paused. Current integrations support
private draft storage, signed Solana wallet sessions, wallet-approved Pump
mainnet launches, exact finalized onchain verification, public launch receipts,
official asset identity, and live read-only provider and reward-route checks.
The durable execution control plane, treasury observer, finalized Pump fee
indexer, wallet-confirmed fee distribution and swaps, holder accounting,
inventory-backed allocation code, Fan Token payout plans, and a SPORTPAD burn
builder are implemented. Automatic acquisition, payouts, bridging, and burns
are not live. See [current deployment and blockers](AUTOMATION.md).

## Implemented infrastructure

### Cloudflare D1

- Binding name: `DB`.
- Stores private launch drafts, legacy devnet receipts, and verified mainnet
  launch receipts selected by explicit public states.
- Stores the R2 object key, MIME type, and size for each uploaded image.
- Stores immutable moderation audit events and fixed-window rate-limit counters.
- Schema changes are versioned under `drizzle/`; apply every pending migration
  to each environment before deploying matching application code. Migration
  `0008_whole_franklin_richards.sql` is required for the moderation and abuse
  controls. `0009_confused_ender_wiggin.sql` adds mainnet receipt evidence and
  unique onchain identity constraints. `0010_slimy_hercules.sql` adds the
  execution control plane, worker records, settlement steps, reward accounting
  foundations, and treasury observations.
  `0011_lumpy_mockingbird.sql` adds durable transaction-policy intents for the
  managed signer boundary. `0012_exotic_peter_parker.sql` adds exact settlement
  transaction evidence. `0013_bright_molten_man.sql` adds finalized holder
  observation time, allocation totals, payout intents, and confirmed payout
  slots.

### Execution workers and signer policy

- `SPORTPAD_WORKER_TOKEN` authenticates internal scheduler calls. It is a
  server secret, not a wallet key.
- Two isolated Railway worker services have been deployed. Dedicated signing
  keys may be added only to those services' private variables; they are not
  stored in D1, Sites, source control, or chat. The services currently lack
  signer keys, and adding keys alone does not lift the financial gate.
- `SPORTPAD_FEE_INDEXER_ENABLED` gates the read-only finalized Pump fee indexer.
  It does not authorize signing or moving funds.
- `SPORTPAD_SETTLEMENT_ENABLED`, `SPORTPAD_REWARDS_ENABLED`,
  `SPORTPAD_HOLDER_INDEXER_ENABLED`, `SPORTPAD_CLAIMS_ENABLED`, and
  `SPORTPAD_BUYBACK_ENABLED` independently gate each lane and default false.
- Database pause controls default true. A lane remains unavailable while the
  static financial gate is closed, even if its deployment flag, signer, worker
  authentication, and pause controls otherwise pass.
- The treasury observer uses Helius only for finalized reads and writes real
  slots and lamport balances to D1. It has no signing capability.
- The Pump fee indexer scans each published launch's immutable sharing-config
  PDA. It accepts only finalized successful Pump distributions whose mint,
  PDAs, account order, frozen treasury recipients, and lamport deltas prove the
  exact 80/20 allocation. Signature plus instruction position makes ingestion
  replay-safe. Ambiguous activity stops the cursor.
- The holder indexer aggregates finalized Helius token accounts by on-curve
  owner, excludes creator and protocol-controlled wallets, accrues the previous
  balance over each measured interval, and records a deterministic snapshot hash.
- Reward epochs require acquired inventory that is not already funded to
  another epoch or reserved for an unpaid allocation. Holder-snapshot and
  receipt-verification hardening is still in progress.
- Fan Token payouts are exact `TransferChecked` transactions. The server binds
  the mint, treasury, recipient, amount, token program, blockhash, and message
  hash before the treasury wallet may sign.

### Cloudflare R2

- Binding name: `BUCKET`.
- Receives PNG, JPEG, or WebP draft images up to 5 MB after server-side type and
  signature checks.
- Objects remain private. A public launch image is served through an API that
  verifies the matching D1 record has `devnet_published` or
  `mainnet_published` status.
- Public image responses use `no-store`, so a suspension is not retained by an
  application cache.
- A failed draft insert removes the newly uploaded object.

### Sites identity and moderation

- Creator ownership and operator authorization use the trusted authenticated
  Sites user ID. A Solana wallet address never grants operator access.
- `SPORTPAD_PUBLICATION_MODE=closed` is the safe default and the fallback for a
  missing or invalid value. It blocks creator moderation actions and operator
  approvals or restores while keeping rejection and suspension available.
- `SPORTPAD_PUBLICATION_MODE=moderated` allows authenticated creators to submit
  content and verified receipts for separate operator decisions.
- `SPORTPAD_PUBLICATION_MODE=operator_only` limits submissions to drafts owned
  by an allowlisted operator. It does not skip either review stage.
- `SPORTPAD_OPERATOR_USER_IDS` is a comma-separated list of exact authenticated
  Sites user IDs. Client input, wallet ownership, display names, and email text
  are not accepted as substitutes.
- `SPORTPAD_ALLOW_SELF_REVIEW=false` preserves separated duties. Self-review is
  not an acceptable mainnet control.
- Content must be approved before Pump metadata can be placed on public IPFS or
  any mainnet transaction can be prepared.
- Operator decisions use expected moderation versions and database
  compare-and-set updates. A D1 trigger records each successful versioned
  moderation transition in `launch_moderation_events` in the same database
  transaction.

### Solana wallet verification

- The browser requests a five-minute, single-use challenge bound to the current
  domain, URI, wallet address, and `solana:mainnet`.
- The server verifies the Ed25519 signature and stores only a hash of a random
  24-hour session token in D1.
- The browser receives an HttpOnly, SameSite wallet-session cookie. Connecting
  a wallet alone never authenticates a launch request.
- Phantom, Solflare, Backpack, Brave Wallet, and compatible injected Solana
  providers are detected. The selected provider is used consistently for the
  challenge and transaction approvals.
- Every mainnet transaction requires a separate wallet approval.

### Pump mainnet launcher

- `MAINNET_EXECUTION_ENABLED=true` is required together with valid, distinct
  `SOLANA_REWARD_TREASURY_ADDRESS` and
  `SOLANA_BUYBACK_TREASURY_ADDRESS` values. Missing or invalid configuration
  fails closed.
- The creator's verified wallet must differ from both platform treasuries.
- The selected reward must match the official registry and pass its
  chain-specific route policy immediately before signing. Only the Solana
  subset is selectable today and uses a Jupiter SOL route. Chiliz rewards
  remain paused until direct acquisition and claims of current V2 contracts
  are proven with a prefunded CHZ treasury.
- The first wallet approval creates the Pump V2 Token-2022 coin with no initial
  buy. The second creates and irrevocably locks the exact 8,000 / 2,000 bps
  creator-fee recipients.
- Helius mainnet RPC independently verifies both finalized transactions,
  instruction bytes, accounts, signers, bonding curve, treasuries, fee shares,
  and revoked admin before publication.
- Operators can immediately suspend a verified mainnet launch from public list,
  detail, and image routes. Restore revalidates the stored evidence shape.

### Pump devnet

- The saved draft image and metadata are uploaded through Pump's metadata
  endpoint only after content approval and after the user explicitly accepts
  permanent public IPFS publication and starts the devnet flow.
- The creator wallet signs Pump V2 coin creation with no initial buy, mayhem,
  cashback, or Pump holder-reward mode.
- The creator wallet separately signs an exact 8,000 / 2,000 bps fee-sharing
  configuration for the two creator-supplied devnet recipient addresses.
- SportPad verifies finalized transactions, program ownership, creator state,
  the Token-2022 mint, exact shareholders, and revoked fee-share admin before
  marking a draft devnet-verified.
- Devnet verification remains private. The creator must submit the verified
  receipt with the same wallet session and a devnet-only acknowledgement. The
  submission enters `receipt_review`; it does not publish directly. An
  allowlisted operator rechecks the verified evidence before approval. The
  public record exposes the metadata URI, configured recipient addresses, and
  transaction receipts, not owner or session data. The creator wallet is still
  discoverable from the linked public Solana transaction.
- Signed evidence is persisted in D1 before broadcast. Unique mint and signature
  indexes plus compare-and-set final writes prevent duplicate or racing launches.
- Community-launch Pump creator fees accrue in program vaults and still require
  later sweeping and distribution. The 80/20 configuration does not itself buy
  Fan Tokens or burn SPORTPAD. The configured SPORTPAD mint is excluded from
  this flow, so its own creator fees remain with the project for development.

### Official Fan Token data

- Fan Tokens are rooted in the Chiliz ecosystem and now use an omnichain supply
  model across Chiliz Chain, Solana, and Base through LayerZero.
- The catalog contains 82 exact Solana token addresses from the official
  Chiliz token address registry. These identify official Fan Tokens on Solana,
  not independent SportPad copies or proof of executable Jupiter liquidity.
- Another 14 FanTokens catalog assets are displayed as catalog-only because the
  snapshot has no official Solana token address for them.
- The 78 Chiliz catalog entries now identify official 18-decimal V2 contracts
  from Chiliz's 2026 migration table. Historical 0-decimal contracts and Kayen
  wrappers are retained only as legacy references. Read-only direct V2 Kayen
  quotes are not a verified execution, inventory, or payout route.
- Registry membership never enables swaps by itself. Liquidity, inventory, and
  canary checks are still required per asset.

### Provider checks and verification

- Helius API key for the health canary and finalized mainnet verification.
- Jupiter API key for the health canary and live reward-route checks.
- Credentials stay server-side. Health responses are sanitized and do not
  expose keys, upstream payloads, or request URLs containing credentials.

The application can render without these provider keys, but their health checks
will report that configuration is unavailable.

## Enforced application limits

The current D1 fixed-window limits are:

| Action | Limit |
| --- | --- |
| Draft creation | 10 per authenticated account per hour and 25 per day |
| Saved drafts returned to a creator | 20 most recent drafts |
| Wallet challenge | 10 per authenticated account per 10 minutes |
| Wallet challenge for one address | 5 per wallet address per 10 minutes |
| Pump mainnet IPFS preparation | 3 per account and verified wallet pair per hour, with a 5 per day cap |
| Content review submission | 3 per authenticated creator per day |
| Receipt review submission | 3 per authenticated creator per day |
| Operator decisions | 30 per operator per minute |

Rate-limit failures return `429` with limit and remaining headers plus
`Retry-After`. If a protected limit cannot be checked, the action fails closed.
These controls reduce accidental and automated abuse; they do not replace
mainnet transaction caps, signer policy, monitoring, or incident response.

## Readiness boundary

- Implemented: private drafts, image validation and storage, Solana mainnet
  wallet sessions, Pump transaction construction, local pre-broadcast evidence,
  finalized mainnet verification, content moderation, public receipt filtering,
  operator suspension, read-only Helius and Jupiter checks, execution controls,
  worker authentication, treasury observations, and finalized Pump fee
  ingestion.
- Activation still requires dedicated worker signers, chain-receipt and ledger
  verification, funded route checks, independent review, and capped canaries.
  The two public Solana receive addresses are configured but currently have
  no automated signing keys in Railway.
- Locked: public mainnet launch, financial settlement, treasury swap
  automation, funded reward claims, SPORTPAD buyback and burn, and cross-chain
  replenishment. Read-only observations are not a claim of execution readiness.

## Remaining mainnet transaction stages

- Dedicated signing keys installed privately in the matching Railway workers,
  with strict float limits and an upgrade path to policy-controlled signing.
- A deployed and independently verified SPORTPAD mint for buyback and burn.
- A written allowlist of official Fan Token assets with verified chain-specific
  liquidity and inventory routes.
- Per-transaction and daily limits, pause controls, monitoring, and independent
  RPC reconciliation.

### Cross-chain inventory for Chiliz rewards

- The verified direct Solana CHZ OFT to native Chiliz CHZ route; no LayerZero Value Transfer API key is required for this route.
- Production Chiliz RPC provider plus a second read-only endpoint.
- Policy-controlled Chiliz replenisher signer with CHZ gas and strict limits.
- A tested route, decimal conversion, destination funding, timeout policy, and
  inventory threshold for every enabled token.

Cross-chain replenishment must be asynchronous treasury inventory management.
It must not present a quote as funded inventory, and it must not block a user's
claim after that claim has already been backed by acquired inventory.

## Never provide

Do not paste or upload a private key, seed phrase, keystore, or raw signing
secret to chat, source control, D1, the public website, or Sites variables.
Only dedicated low-balance hot-wallet private keys may be placed directly in
the matching Railway worker's private service variables; a seed phrase should
never be used for that purpose.
