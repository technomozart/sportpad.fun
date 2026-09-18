# Integration checklist

No credentials are required for the private interface prototype. The following are needed only as each execution stage is enabled.

## Stage 1 — read-only canary

- Helius API key for finalized balance/indexing data and replay.
- Jupiter API key for executable quotes and swap transaction construction.
- A second independent Solana RPC endpoint for reconciliation.

## Stage 2 — disposable transactions

- Policy-controlled references for disposable Solana fee collector, reward vault, and buyback executor signers.
- A disposable platform token mint for buy-and-burn verification.
- Treasury limits and a written allowlist of official Fan Token Solana mints.

## Stage 3 — cross-chain inventory, only if needed

- LayerZero Value Transfer API key.
- Production Chiliz RPC provider and a second read-only endpoint.
- Policy-controlled Chiliz replenisher signer with CHZ gas and strict limits.
- Tested route, decimals, destination ATA funding, timeout policy, and inventory threshold per token.

## Never provide

Do not paste or upload a production private key, seed phrase, keystore, or raw signing secret. The application consumes a signer reference supplied by a secret manager or transaction-policy service.

