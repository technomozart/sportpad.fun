# SportPad production automation

SportPad uses the public Sites deployment for the application, API, D1 ledger, route checks, wallet verification, and job queue. Private signing keys belong only inside two restricted Railway worker services. **No financial worker lane is presently enabled for public execution.** Launch remains locked while V2 Chiliz execution, ledger safety, bridge funding, and funded canaries remain incomplete.

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
CHILIZ_TREASURY_ADDRESS=0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21
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
CHILIZ_TREASURY_PRIVATE_KEY=<64-hex-character key for a dedicated Chiliz treasury; optional 0x prefix>
CHILIZ_TREASURY_ADDRESS=<public address derived from that private key>
JUPITER_API_KEY=<server key>
```

The corresponding public Chiliz address will need native CHZ for Kayen reward purchases and claim gas after a capped canary is approved. Chiliz migrated Fan Tokens to new 18-decimal V2 contracts in 2026. The previously configured Kayen wrapper and unwrap path pays the old token, so it must not be used. Direct V2 purchase and ERC-20 transfer code now exists, but is held by independent worker, migration, and financial gates until spend accounting, destination liquidity, and funded claims are proven.

The current implementation assumes a prefunded CHZ operating treasury. It does not bridge SOL to CHZ. Even with a funded CHZ balance, purchase and claim lanes are statically held. Read-only direct V2 quotes at 1 CHZ and 100 CHZ existed for all 78 catalog assets in September 2026, but 25 showed more than 20% depth impact at 100 CHZ relative to the 1-CHZ quote. This is not proof of safe execution at the actual order size. Refill alerts, an operating buffer, size-specific route limits, verified receipts, and funded canaries are required before public volume.

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
SOLANA_BUYBACK_PRIVATE_KEY=<optional private key for CtubJk...; buyback is disabled>
```

At startup and before each leased Solana job, the worker verifies that each configured private key derives to the matching public treasury address returned by `/api/protocol/status`. A mismatch or unavailable status endpoint stops execution. The reward key is required for the reward worker; the buyback key is optional while its lane is disabled.

The reward key is intended for AFC and ARG SPL claims, but claims are currently statically held pending funded canaries and an independent security review. Server-side finalized receipt checks now exist, but they have not been proven with real payouts. The buyback key is **not currently executable**, even after the SPORTPAD mint is activated. A narrow Jupiter transaction validator, pre-broadcast swap-intent record, receipt verifier, and two-leg settlement ordering test exist, but they have not passed a funded mainnet order canary and cannot substitute for durable swap-to-burn recovery, a pre-broadcast burn intent, and signer spend limits. Keep `SPORTPAD_BUYBACK_ENABLED=false` and do not advertise automatic buyback as live.

SPORTPAD's own fee events are excluded from this buyback queue and remain available for project development.

## 3a. Exact wallet and Railway setup for the operator

These are dedicated hot wallets. Do not export a personal wallet holding unrelated funds, and never place a seed phrase or private key in chat, this repository, D1, or the public website. The two Railway services already exist in the `SportPad Workers` project. Railway variable changes must be applied as staged changes before the service restarts.

