# SPORTPAD

[![CI](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml/badge.svg)](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/badge/live-sportpad.fun-9cff57)](https://sportpad.fun)
![Mainnet locked](https://img.shields.io/badge/mainnet-locked-ff8f94)

SPORTPAD is a sports-native Solana launchpad interface. Creators can save a
private community-token draft, choose an official Fan Token as its planned
holder reward, and review the proposed 80% Fan Token rewards / 20% SPORTPAD
buyback + burn model. Saved drafts can also run the real Pump coin-creation and
creator-fee configuration path on Solana devnet with valueless test SOL after
content review. Verified receipts require a second operator decision before they
can appear publicly.

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
- A fail-closed, two-stage moderation queue. An operator must approve draft
  content before any Pump metadata upload or devnet transaction can begin, then
  separately approve the verified onchain receipt before it becomes public.
  Every transition uses compare-and-set versioning and writes a D1 audit event.
- A one-time signed wallet challenge that binds a Solana address to the signed-in
  account through an opaque, expiring, HttpOnly session. Seed phrases and private
  keys never enter the application. Phantom, Solflare, Backpack, Brave Wallet,
  and compatible injected Solana wallets are detected without storing a private key.
- Wallet-approved Pump devnet coin creation with no initial buy, no Pump holder
  rewards, and server-side verification of the finalized creator and bonding
  curve state.
- A wallet-approved Pump fee-sharing configuration with exactly 8,000 bps sent
  to the configured reward test recipient and 2,000 bps sent to the configured
  SPORTPAD test recipient. The server verifies both recipients and the revoked
  fee-share admin onchain before marking the draft verified.
- A 96-asset FanTokens catalog view: 82 official Fan Tokens have published
  Solana token addresses in the Chiliz registry and are selectable; 14
  catalog-only assets are shown without an invented Solana address or route.
  Fan Tokens are rooted in the Chiliz ecosystem and use an omnichain supply
  model across Chiliz Chain, Solana, and Base. The Solana addresses are not
  separate SportPad copies.
- A creator-submitted, operator-approved public receipt flow for independently
  verified Solana devnet launches. Only rows explicitly approved into
  `devnet_published` appear, with their devnet mint, transaction signatures, and
  finalized slots. Suspended rows disappear immediately. Clearly marked product
  examples disappear when the first approved receipt is published.
- D1-backed fixed-window limits for draft creation, wallet challenges, IPFS
  preparation, review submissions, and operator decisions. Failed limit checks
  stop the protected action instead of silently continuing.
- Read-only Helius and Jupiter health canaries with short timeouts, sanitized
  output, and cached health responses.
- Integer-safe accounting helpers and versioned D1 schemas for later fee,
  settlement, epoch, and claim processing.

The interface does not display fabricated market caps, trading volume, holder
counts, reward balances, settlement events, or match results.

## Readiness snapshot

| Area | Current state |
| --- | --- |
| Product interface | Implemented and public |
| Private drafts and image storage | Implemented |
| Wallet authentication | Implemented for Solana devnet |
| Pump devnet path | Implemented behind content approval and explicit wallet approvals |
| Public devnet receipts | Moderated only; the production feed remains empty until a verified receipt is approved |
| Fresh release canary | Still required with a newly controlled, valueless devnet wallet before the beta is called operational |
| Mainnet economic execution | Locked and not deployed |

## Intentionally disabled

Mainnet token creation and trading, automated fee collection, Jupiter swaps,
Fan Token acquisition, custody, cross-chain replenishment, SPORTPAD burns, and
reward claims are not deployed. The devnet launcher creates only a valueless
test coin and fee-share configuration. A saved draft or a public devnet receipt
is not a mainnet launch.

Those capabilities must remain locked until signer isolation, dependency
review, legal and commercial review, monitoring, capped canaries, and an
external security audit are complete. Application rate limits now protect the
devnet and moderation surfaces, but they are only one mainnet readiness gate.

Raw private keys and seed phrases do not belong in this repository, chat, or
local environment files. Production signers must use policy-controlled KMS,
HSM, or MPC references.

## Product routes

| Route | Purpose |
| --- | --- |
| `/` | Product overview and honest public-devnet-receipt or example feed |
| `/discover` | Search public devnet receipts, with examples only when the feed is empty |
| `/launches/[slug]` | Public devnet receipt or clearly marked example detail |
| `/launch` | Private four-step draft builder, moderation status, image upload, and approved Pump devnet test launcher |
| `/operator` | Authenticated operator moderation queue; unavailable to users outside the exact allowlist |
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
the provider check and independent finalized devnet verification. Jupiter is
used only for its read-only health canary in this release. The file is ignored
by Git. Keep `MAINNET_EXECUTION_ENABLED=false`.

Publication also defaults closed. For an intentionally opened devnet beta, set
`SPORTPAD_PUBLICATION_MODE` to `moderated` and put exact authenticated Sites
user IDs in the comma-separated `SPORTPAD_OPERATOR_USER_IDS` allowlist. The
alternative `operator_only` mode permits only operator-owned drafts to enter
review. Missing or invalid modes resolve to `closed`. Do not authorize an
operator by wallet address or client-supplied input.

Keep `SPORTPAD_ALLOW_SELF_REVIEW=false` for separated duties. Setting it to
`true` is only acceptable for a deliberately single-operator, valueless devnet
beta, and decisions are still recorded in the moderation audit trail. It is not
an acceptable mainnet control.

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
transition atomically.

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
