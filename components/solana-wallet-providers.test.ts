import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverSolanaProviders,
  type SolanaProvider,
  type SolanaProviderWindow,
} from "./solana-wallet-providers.ts";

function provider(flags: Partial<SolanaProvider> = {}): SolanaProvider {
  return { connect: async () => undefined, ...flags };
}

test("discovers Phantom, Solflare, Backpack, and Brave providers", () => {
  const browser: SolanaProviderWindow = {
    phantom: { solana: provider({ isPhantom: true }) },
    solflare: provider({ isSolflare: true }),
    backpack: { solana: provider({ isBackpack: true }) },
    braveSolana: provider({ isBraveWallet: true, isPhantom: true }),
  };

  assert.deepEqual(
    discoverSolanaProviders(browser).map(({ id, name }) => ({ id, name })),
    [
      { id: "phantom", name: "Phantom" },
      { id: "solflare", name: "Solflare" },
      { id: "backpack", name: "Backpack" },
      { id: "brave", name: "Brave Wallet" },
    ],
  );
});

test("deduplicates provider aliases and identifies Brave before Phantom compatibility", () => {
  const brave = provider({ isBraveWallet: true, isPhantom: true });
  const detected = discoverSolanaProviders({ braveSolana: brave, solana: brave });

  assert.equal(detected.length, 1);
  assert.equal(detected[0].id, "brave");
  assert.equal(detected[0].name, "Brave Wallet");
});

test("discovers providers exposed through the shared provider collection", () => {
  const backpack = provider({ isBackpack: true });
  const custom = provider({ name: "Example Wallet" });
  const container = provider({ providers: [backpack, custom] });

  assert.deepEqual(
    discoverSolanaProviders({ solana: container }).map(({ id, name }) => ({ id, name })),
    [
      { id: "backpack", name: "Backpack" },
      { id: "example-wallet", name: "Example Wallet" },
      { id: "detected", name: "Detected wallet" },
    ],
  );
});
