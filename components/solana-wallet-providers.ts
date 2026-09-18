import type { Transaction, VersionedTransaction } from "@solana/web3.js";

export type SignedSolanaTransaction = Transaction | VersionedTransaction;

export type SolanaProvider = {
  connect: () => Promise<{ publicKey?: { toString: () => string } } | void>;
  disconnect?: () => Promise<void>;
  publicKey?: { toString: () => string } | null;
  signMessage?: (message: Uint8Array, display?: "utf8") => Promise<{ signature: Uint8Array }>;
  signTransaction?: <T extends SignedSolanaTransaction>(transaction: T) => Promise<T>;
  on?: (event: "accountChanged" | "disconnect", handler: (publicKey?: { toString: () => string } | null) => void) => void;
  off?: (event: "accountChanged" | "disconnect", handler: (publicKey?: { toString: () => string } | null) => void) => void;
  removeListener?: (event: "accountChanged" | "disconnect", handler: (publicKey?: { toString: () => string } | null) => void) => void;
  isBackpack?: boolean;
  isBraveWallet?: boolean;
  isPhantom?: boolean;
  isSolflare?: boolean;
  name?: string;
  providers?: SolanaProvider[];
};

export type DetectedSolanaProvider = {
  id: string;
  name: string;
  provider: SolanaProvider;
};

export type SolanaProviderWindow = {
  solana?: SolanaProvider;
  phantom?: { solana?: SolanaProvider };
  solflare?: SolanaProvider | { solana?: SolanaProvider };
  backpack?: SolanaProvider | { solana?: SolanaProvider };
  braveSolana?: SolanaProvider;
};

function providerFromContainer(value: SolanaProvider | { solana?: SolanaProvider } | undefined) {
  if (!value) return null;
  if ("connect" in value && typeof value.connect === "function") return value;
  return (value as { solana?: SolanaProvider }).solana ?? null;
}

function inferredProviderIdentity(provider: SolanaProvider, fallback: { id: string; name: string }) {
  if (provider.isBraveWallet) return { id: "brave", name: "Brave Wallet" };
  if (provider.isSolflare) return { id: "solflare", name: "Solflare" };
  if (provider.isBackpack) return { id: "backpack", name: "Backpack" };
  if (provider.isPhantom) return { id: "phantom", name: "Phantom" };
  const normalizedName = provider.name?.trim();
  return normalizedName
    ? { id: normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || fallback.id, name: normalizedName }
    : fallback;
}

export function discoverSolanaProviders(browser: SolanaProviderWindow | undefined): DetectedSolanaProvider[] {
  if (!browser) return [];
  const detected: DetectedSolanaProvider[] = [];
  const seen = new Set<SolanaProvider>();

  const add = (provider: SolanaProvider | null | undefined, fallback: { id: string; name: string }) => {
    if (!provider || typeof provider.connect !== "function" || seen.has(provider)) return;
    seen.add(provider);
    const identity = inferredProviderIdentity(provider, fallback);
    let id = identity.id;
    let suffix = 2;
    while (detected.some((item) => item.id === id)) id = `${identity.id}-${suffix++}`;
    const name = id === identity.id ? identity.name : `${identity.name} ${suffix - 1}`;
    detected.push({ id, name, provider });
  };

  add(browser.phantom?.solana, { id: "phantom", name: "Phantom" });
  add(providerFromContainer(browser.solflare), { id: "solflare", name: "Solflare" });
  add(providerFromContainer(browser.backpack), { id: "backpack", name: "Backpack" });
  add(browser.braveSolana, { id: "brave", name: "Brave Wallet" });
  for (const provider of browser.solana?.providers ?? []) {
    add(provider, { id: "detected", name: "Detected wallet" });
  }
  add(browser.solana, { id: "detected", name: "Detected wallet" });
  return detected;
}
