"use client";

import { ArrowRightLeft, ExternalLink, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { Buffer } from "buffer";

import { useSolanaWalletSession } from "@/components/solana-wallet-session";
import { Button } from "@/components/ui/button";

type SettlementItem = {
  settlementId: string;
  state: string;
  launchName: string;
  launchSymbol: string;
  rewardSymbol: string;
  rewardMint: string;
  rewardAmountAtomic: string;
  buybackAmountAtomic: string;
  rewardTreasury: string;
  buybackTreasury: string;
  rewardSwapSignature: string | null;
  buybackSwapSignature: string | null;
  burnSignature: string | null;
  buybackOutputAtomic: string | null;
};

type SettlementResponse = {
  controls: {
    settlementPaused: boolean;
    rewardsPaused: boolean;
    buybackPaused: boolean;
    pauseReason: string;
  } | null;
  sportpadMint: string | null;
  items: SettlementItem[];
  error?: string;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function sol(lamports: string) {
  const value = BigInt(lamports);
  const whole = value / 1_000_000_000n;
  const decimal = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}${decimal ? `.${decimal}` : ""} SOL`;
}

export function SettlementConsole() {
  const walletSession = useSolanaWalletSession();
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operator/swaps", { cache: "no-store" });
      const body = await response.json() as SettlementResponse;
      if (!response.ok) throw new Error(body.error ?? "Settlement queue unavailable.");
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settlement queue unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function swap(item: SettlementItem, leg: "reward" | "buyback") {
    const expectedWallet = leg === "reward" ? item.rewardTreasury : item.buybackTreasury;
    if (!walletSession.wallet) {
      await walletSession.connectAndVerify();
      return;
    }
    if (walletSession.wallet !== expectedWallet) {
      setError(`Switch to ${shortAddress(expectedWallet)} and verify that ${leg === "reward" ? "reward" : "buyback"} treasury wallet.`);
      return;
    }
    setBusy(`${item.settlementId}:${leg}`);
    setError("");
    setReceipt("");
    try {
      const prepareResponse = await fetch("/api/operator/swaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare_swap", settlementId: item.settlementId, leg }),
      });
      const plan = await prepareResponse.json() as {
        intentId?: string;
        transactionBase64?: string;
        inputAmountAtomic?: string;
        quotedOutputAtomic?: string;
        minimumOutputAtomic?: string;
        priceImpactPercent?: number;
        error?: string;
      };
      if (!prepareResponse.ok || !plan.intentId || !plan.transactionBase64) {
        throw new Error(plan.error ?? "Jupiter order could not be prepared.");
      }
      const label = leg === "reward" ? `$${item.rewardSymbol} reward inventory` : "SPORTPAD for permanent burn";
      const confirmed = window.confirm(
        `Swap ${sol(plan.inputAmountAtomic ?? "0")} into ${label}?\n\nQuoted output: ${plan.quotedOutputAtomic ?? "unknown"} atomic units\nMinimum output: ${plan.minimumOutputAtomic ?? "unknown"} atomic units\nPrice impact: ${plan.priceImpactPercent ?? "unknown"}%\n\nYour wallet will show the exact transaction before signing.`,
      );
      if (!confirmed) return;
      const transaction = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
      const signed = await walletSession.signTransaction(transaction);
      const submitResponse = await fetch("/api/operator/swaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_swap",
          intentId: plan.intentId,
          signedTransactionBase64: Buffer.from(signed.serialize()).toString("base64"),
        }),
      });
      const result = await submitResponse.json() as { signature?: string; error?: string };
      if (!submitResponse.ok || !result.signature) throw new Error(result.error ?? "Jupiter transaction submission failed.");
      setReceipt(result.signature);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The swap failed safely.");
    } finally {
      setBusy("");
    }
  }

  async function burn(item: SettlementItem) {
    if (!walletSession.wallet) {
      await walletSession.connectAndVerify();
      return;
    }
    if (walletSession.wallet !== item.buybackTreasury) {
      setError(`Switch to ${shortAddress(item.buybackTreasury)} and verify the buyback treasury wallet.`);
      return;
    }
    setBusy(`${item.settlementId}:burn`);
    setError("");
    setReceipt("");
    try {
      const prepareResponse = await fetch("/api/operator/swaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare_burn", settlementId: item.settlementId }),
      });
      const plan = await prepareResponse.json() as { intentId?: string; transactionBase64?: string; burnAmountAtomic?: string; error?: string };
      if (!prepareResponse.ok || !plan.intentId || !plan.transactionBase64 || !plan.burnAmountAtomic) {
        throw new Error(plan.error ?? "The SPORTPAD burn could not be prepared.");
      }
      if (!window.confirm(`Permanently burn ${plan.burnAmountAtomic} atomic units of SPORTPAD bought by this settlement? This action is irreversible and your wallet will show the exact burn transaction.`)) return;
      const transaction = Transaction.from(Buffer.from(plan.transactionBase64, "base64"));
      const signed = await walletSession.signTransaction(transaction);
      const submitResponse = await fetch("/api/operator/swaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_burn",
          intentId: plan.intentId,
          signedTransactionBase64: Buffer.from(signed.serialize()).toString("base64"),
        }),
      });
      const result = await submitResponse.json() as { signature?: string; error?: string };
      if (!submitResponse.ok || !result.signature) throw new Error(result.error ?? "The SPORTPAD burn submission failed.");
      setReceipt(result.signature);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The SPORTPAD burn failed safely.");
    } finally {
      setBusy("");
    }
  }

  const paused = !data?.controls || data.controls.settlementPaused;
  return (
    <section className="settlement-console">
      <div className="settlement-heading">
        <span><p className="section-eyebrow">Treasury execution</p><h2>Verified settlements</h2><p>Swap each finalized 80% allocation into its official Fan Token and each 20% allocation into SPORTPAD. Every spend requires the matching treasury wallet.</p></span>
        <Button variant="outline" onClick={() => void load()} disabled={loading || Boolean(busy)}><RefreshCw /> Refresh</Button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {receipt ? <p className="settlement-receipt"><ShieldCheck /> Transaction submitted <a href={`https://solscan.io/tx/${encodeURIComponent(receipt)}`} target="_blank" rel="noopener noreferrer">View receipt <ExternalLink /></a></p> : null}
      {paused ? <div className="settlement-paused"><ShieldCheck /><span><strong>Wallet execution is paused</strong><small>Use the execution control above to enable wallet-confirmed settlements. Managed automation remains locked.</small></span></div> : null}
      {!loading && data && !data.items.length ? <div className="operator-empty"><ArrowRightLeft /><h3>No funded settlements yet</h3><p>Finalized Pump fee distributions appear here after the fee indexer verifies them.</p></div> : null}
      <div className="settlement-grid">
        {data?.items.map((item) => {
          const rewardReady = !paused && !data.controls?.rewardsPaused && !item.rewardSwapSignature;
          const buybackReady = !paused && !data.controls?.buybackPaused && Boolean(data.sportpadMint) && !item.buybackSwapSignature;
          return (
            <article key={item.settlementId} className="settlement-card">
              <div><span><strong>${item.launchSymbol}</strong><small>{item.launchName}</small></span><code>{item.state.replaceAll("_", " ")}</code></div>
              <dl>
                <div><dt>80% reward leg</dt><dd>{sol(item.rewardAmountAtomic)} into ${item.rewardSymbol}</dd></div>
                <div><dt>20% SPORTPAD leg</dt><dd>{sol(item.buybackAmountAtomic)} into SPORTPAD, then burn</dd></div>
              </dl>
              <div className="settlement-actions">
                {item.rewardSwapSignature ? <a href={`https://solscan.io/tx/${encodeURIComponent(item.rewardSwapSignature)}`} target="_blank" rel="noopener noreferrer">Reward swap receipt <ExternalLink /></a> : <Button onClick={() => void swap(item, "reward")} disabled={!rewardReady || Boolean(busy)}><ArrowRightLeft /> Buy ${item.rewardSymbol}</Button>}
                {item.buybackSwapSignature ? <a href={`https://solscan.io/tx/${encodeURIComponent(item.buybackSwapSignature)}`} target="_blank" rel="noopener noreferrer">Buyback receipt <ExternalLink /></a> : <Button onClick={() => void swap(item, "buyback")} disabled={!buybackReady || Boolean(busy)}><ArrowRightLeft /> Buy SPORTPAD</Button>}
                {item.burnSignature ? <a href={`https://solscan.io/tx/${encodeURIComponent(item.burnSignature)}`} target="_blank" rel="noopener noreferrer">SPORTPAD burn receipt <ExternalLink /></a> : item.buybackSwapSignature ? <Button onClick={() => void burn(item)} disabled={paused || !item.buybackOutputAtomic || Boolean(busy)}><ShieldCheck /> Burn SPORTPAD</Button> : null}
              </div>
              {!data.sportpadMint ? <small className="settlement-note">SPORTPAD buyback remains locked until the SPORTPAD mint address is configured.</small> : null}
              {!walletSession.wallet ? <Button variant="outline" onClick={() => void walletSession.connectAndVerify()} disabled={walletSession.busy}><Wallet /> Verify a treasury wallet</Button> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
