# SportPad

[![CI](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml/badge.svg)](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/badge/live-sportpad.fun-9cff57)](https://sportpad.fun)
![Mainnet locked](https://img.shields.io/badge/mainnet-locked-ff8f94)

SportPad is a sports-native Solana launchpad prototype. It lets creators build
private community-token drafts, associate them with verified Fan Token reward
assets, and inspect a proposed 80% reward / 20% SPORT buyback-and-burn flow.

Live site: [sportpad.fun](https://sportpad.fun)

## What works today

- Twelve responsive product routes covering discovery, launch creation, rewards,
  matchday context, Fan Token verification, economics, policy, learning, SPORT,
  and protocol transparency.
- Search, filters, market views, interactive chart fixtures, estimators, reward
  previews, accordions, wallet detection, and a four-step draft builder.
- Private launch-draft persistence in Cloudflare D1.
- Read-only Helius and Jupiter health canaries with short timeouts, sanitized
  output, and cached health responses.
- Integer-safe 80/20 accounting, time-weighted reward allocation, idempotent fee
  ingestion identifiers, and settlement/epoch/claim schemas.
- Exact Solana Fan Token mints sourced from the official Chiliz registry.

All market rows, balances, reward events, and launch concepts shown in the UI are
clearly labeled demo fixtures.

## Intentionally disabled

Token creation, trading, creator-fee collection, swaps, signing, custody,
cross-chain replenishment, SPORT burns, and reward claims are hard-locked. They
must not be enabled until signer isolation, rate limits, dependency upgrades,
contract review, legal/commercial review, monitoring, capped canaries, and an
external security audit are complete.

Raw private keys and seed phrases do not belong in this repository or in local
environment files. Production signers must use policy-controlled KMS, HSM, or
MPC references.

## Product routes

| Route | Purpose |
| --- | --- |
| `/` | Product overview and protocol story |
| `/discover` | Searchable launch-concept market |
| `/launches/[slug]` | Interactive concept detail |
| `/launch` | Private four-step draft builder |
| `/rewards` | Holder reward dashboard preview |
| `/fan-tokens` | Verified Fan Token registry and history |
| `/matchday` | Sports-native fixture context |
| `/how-it-works` | Accounting and acquisition mechanics |
| `/transparency` | Provider health and demo evidence ledger |
| `/sport` | Planned SPORT token status |
| `/learn` | Guides, glossary, and risk disclosure |
| `/policy` | Creator rules and mainnet readiness gates |

## Local development

Requirements: Node.js 22.13 or newer.

```powershell
npm run install:ci
Copy-Item .env.example .env.local
npm run dev
```

Add server-only Helius and Jupiter credentials to `.env.local`. That file is
ignored by Git. Leave `MAINNET_EXECUTION_ENABLED=false`.

```dotenv
HELIUS_API_KEY=
JUPITER_API_KEY=
MAINNET_EXECUTION_ENABLED=false
```

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

Community-created tokens are not club-issued. SportPad is not affiliated with
or endorsed by any club, league, Chiliz, Socios.com, or FanTokens. Digital
assets are volatile and may lose all value.
