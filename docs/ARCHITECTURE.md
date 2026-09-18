# SportPad protocol architecture

Status: private product prototype. Mainnet execution is deliberately disabled.

## Product rule

SportPad launches a community-created Solana token and associates it with a separately verified official Fan Token reward asset. It does **not** create a literal AMM pair with that Fan Token, and it must never imply that the community token is official or club-endorsed.

Current Fan Tokens are omnichain across Chiliz Chain, Solana, and Base. The default route should therefore remain entirely on Solana whenever the official Solana mint has enough executable liquidity:

`Pump creator fees -> 80/20 fee-share recipients -> reward inventory / SPORT buyback -> holder epoch -> Solana claim`

MetaMask or a second EVM address is not required for this route. Cross-chain execution is a treasury replenishment concern, not a user claim dependency.

## Components

1. **Launch coordinator**
   - Creates the Pump Token-2022 mint.
   - Disables Pump holder rewards because those rewards cannot pay an unrelated Fan Token.
   - Configures Pump creator-fee sharing before public trading: 8,000 bps reward treasury and 2,000 bps buyback treasury.
   - Finalizes the share authority only after address and basis-point verification.

2. **Fee indexer and keeper**
   - Watches both pre-graduation bonding-curve and post-graduation PumpSwap fee vaults.
   - Treats events as provisional until Solana finalization.
   - Claims/distributes fees with permissionless keeper transactions.
   - Deduplicates by transaction signature plus instruction position.

3. **Settlement engine**
   - Uses persisted transitions: `observed -> finalized -> distributed -> quote_ready -> submitted -> source_finalized -> epoch_funded`.
   - Acquires an enabled Fan Token only when quote age, price impact, slippage, depth, and daily limits pass.
   - Uses Jupiter for Solana-native routes.
   - Uses a pre-funded inventory buffer and asynchronous LayerZero replenishment only for validated cross-chain routes.
   - Buys SPORT from the 20% share, calls SPL `BurnChecked`, waits for finalization, and verifies the supply delta.

4. **Holder indexer**
   - Consumes Helius transaction streams and reconciles them against Solana RPC snapshots.
   - Aggregates all token accounts by owner.
   - Excludes program, bonding-curve, AMM, LP, treasury, burn, and other controlled accounts.
   - Calculates time-weighted token-seconds rather than using a manipulable end-of-epoch snapshot.

5. **Reward publisher and claim program**
   - Funds only rewards already purchased or reserved in the vault.
   - Publishes cutoff slot, funding transaction, allocation hash, Merkle root, and carried dust.
   - Uses a nullifier/bitmap so each wallet can claim once per epoch.
   - Pays the same connected Solana wallet by default.

6. **Dashboard API**
   - Exposes separate states: earned, claimed from fee vault, swapped, reserved, claimable, claimed, and failed.
   - Never counts operator-funded inventory or pending bridge transfers as paid rewards.

## Accounting

- Store every on-chain quantity as an atomic-unit integer string. Never use floating-point amounts.
- For each finalized creator-fee amount `G`:
  - rewards: `floor(G * 8000 / 10000)`
  - buyback: `G - rewards`
- For an epoch with funded rewards `F` and wallet token-seconds `tᵢ`:
  - wallet reward: `floor(F * tᵢ / Σt)`
  - unallocated integer dust carries into the next epoch.
- Read token decimals and authorities from chain state. Do not assume EVM and Solana representations use the same decimals.

## Liquidity policy

An official Solana mint is not proof of tradability. A reward asset is enabled only after a live executable route passes minimum depth, maximum price impact, and canary settlement checks. The registry must be dynamic and keyed by `(chain, mint)`, never ticker alone.

At the research snapshot, PSG and AFC produced Solana routes; BAR, CITY, and ACM required inventory or an alternate acquisition route. This can change and must be checked at execution time.

## Key and treasury policy

Production private keys must never appear in chat, source control, database rows, ordinary environment files, logs, screenshots, or analytics.

- Cold/multisig treasury owns material funds.
- Separate capped roles exist for fee collection, reward inventory, buyback execution, and cross-chain replenishment.
- Hot signers are policy-controlled references to KMS/HSM/MPC keys.
- Every role has mint allowlists, per-transaction and daily limits, gas/rent minimums, pause controls, and rotation procedures.

## Failure policy

There is no credible zero-delay or zero-failure guarantee. The product publishes service targets and honest states. Stale quotes, excessive price impact, RPC disagreement, missing liquidity, bridge timeout, or insufficient vault inventory must fail closed and leave user balances in a recoverable pending state.

Every economic action uses an idempotency key, records submitted signatures, reconciles chain balances after restart, and supports dead-letter review. Retrying a request must never create a second economic action.

## Validation gates

1. Local mocks: integer accounting, duplicates, reordering, crash/replay, Merkle claims, and burn math.
2. Devnet: two disposable launch tokens, exact 80/20 setup, both fee-vault paths, restart/reconciliation, and disposable buy/burn.
3. Cross-chain test: Solana devnet plus Chiliz Spicy with a disposable OFT; exercise missing ATA, gas, decimal dust, timeout, and duplicate submission.
4. Tiny mainnet canary: one launch, one reward token, capped wallets, one epoch, and 20–50 allowlisted testers with pre-funded inventory.
5. Beta: zero accounting divergence after reconciliation, no duplicate claims, deterministic replay roots, verified supply decrease, audit, incident runbook, capped exposure, and bug bounty.

## Primary references

- Pump public docs: <https://github.com/pump-fun/pump-public-docs>
- Pump creator fee sharing: <https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md>
- Official Fan Token address registry: <https://docs.chiliz.com/quick-start/token-contract-addresses>
- Chiliz omnichain architecture: <https://www.chiliz.com/building-on-an-omnichain-fan-token-ecosystem/>
- Jupiter swap docs: <https://developers.jup.ag/docs/swap>
- LayerZero Value Transfer API: <https://docs.layerzero.network/v2/developers/value-transfer-api/overview>
- Helius fungible token indexing: <https://www.helius.dev/docs/das/fungible-token-extension>
- SPL token burn: <https://solana.com/docs/tokens/basics/burn-tokens>

