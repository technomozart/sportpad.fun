import assert from "node:assert/strict";
import test from "node:test";

import { buildEvmWalletChallenge } from "./evm-wallet-auth.ts";

test("the Chiliz wallet challenge binds both wallets, chain, nonce, and expiry", () => {
  const message = buildEvmWalletChallenge({
    origin: "https://sportpad.fun/path",
    ownerUserId: "user-123",
    solanaWallet: "solana-wallet",
    evmAddress: "0x1111111111111111111111111111111111111111",
    nonce: "nonce-123",
    expiresAt: Date.parse("2026-09-22T12:00:00.000Z"),
  });

  assert.match(message, /Domain: sportpad\.fun/);
  assert.match(message, /Verified Solana wallet: solana-wallet/);
  assert.match(message, /Chiliz wallet: 0x1111111111111111111111111111111111111111/);
  assert.match(message, /Chain ID: 88888/);
  assert.match(message, /Nonce: nonce-123/);
  assert.match(message, /does not authorize spending/);
});
