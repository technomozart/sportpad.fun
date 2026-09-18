# SPORTPAD

[![CI](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml/badge.svg)](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/badge/live-sportpad.fun-9cff57)](https://sportpad.fun)
![Mainnet locked](https://img.shields.io/badge/mainnet-locked-ff8f94)

SPORTPAD is a sports-native Solana launchpad interface. Creators can save a
private community-token draft, choose an official Fan Token as its planned
holder reward, and review the proposed 80% Fan Token rewards / 20% SPORTPAD
buyback + burn model. Saved drafts can also run the real Pump coin-creation and
creator-fee configuration path on Solana devnet with valueless test SOL.

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
- A one-time signed wallet challenge that binds a Solana address to the signed-in
  account through an opaque, expiring, HttpOnly session. Seed phrases and private
  keys never enter the application.
- Wallet-approved Pump devnet coin creation with no initial buy, no Pump holder
  rewards, and server-side verification of the finalized creator and bonding
  curve state.
- A wallet-approved Pump fee-sharing configuration with exactly 8,000 bps sent
  to the reward treasury and 2,000 bps sent to the SPORTPAD treasury. The server
  verifies both recipients and the revoked fee-share admin onchain before marking
  the draft verified.
- A 96-asset FanTokens catalog view: 82 assets have official Solana mints in the
  Chiliz registry and are selectable; 14 catalog-only assets are shown without
  an invented Solana address or execution route.
- A public launch feed backed by D1 rows whose status is `live`. Clearly marked
  product examples appear only while there are no public launch records and are
  removed automatically when the first public record appears.
- Read-only Helius and Jupiter health canaries with short timeouts, sanitized
  output, and cached health responses.
- Integer-safe accounting helpers and versioned D1 schemas for later fee,
  settlement, epoch, and claim processing.

The interface does not display fabricated market caps, trading volume, holder
counts, reward balances, settlement events, or match results.

## Intentionally disabled

Mainnet token creation and trading, automated fee collection, Jupiter swaps,
Fan Token acquisition, custody, cross-chain replenishment, SPORTPAD burns, and
reward claims are not deployed. The devnet launcher creates only a valueless
test coin and fee-share configuration. A saved draft or a `live` public record
is not a mainnet launch.

Those capabilities must remain locked until signer isolation, rate limits,
dependency review, legal and commercial review, monitoring, capped canaries,
and an external security audit are complete.

Raw private keys and seed phrases do not belong in this repository, chat, or
local environment files. Production signers must use policy-controlled KMS,
HSM, or MPC references.

## Product routes

| Route | Purpose |
| --- | --- |
| `/` | Product overview and honest public-launch or example feed |
| `/discover` | Search public launch records, with examples only when the feed is empty |
| `/launches/[slug]` | Public launch or clearly marked example detail |
| `/launch` | Private four-step draft builder, image upload, and Pump devnet test launcher |
| `/rewards` | Empty reward state until the reward system is deployed |
| `/fan-tokens` | Official Fan Token catalog and Solana mint registry |
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

Cloudflare deployments bind D1 as `DB` and R2 as `BUCKET`. Versioned D1
migrations live in `drizzle/`; migration `0002_eager_sentinels.sql` adds the R2
image metadata fields, and migration `0003_loving_jimmy_woo.sql` adds wallet
challenges, wallet sessions, and verified Pump devnet evidence. Migration
`0004_romantic_blue_blade.sql` adds durable pre-broadcast submissions and unique
devnet mint and signature constraints. Migration `0005_round_gwen_stacy.sql`
adds immutable creator and launch-configuration snapshots to each submission.
Migration `0006_fantastic_crusher_hogan.sql` persists the blockhash-invalidity
observation used for a guarded retry grace period.

## Verification

```powershell
npm run test:protocol
npm run test:providers
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
mints. SPORTPAD community tokens are separate assets. Digital assets are
volatile and may lose all value.
