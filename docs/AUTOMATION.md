# SportPad production automation

SportPad uses the public Sites deployment for the application, API, D1 ledger, route checks, wallet verification, and job queue. Private signing keys run only inside two restricted Railway worker services.

Never place a seed phrase or private key in chat, D1, source control, Sites public variables, or a browser form.

## 1. Sites secrets and public configuration

Configure these server-side variables on the SportPad Sites project:

```text
HELIUS_API_KEY
JUPITER_API_KEY
SPORTPAD_WORKER_TOKEN
MAINNET_EXECUTION_ENABLED=true
SOLANA_REWARD_TREASURY_ADDRESS=yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4
SOLANA_BUYBACK_TREASURY_ADDRESS=CtubJkSzXezmwrX2W67HZkkCiQKCk9oFWHK5K6tdV4yQ
SPORTPAD_FEE_INDEXER_ENABLED=true
SPORTPAD_SETTLEMENT_ENABLED=true
SPORTPAD_REWARDS_ENABLED=true
SPORTPAD_HOLDER_INDEXER_ENABLED=true
SPORTPAD_CLAIMS_ENABLED=true
SPORTPAD_BUYBACK_ENABLED=true
CHILIZ_RPC_URL=https://rpc.chiliz.com
```

`SPORTPAD_WORKER_TOKEN` must be a new high-entropy value shared only by Sites and the two workers.

## 2. Chiliz Railway worker

Create a Railway service from this repository with start command:

```text
npm run worker:automation
```

Set only these private service variables:

```text
SPORTPAD_BASE_URL=https://sportpad.fun
SPORTPAD_WORKER_TOKEN=<same value as Sites>
CHILIZ_RPC_URL=https://rpc.chiliz.com
CHILIZ_TREASURY_PRIVATE_KEY=<0x-prefixed private key for a dedicated Chiliz treasury>
JUPITER_API_KEY=<server key>
```

Fund the corresponding public Chiliz address with native CHZ. This one balance pays for both Kayen reward purchases and claim gas. The worker values each finalized SOL reward share in CHZ, buys the selected wrapped Fan Token through Kayen, and later unwraps the exact whole-token allocation directly to the holder's verified Chiliz address.

The current implementation uses a prefunded CHZ operating treasury. It does not bridge SOL to CHZ. The system pauses new acquisitions when that CHZ balance cannot cover the purchase plus the gas reserve. Refill alerts and an operating buffer are required before public volume.

## 3. Solana Railway worker

Create a second Railway service from this repository with start command:

```text
npm run worker:solana
```

Set these private service variables:

```text
SPORTPAD_BASE_URL=https://sportpad.fun
SPORTPAD_WORKER_TOKEN=<same value as Sites>
HELIUS_API_KEY=<server key>
JUPITER_API_KEY=<server key>
SOLANA_REWARD_VAULT_PRIVATE_KEY=<private key for yCBTQi...>
SOLANA_BUYBACK_PRIVATE_KEY=<private key for CtubJk...>
```

The reward key pays AFC and ARG SPL claims. The buyback key is dormant until the SPORTPAD mint is activated. It then swaps the 20% community-launch fee share through an approved Jupiter router, burns the exact purchased amount, and verifies the mint supply delta.

SPORTPAD's own fee events are excluded from this buyback queue and remain available for project development.

## 4. SPORTPAD activation in under one minute

Prepare and keep the Solana worker running before the SPORTPAD launch. After the mint exists:

1. Sign in as an authorized SportPad operator.
2. Open `/operator`.
3. Paste the SPORTPAD Solana mint into **Hot activation**.
4. Confirm the setting.

The fee indexer and buyback worker read this D1 setting immediately. No build or website deployment is required. Existing queued community settlements become eligible for SPORTPAD buyback and burn; SPORTPAD's own fee events remain excluded.

## 5. Required canary before public traffic

Use low-value wallets and amounts for the first test. Confirm all of the following:

1. A community token is created on Pump mainnet and the 80/20 recipients match the published treasury addresses.
2. The fee indexer records the finalized fee event exactly once.
3. A Chiliz launch creates one Kayen purchase job and a funded 24-hour reward epoch.
4. The holder indexer excludes protocol-controlled accounts and records finalized token-seconds.
5. A connected holder can add Chiliz Chain, sign the address-link message, and see the allocation.
6. A claim unwraps the official Fan Token to the verified Chiliz address while the treasury pays CHZ gas.
7. AFC or ARG can be acquired and paid on Solana when its bounded Jupiter route is live.
8. After SPORTPAD activation, a low-value community fee produces one Jupiter buy, one SPL burn, and the exact verified supply decrease.
9. Retried worker calls do not duplicate purchases, claims, or burns.
10. Pausing the lanes stops new economic execution without deleting ledger evidence.

Do not enable unrestricted public volume until this canary passes and the Chiliz treasury has an explicit balance buffer.
