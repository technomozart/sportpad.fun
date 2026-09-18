# Integration checklist

Mainnet execution is disabled. Current integrations support private draft
storage, signed Solana wallet sessions, wallet-approved Pump devnet launches,
finalized onchain verification, public records, official asset identity, and
read-only provider health.

## Implemented infrastructure

### Cloudflare D1

- Binding name: `DB`.
- Stores private launch drafts and public rows selected by `status = live`.
- Stores the R2 object key, MIME type, and size for each uploaded image.
- Schema changes are versioned under `drizzle/`; apply every pending migration
  to each environment before deploying matching application code.

### Cloudflare R2

- Binding name: `BUCKET`.
- Receives PNG, JPEG, or WebP draft images up to 5 MB after server-side type and
  signature checks.
- Objects remain private. A public launch image is served through an API that verifies
  the matching D1 record has `live` status.
- A failed draft insert removes the newly uploaded object.

### Solana wallet verification

- The browser requests a five-minute, single-use challenge bound to the current
  domain, URI, wallet address, and `solana:devnet`.
- The server verifies the Ed25519 signature and stores only a hash of a random
  24-hour session token in D1.
- The browser receives an HttpOnly, SameSite wallet-session cookie. Connecting
  a wallet alone never authenticates a launch request.
- Every devnet transaction still requires a separate wallet approval.

### Pump devnet

- The saved draft image and metadata are uploaded through Pump's metadata
  endpoint only after the user explicitly accepts public IPFS publication and
  starts the devnet flow.
- The creator wallet signs Pump V2 coin creation with no initial buy, mayhem,
  cashback, or Pump holder-reward mode.
- The creator wallet separately signs an exact 8,000 / 2,000 bps fee-sharing
  configuration for the reward and SPORTPAD treasury addresses.
- SportPad verifies finalized transactions, program ownership, creator state,
  the Token-2022 mint, exact shareholders, and revoked fee-share admin before
  marking a draft devnet-verified.
- Signed evidence is persisted in D1 before broadcast. Unique mint and signature
  indexes plus compare-and-set final writes prevent duplicate or racing launches.
- Pump creator fees accrue in program vaults and still require later sweeping
  and distribution. The 80/20 configuration does not itself buy Fan Tokens or
  burn SPORTPAD.

### Official Fan Token data

- The selectable registry contains 82 exact Solana mints from the official
  Chiliz token address registry.
- Another 14 FanTokens catalog assets are displayed as catalog-only because the
  snapshot has no official Solana mint for them.
- Registry membership never enables swaps by itself. Liquidity, inventory, and
  canary checks are still required per asset.

### Provider checks and verification

- Helius API key for the health canary and finalized devnet verification.
- Jupiter API key for the health canary and future executable quote checks.
- Credentials stay server-side. Health responses are sanitized and do not
  expose keys, upstream payloads, or request URLs containing credentials.

The application can render without these provider keys, but their health checks
will report that configuration is unavailable.

## Future mainnet transaction stages

- Policy-controlled references for the reward treasury, reward vault, and
  SPORTPAD buyback executor signers.
- A deployed and independently verified SPORTPAD mint for buyback and burn.
- A written allowlist limited to official Fan Token Solana mints with verified
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
