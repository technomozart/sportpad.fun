# SPORTPAD

[![CI](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml/badge.svg)](https://github.com/technomozart/sportpad.fun/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/badge/live-sportpad.fun-9cff57)](https://sportpad.fun)
![Mainnet paused](https://img.shields.io/badge/mainnet-execution_paused-f4b860)

SPORTPAD is a sports-native Solana launchpad. Creators can save a private
community-token draft and choose an official Fan Token reward. The Pump mainnet
launcher and 80/20 creator-fee route are implemented but **public mainnet
execution is currently paused**. The intended route sends 80% of a community
launch's creator fees toward Fan Token rewards and 20% toward buying and burning
SPORTPAD. SPORTPAD's own creator fees are excluded and retained for project
development. Do not interpret a public website or running worker as a live
reward, claim, bridge, or burn service.

Live site: [sportpad.fun](https://sportpad.fun)

## Implemented components and current hold

The interface and private drafting workflow are public. Economic execution is
held by `MAINNET_EXECUTION_ENABLED=false` and the static financial-ledger gate
while signer setup, receipt verification, bridge funding, and canaries remain
unfinished. The capabilities below describe code paths, not a promise that all
paths can be used with real funds today.

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
- A gated wallet-approved Pump mainnet coin creation path with no initial buy and no Pump
  holder rewards. The server independently verifies the creator, Token-2022
  mint, SOL-paired bonding curve, and reviewed metadata before publication.
- A gated second wallet approval is designed to create and permanently lock Pump fee sharing with
  exactly 8,000 bps sent to the configured reward treasury and 2,000 bps sent
  to the SPORTPAD buyback treasury. The server verifies both recipients and the
  revoked fee-share admin onchain.
- A live Jupiter route check for selectable Solana Fan Tokens before IPFS
  preparation or mainnet signing. Chiliz selections are paused while their
  post-migration V2 acquisition and payout path is verified. A registry address
  or a small read-only Kayen quote is not evidence of an executable reward.
- A 96-asset FanTokens catalog view: 82 official Fan Tokens have published
  Solana token addresses in the Chiliz registry. That does not mean 82 can be
  bought through Jupiter: an actual executable route must pass checks. Fourteen
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
  distributions for published community launches and deduplicates them by
  signature and instruction position. It explicitly excludes the configured
  SPORTPAD mint, whose own fees remain available for project development.
- A held wallet-confirmed Pump fee collection and immutable 80/20 distribution path.
  The app verifies the active sharing configuration and revoked admin before the
  operator wallet can sign.
- Held Jupiter Swap V2 intents for buying selectable Solana Fan Tokens with
  the 80% treasury and SPORTPAD with the 20% treasury. Orders are exact-in,
  capped at 1% slippage and 5% price impact, message-hash bound, and submitted
  only after the matching treasury wallet signs.
- A finalized Helius holder indexer for active reward epochs. It aggregates all
  token accounts by on-curve wallet, excludes protocol and treasury accounts,
  accrues time-weighted token-seconds, and records a hash for every snapshot.
- Deterministic Fan Token allocation and Solana payout code paths, with payout
  execution currently held while atomic accounting and receipt verification are
  completed and tested.
- A planned SPORTPAD buyback and burn lane for only the 20% share from community
  launches. The automatic lane is hard-disabled even after a SPORTPAD mint is
  configured; it still needs durable swap-to-burn recovery and funded canaries.

The interface does not display fabricated market caps, trading volume, holder
counts, reward balances, settlement events, or match results.

## Readiness snapshot

| Area | Current state |
| --- | --- |
| Product interface | Implemented and public |
| Private drafts and image storage | Implemented |
| Wallet authentication | Implemented for Solana mainnet wallets |
| Pump mainnet launch | Code path implemented, but public execution paused |
| Public mainnet receipts | Verification path implemented; no unverified receipts should be presented as live |
| Production activation | Paused; the workers lack dedicated signing keys and the financial gate remains closed |
| Control plane, treasury observation, and fee ingestion | Implemented; this does not imply financial settlement |
| Fee sweeping and swaps | Economic execution paused; Chiliz acquisition currently needs prefunded CHZ |
| Holder rewards and payouts | Dashboard and allocation paths exist, but automatic payouts are not live |
| SOL-to-Chiliz replenishment | Quote-only route checker; no live bridge signer or transaction recovery |
| SPORTPAD buyback and burn | Hard-disabled; mint configuration alone cannot activate it |

## Remaining external setup

The two restricted Railway workers exist and their treasury signing variables
have been configured. Their presence does **not** unlock launches or prove
financial execution. The Chiliz worker currently
needs prefunded native CHZ and cannot refill itself from Solana. All 78 saved
Chiliz reward addresses had legacy 0-decimal contracts after the official 2026
migration, so current 18-decimal V2 contract identity and direct Kayen routes
are being revalidated. Read-only 1-CHZ and 100-CHZ quotes exist for all 78,
but 25 show severe depth impact at 100 CHZ; these quotes do not make rewards
launch-ready. The quote-only replenishment tool now uses Chiliz's official
direct Solana CHZ to native Chiliz CHZ OFT route, whose peers have been checked
on both chains. This route does **not** need a LayerZero Value Transfer API
key, but it still needs integrated signing, a durable transaction journal,
and post-bridge reconciliation before it can move real fees. The buyback lane also needs durable swap/burn
recovery and a funded test of the coded two-leg settlement ordering. Server-side receipt and holder-snapshot
atomicity code now exists but still needs end-to-end funded canaries, monitoring,
and independent security review before public funds should be routed through
the system.

Raw private keys and seed phrases do not belong in this repository, chat, or
local environment files. Dedicated hot-wallet private keys may be entered only
into the matching Railway worker's private service variables, with limited
balances and operational controls. See [operator setup and live blockers](docs/AUTOMATION.md).

## Product routes

| Route | Purpose |
| --- | --- |
| `/` | Product overview and verified public-mainnet-receipt or example feed |
| `/discover` | Search verified launches, with examples only when the feed is empty |
| `/launches/[slug]` | Public mainnet receipt, legacy devnet receipt, or clearly marked example detail |
| `/launch` | Private four-step draft builder, moderation status, route validation, image upload, and gated Pump mainnet launcher |
| `/operator` | Authenticated infrastructure console and moderation queue; unavailable to users outside the exact allowlist |
| `/rewards` | Wallet-specific indexed positions, finalized allocations, and payout receipts |
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
for the managed signer boundary. Migration `0012_exotic_peter_parker.sql` binds
exact Jupiter and burn transactions to settlement intents. Migration
`0013_bright_molten_man.sql` adds holder observation timestamps, finalized
allocation fields, reward-payout intents, confirmed payout slots, and enables
wallet-confirmed execution after deployment. Migration
`0014_cloudy_edwin_jarvis.sql` prevents concurrent active epochs for one launch.

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
