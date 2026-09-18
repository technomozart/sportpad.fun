# Integration checklist

Mainnet execution is disabled. Current integrations support private draft
storage, public records, official asset identity, and read-only provider health.

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

### Official Fan Token data

- The selectable registry contains 82 exact Solana mints from the official
  Chiliz token address registry.
- Another 14 FanTokens catalog assets are displayed as catalog-only because the
  snapshot has no official Solana mint for them.
- Registry membership never enables swaps by itself. Liquidity, inventory, and
  canary checks are still required per asset.

### Read-only provider checks

- Helius API key for the health canary and future finalized indexing work.
- Jupiter API key for the health canary and future executable quote checks.
- Credentials stay server-side. Health responses are sanitized and do not
  expose keys, upstream payloads, or request URLs containing credentials.

The application can render without these provider keys, but their health checks
will report that configuration is unavailable.

## Future transaction stages

### Disposable Solana testing

- Policy-controlled references for disposable fee collector, reward vault, and
  SPORTPAD buyback executor signers.
- A disposable platform-token mint for buyback and burn verification.
- A written allowlist limited to official Fan Token Solana mints.
- Per-transaction and daily limits, pause controls, and independent RPC
  reconciliation.

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