1. In the Phantom browser extension, open the profile avatar, choose **Manage Accounts**, and select the account whose **Solana** public address is `yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4`. Choose **Show Private Key**, then **Solana**. If **Show Private Key** is unavailable, stop; some Phantom account types cannot export the key. Do not substitute the recovery phrase.
2. Open the [Solana worker Variables page](https://railway.com/project/bb01df2b-5c38-490e-acd1-7465654dd5d5/service/c9db38aa-c0df-4770-bb39-61dfb1cadab7/variables). Click **New Variable**, set the name `SOLANA_REWARD_VAULT_PRIVATE_KEY`, and paste only that account's private key into the value field. Save, review, and **Deploy** the staged change. Leave `SOLANA_BUYBACK_PRIVATE_KEY` unset until the burn lane is independently verified.
3. Install MetaMask from [metamask.io](https://metamask.io/) in a separate browser profile and create a new, empty wallet dedicated to the Chiliz treasury. Store its recovery phrase offline. In the extension select the account, use the three-dot menu, **Account details**, **Private key**, and confirm with the MetaMask password. Copy only this new account's private key.
4. Open the [Chiliz worker Variables page](https://railway.com/project/bb01df2b-5c38-490e-acd1-7465654dd5d5/service/3f594006-c1fd-4dfc-9c7a-33f314f2f778/variables). Add `CHILIZ_TREASURY_PRIVATE_KEY` with that account's private key (a `0x` prefix is optional) and `CHILIZ_TREASURY_ADDRESS` with its public address, then review and **Deploy** the staged change. The worker refuses to start if the key derives to a different address. Share only the public `0x` address for verification. The account will eventually require native CHZ for gas and purchases, but do not fund it for production until the financial hold is lifted and a canary plan is agreed.

References: [Phantom private-key guide](https://help.phantom.com/articles/25334064171795), [MetaMask private-key guide](https://support.metamask.io/configure/accounts/how-to-export-an-accounts-private-key/), and [Railway variables guide](https://docs.railway.com/variables).

## 3b. SOL-to-Chiliz replenishment is still quote-only

Run `npm run audit:chiliz` for a dated, read-only inspection of all catalogued current V2 contracts. It checks Chiliz Chain ID, contract code, 18-decimal precision, and direct Kayen quotes at 1 and 100 CHZ. The Fan Tokens page can check individual markets on demand. `quote_available` means only that a quote was returned at those sizes; `shallow_depth` means the 100 CHZ quote is more than 20% below a linear estimate from 1 CHZ. Neither result authorizes an automatic purchase or a public launch. A quote can disappear before a trade.

The `scripts/replenish-chiliz.mjs` CLI checks the public route directory, attempts Jupiter's SOL-to-Solana-CHZ order, and, if a production API key is supplied, a LayerZero Solana-CHZ-to-native-Chiliz-CHZ quote. It **cannot sign, broadcast, bridge, or refill the treasury**. Its quote cannot be treated as acquired inventory or a guaranteed executable route. The current reward treasury has no SOL, and the latest Jupiter order reported insufficient funds; no executable SOL-to-CHZ transaction has been validated. The Chiliz worker still requires prefunded native CHZ and does not automatically replenish it.

LayerZero's [Value Transfer API documentation](https://docs.layerzero.network/v2/developers/value-transfer-api/start) says to contact the LayerZero team for a production API key; there is no documented self-service key-generation screen. Open [LayerZero's interop page](https://layerzero.network/interop), choose **Connect to our team → Developer Assistance**, and request production Value Transfer API access for official Solana CHZ to native Chiliz CHZ treasury transfers. The [officially linked assistance form](https://layerzeronetwork.typeform.com/to/U9hMgxf1) can also be opened directly. When approved, place the key privately in a future dedicated replenisher service as `LAYERZERO_VT_API_KEY`. The current two workers do not read this key. A direct LayerZero Solana OFT SDK route may avoid this API, but the currently listed Solana CHZ asset has not been verified as a compatible OFT, and its exact contracts, peer configuration, and funded execution would require a separate implementation and security review.

## 4. SPORTPAD mint registration

After the mint exists:

1. Sign in as an authorized SportPad operator.
2. Open `/operator`.
3. Paste the SPORTPAD Solana mint into **Hot activation**.
4. Confirm the setting.

The setting can be registered without a build, but this does **not** enable buyback. The buyback worker is hard-disabled pending the safety work above. SPORTPAD's own fee events remain excluded from the community buyback queue.

## 5. Ambiguous broadcast and reconciliation

Once financial lanes are safely enabled, each worker must mark a job `broadcasting` immediately before its first potentially irreversible on-chain action. Once armed, the job is never automatically leased again if a worker crashes, a transaction times out, or the completion API fails. A subsequent worker error moves it to `reconciliation_required`; a crash can leave it in `broadcasting`. In either state, **do not requeue or retry it**. Operator pauses and feature flags prevent new leases and arming, but already-broadcast jobs may still report their results for reconciliation. While the ledger hold is active, a completion report stores the worker-supplied hash and receipt details in the held job, **not** in confirmed claim or settlement accounting.

An operator must inspect the signer account, transaction history, token balance changes, and the intended destination on the correct chain, then reconcile the on-chain outcome to the settlement or claim ledger. Server-side finalized receipt checks now reject mismatched hashes, but a temporarily unavailable receipt still needs manual reconciliation; there is no automatic reconciliation endpoint yet. Until an audited reconciliation procedure is built and the result verified, pause the affected lane and keep the job held. A definitively pre-broadcast failure may be retried automatically after the lane is re-enabled; a definitively failed claim may be requested again by its owner only after that release.

## 6. Required canary before public traffic

Use low-value wallets and amounts for the first test. Confirm all of the following:

1. A community token is created on Pump mainnet and the 80/20 recipients match the published treasury addresses.
2. The fee indexer records the finalized fee event exactly once.
3. A Chiliz launch creates one Kayen purchase job and a funded 24-hour reward epoch.
4. The holder indexer excludes protocol-controlled accounts and records finalized token-seconds.
5. A connected holder can add Chiliz Chain, sign the address-link message, and see the allocation.
6. A claim transfers the official V2 Fan Token directly to the verified Chiliz address while the treasury pays CHZ gas; no legacy wrapper or unwrap transaction is accepted.
7. AFC or ARG can be acquired and paid on Solana when its bounded Jupiter route is live.
8. After the buyback lane is safely implemented and enabled in a future release, a low-value community fee produces one Jupiter buy, one SPL burn, and the exact verified supply decrease.
9. Crashed or timed-out post-broadcast worker calls enter reconciliation rather than duplicate purchases, claims, or burns.
10. Pausing the lanes stops new economic execution without deleting ledger evidence.

Do not enable unrestricted public volume until this canary passes and the Chiliz treasury has an explicit balance buffer.
