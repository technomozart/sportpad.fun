"use client";

import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type SignedTransaction = Transaction | VersionedTransaction;

type SolanaProvider = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  disconnect?: () => Promise<void>;
  publicKey?: { toString: () => string } | null;
  signMessage?: (message: Uint8Array, display?: "utf8") => Promise<{ signature: Uint8Array }>;
  signTransaction?: <T extends SignedTransaction>(transaction: T) => Promise<T>;
  on?: (event: "accountChanged" | "disconnect", handler: (publicKey?: { toString: () => string } | null) => void) => void;
  removeListener?: (event: "accountChanged" | "disconnect", handler: (publicKey?: { toString: () => string } | null) => void) => void;
};

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

function readSolanaProvider() {
  const browser = window as typeof window & {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  };
  return browser.phantom?.solana ?? browser.solana ?? null;
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
  const verificationInProgress = useRef(false);
  const walletStateGeneration = useRef(0);

  const clearServerSession = useCallback(async () => {
    walletStateGeneration.current += 1;
    setWallet("");
    const response = await fetch("/api/wallet", { method: "DELETE" });
    if (!response.ok) throw new Error(await readError(response, "Wallet session could not be cleared."));
  }, []);

  useEffect(() => {
    const provider = readSolanaProvider();
    const initializationTimer = window.setTimeout(() => {
      setProviderAvailable(Boolean(provider));
      setConnectedAddress(provider?.publicKey?.toString() ?? "");
    }, 0);
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
      window.clearTimeout(initializationTimer);
      provider?.removeListener?.("accountChanged", handleAccountChanged);
      provider?.removeListener?.("disconnect", handleDisconnect);
    };
  }, [clearServerSession]);

  const connectAndVerify = useCallback(async () => {
    const verificationGeneration = walletStateGeneration.current + 1;
    walletStateGeneration.current = verificationGeneration;
    setBusy(true);
    verificationInProgress.current = true;
    setMessage("");
    setMessageTone("neutral");
    try {
      const provider = readSolanaProvider();
      if (!provider) throw new Error("No compatible injected Solana wallet was detected.");
      if (!provider.signMessage) throw new Error("This wallet does not support message signing.");
      const result = await provider.connect();
      const walletAddress = result.publicKey.toString();
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
      if (readSolanaProvider()?.publicKey?.toString() !== walletAddress) {
        await clearServerSession();
        throw new Error("The active wallet changed during verification. Try again with the current account.");
      }
      if (walletStateGeneration.current !== verificationGeneration) {
        throw new Error("Wallet verification was superseded by a newer wallet action.");
      }
      setWallet(walletAddress);
      setMessage("Wallet ownership verified for Solana devnet.");
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

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await clearServerSession();
      await readSolanaProvider()?.disconnect?.();
      setConnectedAddress("");
      setMessage("Wallet disconnected from SportPad.");
      setMessageTone("neutral");
    } finally {
      setBusy(false);
    }
  }, [clearServerSession]);

  const signTransaction = useCallback(async <T extends SignedTransaction>(transaction: T) => {
    const provider = readSolanaProvider();
    if (!wallet) throw new Error("Verify a Solana wallet before launching.");
    if (!provider?.signTransaction) throw new Error("This wallet does not support transaction signing.");
    const activeAddress = provider.publicKey?.toString() ?? connectedAddress;
    if (activeAddress !== wallet) throw new Error("The active wallet does not match the verified wallet.");
    return provider.signTransaction(transaction);
  }, [connectedAddress, wallet]);

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

  return <WalletSessionContext.Provider value={value}>{children}</WalletSessionContext.Provider>;
}

export function useSolanaWalletSession() {
  const value = useContext(WalletSessionContext);
  if (!value) throw new Error("useSolanaWalletSession must be used inside SolanaWalletSessionProvider.");
  return value;
}
