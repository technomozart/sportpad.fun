# Integration checklist

Mainnet execution is disabled. Current integrations support private draft
storage, signed Solana wallet sessions, wallet-approved Pump devnet launches,
finalized onchain verification, moderated public records, official asset
identity, and read-only provider health. The devnet path still requires a fresh
end-to-end release canary before it is treated as operational.

## Implemented infrastructure

### Cloudflare D1

- Binding name: `DB`.
- Stores private launch drafts and operator-approved devnet receipts selected by
  `status = devnet_published`.
- Stores the R2 object key, MIME type, and size for each uploaded image.
- Stores immutable moderation audit events and fixed-window rate-limit counters.
- Schema changes are versioned under `drizzle/`; apply every pending migration
  to each environment before deploying matching application code. Migration
  `0008_whole_franklin_richards.sql` is required for the moderation and abuse
  controls.

### Cloudflare R2

- Binding name: `BUCKET`.
- Receives PNG, JPEG, or WebP draft images up to 5 MB after server-side type and
  signature checks.
- Objects remain private. A public launch image is served through an API that
  verifies the matching D1 record has `devnet_published` status.
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
- `SPORTPAD_ALLOW_SELF_REVIEW=false` preserves separated duties. Setting it to
  `true` is limited to a deliberately single-operator, valueless devnet beta.
  The decision is still audited, but this flag is not an acceptable mainnet
  control.
- Content must be approved before Pump metadata can be placed on public IPFS or
  any devnet transaction can be prepared. A separately approved receipt is the
  only path into `devnet_published`.
- Operator decisions use expected moderation versions and database
  compare-and-set updates. A D1 trigger records each successful versioned
  moderation transition in `launch_moderation_events` in the same database
  transaction.

### Solana wallet verification

- The browser requests a five-minute, single-use challenge bound to the current
  domain, URI, wallet address, and `solana:devnet`.
- The server verifies the Ed25519 signature and stores only a hash of a random
  24-hour session token in D1.
- The browser receives an HttpOnly, SameSite wallet-session cookie. Connecting
  a wallet alone never authenticates a launch request.
- Phantom, Solflare, Backpack, Brave Wallet, and compatible injected Solana
  providers are detected. The selected provider is used consistently for the
  challenge and transaction approvals.
- Every devnet transaction still requires a separate wallet approval.

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
- Pump creator fees accrue in program vaults and still require later sweeping
  and distribution. The 80/20 configuration does not itself buy Fan Tokens or
  burn SPORTPAD.

### Official Fan Token data

- Fan Tokens are rooted in the Chiliz ecosystem and now use an omnichain supply
  model across Chiliz Chain, Solana, and Base through LayerZero.
- The selectable registry contains 82 exact Solana token addresses from the
  official Chiliz token address registry. These identify official Fan Tokens
  on Solana, not independent SportPad copies.
- Another 14 FanTokens catalog assets are displayed as catalog-only because the
  snapshot has no official Solana token address for them.
- Registry membership never enables swaps by itself. Liquidity, inventory, and
  canary checks are still required per asset.

### Provider checks and verification

- Helius API key for the health canary and finalized devnet verification.
- Jupiter API key for the health canary and future executable quote checks.
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
| Pump IPFS preparation | 5 per account and verified wallet pair per hour, with a stricter 3 per day cap |
| Content review submission | 3 per authenticated creator per day |
| Receipt review submission | 3 per authenticated creator per day |
| Operator decisions | 30 per operator per minute |

Rate-limit failures return `429` with limit and remaining headers plus
`Retry-After`. If a protected limit cannot be checked, the action fails closed.
These controls reduce accidental and automated abuse; they do not replace
mainnet transaction caps, signer policy, monitoring, or incident response.

## Readiness boundary

- Implemented: private drafts, image validation and storage, Solana devnet
  wallet sessions, Pump transaction construction, durable pre-broadcast
  evidence, finalized verification, two-stage moderation, public receipt
  filtering, and read-only Helius and Jupiter checks.
- Still required for the devnet beta: a fresh end-to-end canary using a newly
  controlled wallet and valueless devnet SOL, followed by verification of the
  approved public receipt and suspension path.
- Not deployed: mainnet token creation, fee sweeping or ingestion, treasury
  custody, Jupiter execution, official Fan Token acquisition, holder
  accounting, claims, SPORTPAD mint or burns, and cross-chain replenishment.
- Mainnet remains locked until capped canaries, signer isolation, monitoring,
  independent security review, and legal and commercial approval are complete.

## Future mainnet transaction stages

- Policy-controlled references for the reward treasury, reward vault, and
  SPORTPAD buyback executor signers.
- A deployed and independently verified SPORTPAD mint for buyback and burn.
- A written allowlist limited to official Fan Token Solana addresses with verified
  liquidity and inventory routes.
- Per-transaction and daily limits, pause controls, monitoring, and independent
  RPC reconciliation.

### Cross-chain inventory, only if required

- LayerZero Value Transfer API access.
- Production Chiliz RPC provider plus a second read-only endpoint.
- Policy-controlled Chiliz replenisher signer with CHZ gas and strict limits.
- A tested route, decimal conversion, destination funding, timeout policy, and
  inventory threshold for every enabled token.

Cross-chain replenishment must be asynchronous treasury inventory management.
It must not block a user's Solana reward claim.

## Never provide

Do not paste or upload a production private key, seed phrase, keystore, or raw
signing secret. The application should consume a signer reference supplied by a
secret manager or transaction-policy service.
