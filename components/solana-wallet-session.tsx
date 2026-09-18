"use client";

import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  discoverSolanaProviders,
  type DetectedSolanaProvider,
  type SolanaProviderWindow,
} from "@/components/solana-wallet-providers";
import { SolanaWalletSelector } from "@/components/solana-wallet-selector";

type SignedTransaction = Transaction | VersionedTransaction;

type WalletSessionContextValue = {
  wallet: string;
  connectedAddress: string;
  chain: "solana:devnet";
  busy: boolean;
  message: string;
  messageTone: "success" | "error" | "neutral";
  providerAvailable: boolean;
  connectAndVerify: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: <T extends SignedTransaction>(transaction: T) => Promise<T>;
};

const WalletSessionContext = createContext<WalletSessionContextValue | null>(null);

const SELECTED_PROVIDER_KEY = "sportpad:solana-provider";

function readDetectedProviders() {
  if (typeof window === "undefined") return [];
  return discoverSolanaProviders(window as unknown as SolanaProviderWindow);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function SolanaWalletSessionProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState("");
  const [connectedAddress, setConnectedAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | "neutral">("neutral");
  const [providerAvailable, setProviderAvailable] = useState(false);
  const [providers, setProviders] = useState<DetectedSolanaProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const verificationInProgress = useRef(false);
  const walletStateGeneration = useRef(0);

  const refreshProviders = useCallback(() => {
    const nextProviders = readDetectedProviders();
    setProviders(nextProviders);
    setProviderAvailable(nextProviders.length > 0);
    setSelectedProviderId((current) => {
      if (current && nextProviders.some((item) => item.id === current)) return current;
      const stored = window.sessionStorage.getItem(SELECTED_PROVIDER_KEY) ?? "";
      if (stored && nextProviders.some((item) => item.id === stored)) return stored;
      return nextProviders.length === 1 ? nextProviders[0].id : "";
    });
    return nextProviders;
  }, []);

  const clearServerSession = useCallback(async () => {
    walletStateGeneration.current += 1;
    setWallet("");
    const response = await fetch("/api/wallet", { method: "DELETE" });
    if (!response.ok) throw new Error(await readError(response, "Wallet session could not be cleared."));
  }, []);

  useEffect(() => {
    const initializationTimer = window.setTimeout(refreshProviders, 0);
    const delayedScan = window.setTimeout(refreshProviders, 800);
    const handleFocus = () => refreshProviders();
    window.addEventListener("focus", handleFocus);
    const hydrationGeneration = walletStateGeneration.current;
    fetch("/api/wallet", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, "Wallet session could not be loaded."));
        return response.json() as Promise<{ wallet: string | null }>;
      })
      .then((body) => {
        if (walletStateGeneration.current === hydrationGeneration) setWallet(body.wallet ?? "");
      })
      .catch(() => {
        if (walletStateGeneration.current === hydrationGeneration) setWallet("");
      });

    return () => {
      window.clearTimeout(initializationTimer);
      window.clearTimeout(delayedScan);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshProviders]);

  const selectedProvider = providers.find((item) => item.id === selectedProviderId) ?? null;

  useEffect(() => {
    const provider = selectedProvider?.provider;
    const addressTimer = window.setTimeout(() => {
      setConnectedAddress(provider?.publicKey?.toString() ?? "");
    }, 0);

    const handleAccountChanged = (publicKey?: { toString: () => string } | null) => {
      const nextAddress = publicKey?.toString() ?? "";
      setConnectedAddress(nextAddress);
      setMessage(nextAddress ? "Wallet account changed. Verify this account before launching." : "Wallet disconnected.");
      setMessageTone("neutral");
      if (!verificationInProgress.current) {
        void clearServerSession().catch((error) => {
          setMessage(error instanceof Error ? error.message : "Wallet session could not be cleared.");
          setMessageTone("error");
        });
      }
    };
    const handleDisconnect = () => handleAccountChanged(null);
    provider?.on?.("accountChanged", handleAccountChanged);
    provider?.on?.("disconnect", handleDisconnect);
    return () => {
      window.clearTimeout(addressTimer);
      if (provider?.removeListener) {
        provider.removeListener("accountChanged", handleAccountChanged);
        provider.removeListener("disconnect", handleDisconnect);
      } else {
        provider?.off?.("accountChanged", handleAccountChanged);
        provider?.off?.("disconnect", handleDisconnect);
      }
    };
  }, [clearServerSession, selectedProvider]);

  const verifyProvider = useCallback(async (entry: DetectedSolanaProvider) => {
    const verificationGeneration = walletStateGeneration.current + 1;
    walletStateGeneration.current = verificationGeneration;
    setBusy(true);
    verificationInProgress.current = true;
    setSelectorOpen(false);
    setSelectedProviderId(entry.id);
    window.sessionStorage.setItem(SELECTED_PROVIDER_KEY, entry.id);
    setMessage("");
    setMessageTone("neutral");
    try {
      const provider = entry.provider;
      if (!provider.signMessage) throw new Error(`${entry.name} does not support message signing in this browser.`);
      const result = await provider.connect();
      const walletAddress = result?.publicKey?.toString() ?? provider.publicKey?.toString() ?? "";
      if (!walletAddress) throw new Error(`${entry.name} did not return a Solana address.`);
      setConnectedAddress(walletAddress);
      const challengeResponse = await fetch("/api/wallet/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
      if (!challengeResponse.ok) throw new Error(await readError(challengeResponse, "Wallet verification could not start."));
      const challenge = await challengeResponse.json() as { id: string; message: string };
      const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), "utf8");
      const verifyResponse = await fetch("/api/wallet/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: challenge.id,
          walletAddress,
          signature: bytesToBase64(signed.signature),
        }),
      });
      if (!verifyResponse.ok) throw new Error(await readError(verifyResponse, "Wallet signature could not be verified."));
      if (provider.publicKey?.toString() !== walletAddress) {
        await clearServerSession();
        throw new Error(`The active ${entry.name} account changed during verification. Try again with the current account.`);
      }
      if (walletStateGeneration.current !== verificationGeneration) {
        throw new Error("Wallet verification was superseded by a newer wallet action.");
      }
      setWallet(walletAddress);
      setMessage(`${entry.name} ownership verified for Solana devnet.`);
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet verification failed.");
      setMessageTone("error");
      if (walletStateGeneration.current === verificationGeneration) setWallet("");
    } finally {
      verificationInProgress.current = false;
      setBusy(false);
    }
  }, [clearServerSession]);

  const connectAndVerify = useCallback(async () => {
    setMessage("");
    setMessageTone("neutral");
    const available = refreshProviders();
    if (available.length === 0) {
      setMessage("No compatible injected Solana wallet was detected. Install or enable Phantom, Solflare, Backpack, or Brave Wallet.");
      setMessageTone("error");
      return;
    }
    if (available.length > 1) {
      setSelectorOpen(true);
      return;
    }
    await verifyProvider(available[0]);
  }, [refreshProviders, verifyProvider]);

  const selectProvider = useCallback((providerId: string) => {
    const available = refreshProviders();
    const entry = available.find((item) => item.id === providerId);
    if (!entry) {
      setSelectorOpen(false);
      setMessage("That wallet is no longer available. Reopen the wallet menu and try again.");
      setMessageTone("error");
      return;
    }
    void verifyProvider(entry);
  }, [refreshProviders, verifyProvider]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      const provider = selectedProvider?.provider;
      await clearServerSession();
      await provider?.disconnect?.();
      setConnectedAddress("");
      setSelectedProviderId("");
      window.sessionStorage.removeItem(SELECTED_PROVIDER_KEY);
      setMessage("Wallet disconnected from SportPad.");
      setMessageTone("neutral");
    } finally {
      setBusy(false);
    }
  }, [clearServerSession, selectedProvider]);

  const signTransaction = useCallback(async <T extends SignedTransaction>(transaction: T) => {
    if (!wallet) throw new Error("Verify a Solana wallet before launching.");
    const available = readDetectedProviders();
    const chosen = available.find((item) => item.id === selectedProviderId && item.provider.publicKey?.toString() === wallet)
      ?? available.find((item) => item.provider.publicKey?.toString() === wallet);
    const provider = chosen?.provider;
    if (!provider?.signTransaction) throw new Error("The verified wallet is unavailable or does not support transaction signing.");
    const activeAddress = provider.publicKey?.toString() ?? connectedAddress;
    if (activeAddress !== wallet) throw new Error("The active wallet does not match the verified wallet.");
    return provider.signTransaction(transaction);
  }, [connectedAddress, selectedProviderId, wallet]);

  const value = useMemo<WalletSessionContextValue>(() => ({
    wallet,
    connectedAddress,
    chain: "solana:devnet",
    busy,
    message,
    messageTone,
    providerAvailable,
    connectAndVerify,
    disconnect,
    signTransaction,
  }), [wallet, connectedAddress, busy, message, messageTone, providerAvailable, connectAndVerify, disconnect, signTransaction]);

  return (
    <WalletSessionContext.Provider value={value}>
      {children}
      <SolanaWalletSelector
        open={selectorOpen}
        wallets={providers.map(({ id, name }) => ({ id, name }))}
        busy={busy}
        onCancel={() => setSelectorOpen(false)}
        onSelect={selectProvider}
      />
    </WalletSessionContext.Provider>
  );
}

export function useSolanaWalletSession() {
  const value = useContext(WalletSessionContext);
  if (!value) throw new Error("useSolanaWalletSession must be used inside SolanaWalletSessionProvider.");
  return value;
}
