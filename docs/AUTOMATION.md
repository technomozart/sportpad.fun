# SportPad production automation

SportPad uses the public Sites deployment for the application, API, D1 ledger, route checks, wallet verification, and job queue. Private signing keys belong only inside two restricted Railway worker services. **No financial worker lane is presently enabled for public execution.** Launch remains locked while ledger concurrency and receipt verification are incomplete.

Do not change `FINANCIAL_LEDGER_VERIFIED` in `lib/protocol/automation-safety.ts` until all of these are implemented and tested: server-side verification of chain receipts, atomic claim queue and vault/settlement completion transitions, concurrency-safe purchase inventory increments, durable swap/burn recovery, and funded end-to-end canaries. A zero-row D1 update inside a batch is not itself a rollback; the current held paths must not be released merely because the workers start successfully.

Never place a seed phrase or private key in chat, D1, source control, Sites public variables, or a SportPad website form. Use only Railway's private service-variable UI for dedicated worker keys; do not use a seed phrase where a single wallet private key is sufficient.

## 1. Sites secrets and public configuration

Configure these server-side variables on the SportPad Sites project:

```text
HELIUS_API_KEY
JUPITER_API_KEY
SPORTPAD_WORKER_TOKEN
MAINNET_EXECUTION_ENABLED=false
SOLANA_REWARD_TREASURY_ADDRESS=yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4
SOLANA_BUYBACK_TREASURY_ADDRESS=CtubJkSzXezmwrX2W67HZkkCiQKCk9oFWHK5K6tdV4yQ
SPORTPAD_FEE_INDEXER_ENABLED=true
SPORTPAD_SETTLEMENT_ENABLED=true
SPORTPAD_REWARDS_ENABLED=true
SPORTPAD_HOLDER_INDEXER_ENABLED=true
SPORTPAD_CLAIMS_ENABLED=true
SPORTPAD_BUYBACK_ENABLED=false
CHILIZ_RPC_URL=https://rpc.chiliz.com
```

`SPORTPAD_WORKER_TOKEN` must be a new high-entropy value shared only by Sites and the two workers.
Keep `MAINNET_EXECUTION_ENABLED=false` until the financial ledger, bridge funding,
buyback path, and funded canaries are verified. Merely supplying keys or starting
the Railway services is not approval to switch it on.

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

The current implementation uses a prefunded CHZ operating treasury. It does not bridge SOL to CHZ. Even with a funded CHZ balance, the purchase and claim lanes are statically held pending atomic accounting and on-chain receipt verification. Refill alerts and an operating buffer are required before any future public volume.

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

At startup and before each leased Solana job, the worker verifies that both configured private keys derive to the public treasury addresses returned by `/api/protocol/status`. A mismatch or unavailable status endpoint stops execution.

The reward key is intended for AFC and ARG SPL claims, but claims are currently statically held pending atomic accounting and on-chain receipt verification. The buyback key is **not currently executable**, even after the SPORTPAD mint is activated. The Jupiter transaction needs exact signer-debit and token-output validation, and a durable two-stage swap/burn recovery path, before the buyback worker can be enabled safely. Keep `SPORTPAD_BUYBACK_ENABLED=false` and do not advertise automatic buyback as live.

SPORTPAD's own fee events are excluded from this buyback queue and remain available for project development.

## 4. SPORTPAD mint registration

After the mint exists:

1. Sign in as an authorized SportPad operator.
2. Open `/operator`.
3. Paste the SPORTPAD Solana mint into **Hot activation**.
4. Confirm the setting.

The setting can be registered without a build, but this does **not** enable buyback. The buyback worker is hard-disabled pending the safety work above. SPORTPAD's own fee events remain excluded from the community buyback queue.

## 5. Ambiguous broadcast and reconciliation

Once financial lanes are safely enabled, each worker must mark a job `broadcasting` immediately before its first potentially irreversible on-chain action. Once armed, the job is never automatically leased again if a worker crashes, a transaction times out, or the completion API fails. A subsequent worker error moves it to `reconciliation_required`; a crash can leave it in `broadcasting`. In either state, **do not requeue or retry it**. Operator pauses and feature flags prevent new leases and arming, but already-broadcast jobs may still report their results for reconciliation. While the ledger hold is active, a completion report stores the worker-supplied hash and receipt details in the held job, **not** in confirmed claim or settlement accounting.

An operator must inspect the signer account, transaction history, token balance changes, and the intended destination on the correct chain, then reconcile the on-chain outcome to the settlement or claim ledger. Worker-supplied hashes are not independently verified by the server. There is no automatic reconciliation endpoint yet. Until an audited reconciliation procedure is built and the result verified, pause the affected lane and keep the job held. A definitively pre-broadcast failure may be retried automatically after the lane is re-enabled; a definitively failed claim may be requested again by its owner only after that release.

## 6. Required canary before public traffic

Use low-value wallets and amounts for the first test. Confirm all of the following:

1. A community token is created on Pump mainnet and the 80/20 recipients match the published treasury addresses.
2. The fee indexer records the finalized fee event exactly once.
3. A Chiliz launch creates one Kayen purchase job and a funded 24-hour reward epoch.
4. The holder indexer excludes protocol-controlled accounts and records finalized token-seconds.
5. A connected holder can add Chiliz Chain, sign the address-link message, and see the allocation.
6. A claim unwraps the official Fan Token to the verified Chiliz address while the treasury pays CHZ gas.
7. AFC or ARG can be acquired and paid on Solana when its bounded Jupiter route is live.
8. After the buyback lane is safely implemented and enabled in a future release, a low-value community fee produces one Jupiter buy, one SPL burn, and the exact verified supply decrease.
9. Crashed or timed-out post-broadcast worker calls enter reconciliation rather than duplicate purchases, claims, or burns.
10. Pausing the lanes stops new economic execution without deleting ledger evidence.

Do not enable unrestricted public volume until this canary passes and the Chiliz treasury has an explicit balance buffer.
