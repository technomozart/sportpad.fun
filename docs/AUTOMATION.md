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

Before enabling either Solana purchase lane, pre-create the treasury's associated token account for every mint that lane may buy. The reward treasury needs an account for each enabled Solana Fan Token mint. After the SPORTPAD mint exists, the buyback treasury needs its SPORTPAD associated token account. Use a separate, deliberate on-chain setup transaction and wait for finalization. Verify the derived account address, treasury owner, token mint, and token program on-chain; the account must be initialized, unfrozen, and have no delegate or close authority. The automation worker only reads this finalized account; if it is absent or mismatched, the job stops before arming or requesting a Jupiter quote. It never pays account rent or creates an associated token account as part of an automated purchase. Record and fund any one-time account-creation cost outside the purchase ledger. No private key or recovery phrase belongs in this document or any setup ticket.

The reward worker now has a capped Jupiter purchase path for the two route-checked Solana Fan Tokens. It saves the exact signed order before broadcast, verifies the finalized purchase, and atomically credits the launch vault and an automatic reward epoch. A mature epoch is allocated only after a finalized holder checkpoint covers its full window. The worker can recover a landed purchase from its saved signature after a timeout or replay that exact signed order while its blockhash remains valid. A second order requires finalized-history proof that the original expired unlanded. This code remains **statically disabled** pending funded canaries, operator-only canary isolation, aggregate shared-wallet solvency checks, and handling finalized failed or permanently ambiguous transactions. Claims are also held pending funded payout tests. Before a Solana claim is queued, the claimant's wallet creates its own Fan Token associated account if needed and pays that one-time rent and network fee; the treasury no longer creates that account outside the claim ledger. The buyback key is **not currently executable**, even after the SPORTPAD mint is activated. A narrow Jupiter transaction validator, pre-broadcast swap-intent record, receipt verifier, and two-leg settlement ordering test exist, but they have not passed a funded mainnet order canary. Keep `SPORTPAD_BUYBACK_ENABLED=false` and do not advertise automatic buyback as live.

SPORTPAD's own fee events are excluded from this buyback queue and remain available for project development.

## 3a. Wallet and Railway setup status

The two dedicated workers already exist in the `SportPad Workers` Railway project and their signer variable names have been configured: `SOLANA_REWARD_VAULT_PRIVATE_KEY`, `SOLANA_BUYBACK_PRIVATE_KEY`, and `CHILIZ_TREASURY_PRIVATE_KEY`. Both services have shown Online. Do not paste keys or seed phrases into chat, this repository, D1, or the website. A configured key and an Online service do not enable a financial lane or prove the derived signer, balance, or payout path; each must be checked by the worker and a funded canary.

If a key is later rotated, use only the private [Solana worker Variables page](https://railway.com/project/bb01df2b-5c38-490e-acd1-7465654dd5d5/service/c9db38aa-c0df-4770-bb39-61dfb1cadab7/variables) or [Chiliz worker Variables page](https://railway.com/project/bb01df2b-5c38-490e-acd1-7465654dd5d5/service/3f594006-c1fd-4dfc-9c7a-33f314f2f778/variables), apply the staged change, and verify the derived public treasury. No recovery phrase is needed for automation.

## 3b. SOL-to-Chiliz replenishment is still quote-only

Run `npm run audit:chiliz` for a dated, read-only inspection of all catalogued current V2 contracts. It checks Chiliz Chain ID, contract code, 18-decimal precision, and direct Kayen quotes at 1 and 100 CHZ. The Fan Tokens page can check individual markets on demand. `quote_available` means only that a quote was returned at those sizes; `shallow_depth` means the 100 CHZ quote is more than 20% below a linear estimate from 1 CHZ. Neither result authorizes an automatic purchase or a public launch. A quote can disappear before a trade.

The `scripts/replenish-chiliz.mjs` CLI now requests a Jupiter SOL-to-official-Solana-CHZ order and a direct quote from the official Solana CHZ OFT to native Chiliz CHZ. The CHZ OFT store, peer, and native adapter have been checked on both chains. On 2026-09-25, the public 80% treasury held 0.05 SOL; read-only quotes succeeded for a small Jupiter order and the direct bridge. **No swap or bridge was signed or broadcast.** These quotes are not inventory or a guarantee that a later transaction will settle.

The direct OFT route uses the [official Chiliz bridge](https://bridge.chilizchain.com/) and [LayerZero Solana OFT SDK](https://docs.layerzero.network/v2/developers/solana/oft/overview). It does **not** require a production LayerZero Value Transfer API key. The legacy API remains an optional, separate route inspector only. The Chiliz worker still needs verified native CHZ inventory before it can purchase V2 Fan Tokens; the new fee reservation, swap, bridge, and receipt components are not yet connected into unattended production execution.

## 4. SPORTPAD mint registration

After the mint exists:

1. Sign in as an authorized SportPad operator.
2. Open `/operator`.
3. Paste the SPORTPAD Solana mint into **Hot activation**.
4. Confirm the setting.

The setting can be registered without a build, but this does **not** enable buyback. The buyback worker is hard-disabled pending the safety work above. SPORTPAD's own fee events remain excluded from the community buyback queue.

## 5. Ambiguous broadcast and reconciliation

Once financial lanes are safely enabled, each worker must mark a job `broadcasting` immediately before its first potentially irreversible on-chain action. A subsequent worker error moves it to `reconciliation_required`; a crash can leave it in `broadcasting`. The Solana reward-purchase lane can automatically complete a finalized transaction from its persisted signed signature, or requeue an old armed job only when no order, transaction hash, or possible broadcast was recorded. Other armed jobs remain held. Do not manually requeue an uncertain transaction. Operator pauses and feature flags prevent new leases and arming, but already-broadcast jobs may still report their results for reconciliation. While the ledger hold is active, a completion report stores the worker-supplied hash and receipt details in the held job, **not** in confirmed claim or settlement accounting.

For every other ambiguous case, an operator must inspect the signer account, transaction history, token balance changes, and intended destination on the correct chain, then reconcile the on-chain outcome to the ledger. A temporarily unavailable receipt, a finalized failed transaction, or a missing persisted order with a reported hash still needs manual review. Until an audited recovery procedure is built and tested, pause the affected lane and keep the job held. A definitively failed claim may be requested again by its owner only after that release.

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
