# Chiliz reward wallet links

A verified Solana holder wallet can link one Chiliz destination address at a time. The same Chiliz address may be linked to multiple Solana holder wallets, including wallets under different signed-in accounts. Each link requires its own fresh EVM signature over a challenge that names the SportPad account, Solana wallet, Chiliz address, chain ID, nonce, origin, and expiry. A signature for one holder wallet cannot establish another holder wallet's link.

`evm_wallet_links` is keyed by `(owner_user_id, solana_wallet)`. Relinking a holder wallet replaces only that wallet's destination. Reward position and claim reads also scope links by both fields, while claims themselves remain scoped to the verified Solana wallet. Migration `0017_milky_dracula.sql` copies all existing links into this schema before replacing the old table. It does not change claim or financial execution gates.
