# SPORTPAD

[![CI](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml/badge.svg)](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/badge/live-sportpad.fun-9cff57)](https://sportpad.fun)
![Mainnet gated](https://img.shields.io/badge/mainnet-config_gated-ffd166)

SPORTPAD is a sports-native Solana launchpad. Creators can save a private
community-token draft, choose an official Fan Token reward, pass content review,
and launch a real Pump coin on Solana mainnet from their own wallet. The launch
locks Pump creator fees to two public treasury addresses: 80% for Fan Token
rewards and 20% for SPORTPAD buyback and burn. Mainnet execution fails closed
until those addresses and the explicit deployment flag are configured.

Live site: [sportpad.fun](https://sportpad.fun)

## What works today

- A responsive product site covering discovery, launch creation, rewards,
  matchday, official Fan Tokens, economics, policy, learning, SPORTPAD, and
  protocol transparency.
- A four-step private draft builder with a required drag-and-drop or file-picker
  token image. PNG, JPEG, and WebP files up to 5 MB are accepted. Description is
  optional.
- Draft metadata in Cloudflare D1 and uploaded draft images in private
  Cloudflare R2 objects.
- A fail-closed moderation queue. An operator must approve draft content before
  any Pump metadata upload or mainnet transaction can begin. Verified mainnet
  receipts are published only after the server independently matches both
  finalized transactions to the frozen draft and exact treasury addresses.
- A one-time signed wallet challenge that binds a Solana address to the signed-in
  account through an opaque, expiring, HttpOnly session. Seed phrases and private
  keys never enter the application. Phantom, Solflare, Backpack, Brave Wallet,
  and compatible injected Solana wallets are detected without storing a private key.
- Wallet-approved Pump mainnet coin creation with no initial buy and no Pump
  holder rewards. The server independently verifies the creator, Token-2022
  mint, SOL-paired bonding curve, and reviewed metadata before publication.
- A second wallet approval creates and permanently locks Pump fee sharing with
  exactly 8,000 bps sent to the configured reward treasury and 2,000 bps sent
  to the SPORTPAD buyback treasury. The server verifies both recipients and the
  revoked fee-share admin onchain.
- A live Jupiter route check for the selected official Fan Token before IPFS
  preparation or mainnet signing. Assets without an executable SOL route are
  blocked instead of being presented as launchable.
- A 96-asset FanTokens catalog view: 82 official Fan Tokens have published
  Solana token addresses in the Chiliz registry and are selectable; 14
  catalog-only assets are shown without an invented Solana address or route.
  Fan Tokens are rooted in the Chiliz ecosystem and use an omnichain supply
  model across Chiliz Chain, Solana, and Base. The Solana addresses are not
  separate SportPad copies.
- Public mainnet receipts with the mint, creation transaction, immutable fee
  lock transaction, finalized slots, exact 80/20 treasuries, and verification
  time. Suspended rows disappear immediately. Clearly marked product examples
  disappear when the first verified launch is published.
- D1-backed fixed-window limits for draft creation, wallet challenges, IPFS
  preparation, review submissions, and operator decisions. Failed limit checks
  stop the protected action instead of silently continuing.
- Read-only Helius and Jupiter health canaries with short timeouts, sanitized
  output, and cached health responses.
- Integer-safe accounting helpers and versioned D1 schemas for later fee,
  settlement, epoch, and claim processing.
- A durable execution control plane with independently paused settlement,
  rewards, claims, and buyback lanes; idempotent settlement steps; worker-run
  history; reward-vault accounting; holder epoch positions; and a protocol
  event ledger.
- A finalized, read-only treasury observer for the configured reward and
  buyback addresses. It records real SOL balances and slots without possessing
  or using a signing key. The authenticated operator screen exposes the live
  gates, records, observations, and an emergency pause action.
- A finalized Pump fee indexer that accepts only exact immutable 80/20
  distributions for published launches and deduplicates them by signature and
  instruction position. It cannot sign or move funds.

The interface does not display fabricated market caps, trading volume, holder
counts, reward balances, settlement events, or match results.

## Readiness snapshot

| Area | Current state |
| --- | --- |
| Product interface | Implemented and public |
| Private drafts and image storage | Implemented |
| Wallet authentication | Implemented for Solana mainnet wallets |
| Pump mainnet launch | Implemented behind content approval, route validation, treasury configuration, and two explicit wallet approvals |
| Public mainnet receipts | Independently verified onchain before publication; operator suspension supported |
| Production activation | Public treasuries configured; explicit execution approval and capped mainnet canary still required |
| Control plane, treasury observation, and fee ingestion | Implemented, read-only, and public-status visible |
| Fee sweeping, swaps, rewards, claims, burns | Durable schemas and safety gates implemented; transaction workers remain locked |

## Still not deployed

Automated fee sweeping, Jupiter swap execution, Fan Token vault custody,
holder snapshots, claims, cross-chain replenishment, and SPORTPAD burns are not
enabled. The control plane, worker authentication boundary, state machine,
pause controls, treasury observer, and finalized fee indexer are deployed. A verified launch
still proves only the Pump coin and immutable 80/20 fee destination; it does not
create a reward balance or claim.

Those later capabilities must remain locked until signer isolation, dependency
review, legal and commercial review, monitoring, capped canaries, and an
external security audit are complete.

Raw private keys and seed phrases do not belong in this repository, chat, or
local environment files. Production signers must use policy-controlled KMS,
HSM, or MPC references.

## Product routes

| Route | Purpose |
| --- | --- |
| `/` | Product overview and verified public-mainnet-receipt or example feed |
| `/discover` | Search verified launches, with examples only when the feed is empty |
| `/launches/[slug]` | Public mainnet receipt, legacy devnet receipt, or clearly marked example detail |
| `/launch` | Private four-step draft builder, moderation status, route validation, image upload, and gated Pump mainnet launcher |
| `/operator` | Authenticated infrastructure console and moderation queue; unavailable to users outside the exact allowlist |
| `/rewards` | Empty reward state until the reward system is deployed |
| `/fan-tokens` | Official Fan Token catalog and Solana token-address registry |
| `/matchday` | Empty matchday state until a real data source is connected |
| `/how-it-works` | Planned accounting and acquisition mechanics |
| `/transparency` | Provider health and deployment status |
| `/sport` | Planned SPORTPAD token status |
| `/learn` | Guides, glossary, and risk disclosure |
| `/policy` | Creator rules and mainnet readiness gates |

## Local development

Requirements: Node.js 22.13 or newer.

```powershell
npm run install:ci
Copy-Item .env.example .env.local
npm run dev
```

Add server-only Helius and Jupiter credentials to `.env.local`. Helius supports
provider checks and independent finalized mainnet verification. Jupiter is used
for a live read-only acquisition-route check. The file is ignored by Git.

Mainnet activation also requires `SOLANA_REWARD_TREASURY_ADDRESS` and
`SOLANA_BUYBACK_TREASURY_ADDRESS`. They must be valid, distinct public Solana
addresses. Keep `MAINNET_EXECUTION_ENABLED=false` until those addresses are
controlled under an audited operational policy and a capped mainnet canary is
approved. `SPORTPAD_MINT_ADDRESS` may remain empty until the token exists.

Publication also defaults closed. To accept reviewed launch submissions, set
`SPORTPAD_PUBLICATION_MODE` to `moderated` and put exact authenticated Sites
user IDs in the comma-separated `SPORTPAD_OPERATOR_USER_IDS` allowlist. The
alternative `operator_only` mode permits only operator-owned drafts to enter
review. Missing or invalid modes resolve to `closed`. Do not authorize an
operator by wallet address or client-supplied input.

Keep `SPORTPAD_ALLOW_SELF_REVIEW=false` for separated duties. Self-review is not
an acceptable production mainnet control.

Cloudflare deployments bind D1 as `DB` and R2 as `BUCKET`. Versioned D1
migrations live in `drizzle/`; migration `0002_eager_sentinels.sql` adds the R2
image metadata fields, and migration `0003_loving_jimmy_woo.sql` adds wallet
challenges, wallet sessions, and verified Pump devnet evidence. Migration
`0004_romantic_blue_blade.sql` adds durable pre-broadcast submissions and unique
devnet mint and signature constraints. Migration `0005_round_gwen_stacy.sql`
adds immutable creator and launch-configuration snapshots to each submission.
Migration `0006_fantastic_crusher_hogan.sql` persists the blockhash-invalidity
observation used for a guarded retry grace period. Migration
`0007_large_sphinx.sql` adds the explicit devnet receipt publication timestamp.
Migration `0008_whole_franklin_richards.sql` adds moderation state and actor
metadata, the immutable moderation-event audit trail, fixed-window rate-limit
storage, and the database trigger that records each versioned moderation
transition atomically. Migration `0009_confused_ender_wiggin.sql` adds the
mainnet mint, transaction receipts, slots, frozen treasury addresses, and
verification timestamp. Migration `0010_slimy_hercules.sql` adds protocol pause
controls, worker runs and leases, idempotent settlement steps, reward vaults,
holder epoch positions, treasury observations, and the protocol event ledger.
Migration `0011_lumpy_mockingbird.sql` adds durable transaction-policy intents
for the future managed signer boundary.

## Verification

```powershell
npm run test:protocol
npm run test:providers
npm run test:wallets
npm run lint
npx tsc --noEmit
npm run build
```

The same gates run in GitHub Actions for every pull request and push to `main`.

## Architecture and security

- [Architecture](docs/ARCHITECTURE.md)
- [Integration requirements](docs/INTEGRATIONS.md)
- [Security reporting](SECURITY.md)

The reward catalog identifies official Fan Tokens and their published Solana
token addresses. SPORTPAD community tokens are separate assets. Digital assets are
volatile and may lose all value.
