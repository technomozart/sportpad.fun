"use client";

import { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Activity, Coins, ExternalLink, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useSolanaWalletSession } from "@/components/solana-wallet-session";
import { Button } from "@/components/ui/button";

type RewardConsoleData = {
  controls: { settlementPaused: boolean; rewardsPaused: boolean } | null;
  launches: Array<{
    id: string; name: string; symbol: string; mint: string; rewardSymbol: string; rewardMint: string; rewardTreasury: string;
  }>;
  epochs: Array<{
    id: string; launchId: string; startsAt: string; endsAt: string; cutoffSlot: number | null;
    fundedAmountAtomic: string; allocatedAmountAtomic: string; dustAmountAtomic: string;
    rewardDecimals: number | null; allocationHash: string | null; state: string;
    launchName: string; launchSymbol: string; rewardSymbol: string;
  }>;
  claims: Array<{
    id: string; epochId: string; wallet: string; amountAtomic: string; signature: string | null;
    state: string; launchName: string; launchSymbol: string; rewardSymbol: string;
    rewardMint: string; rewardDecimals: number; rewardTreasury: string; pendingSignature: string | null;
  }>;
};

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function formatAtomic(value: string, decimals: number) {
  const padded = BigInt(value).toString().padStart(decimals + 1, "0");
  if (!decimals) return padded;
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, 6);
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

export function RewardConsole() {
  const walletSession = useSolanaWalletSession();
  const [data, setData] = useState<RewardConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operator/rewards", { cache: "no-store" });
      const body = await response.json() as RewardConsoleData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Reward operations failed to load.");
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reward operations failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(action: "start_epoch" | "sample_epoch" | "close_epoch", id: string) {
    if (action === "close_epoch" && !window.confirm("Close this epoch now and commit the final Fan Token allocations? The allocation amounts cannot be edited after this step.")) return;
    setBusy(`${action}:${id}`);
    setError("");
    setReceipt("");
    try {
      const response = await fetch("/api/operator/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "start_epoch" ? { action, launchId: id } : { action, epochId: id }),
      });
      const body = await response.json() as { data?: RewardConsoleData; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error ?? "Reward operation failed.");
      setData(body.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reward operation failed.");
    } finally {
      setBusy("");
    }
  }

  async function pay(claim: RewardConsoleData["claims"][number]) {
    if (!walletSession.wallet) {
      await walletSession.connectAndVerify();
      return;
    }
    if (walletSession.wallet !== claim.rewardTreasury) {
      setError(`Switch to and verify the reward treasury ${shortAddress(claim.rewardTreasury)}.`);
      return;
    }
    setBusy(`payout:${claim.id}`);
    setError("");
    setReceipt("");
    try {
      const prepareResponse = await fetch("/api/operator/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare_payout", claimId: claim.id }),
      });
      const plan = await prepareResponse.json() as {
        intentId?: string; transactionBase64?: string; amountAtomic?: string;
        wallet?: string; rewardSymbol?: string; decimals?: number; error?: string;
      };
      if (!prepareResponse.ok || !plan.intentId || !plan.transactionBase64 || plan.decimals === undefined) {
        throw new Error(plan.error ?? "The Fan Token payout could not be prepared.");
      }
      const amount = formatAtomic(plan.amountAtomic ?? "0", plan.decimals);
      if (!window.confirm(`Send ${amount} $${plan.rewardSymbol} to ${shortAddress(plan.wallet ?? claim.wallet)}? Your reward treasury wallet will show the exact SPL Token transfer before signing.`)) return;
      const transaction = Transaction.from(Buffer.from(plan.transactionBase64, "base64"));
      const signed = await walletSession.signTransaction(transaction);
      const submitResponse = await fetch("/api/operator/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_payout",
          intentId: plan.intentId,
          signedTransactionBase64: Buffer.from(signed.serialize()).toString("base64"),
        }),
      });
      const result = await submitResponse.json() as { signature?: string; data?: RewardConsoleData; error?: string };
      if (!submitResponse.ok || !result.signature || !result.data) throw new Error(result.error ?? "The Fan Token payout failed.");
      setReceipt(result.signature);
      setData(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Fan Token payout failed safely.");
    } finally {
      setBusy("");
    }
  }

  async function reconcile(claim: RewardConsoleData["claims"][number]) {
    setBusy(`reconcile:${claim.id}`);
    setError("");
    try {
      const response = await fetch("/api/operator/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile_payout", claimId: claim.id }),
      });
      const result = await response.json() as { signature?: string | null; data?: RewardConsoleData; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error ?? "Payout reconciliation failed.");
      if (result.signature) setReceipt(result.signature);
      setData(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Payout reconciliation failed.");
    } finally {
      setBusy("");
    }
  }

  const paused = !data?.controls || data.controls.settlementPaused || data.controls.rewardsPaused;
  const activeLaunchIds = new Set(data?.epochs.filter((epoch) => epoch.state === "accruing" || epoch.state === "allocating").map((epoch) => epoch.launchId));
  return (
    <section className="settlement-console">
      <div className="settlement-heading">
        <span><p className="section-eyebrow">Fan Token rewards</p><h2>Holder epochs and payouts</h2><p>Index finalized community-token holders, commit time-weighted allocations, then send each official Fan Token payout from the reward treasury.</p></span>
        <Button variant="outline" onClick={() => void load()} disabled={loading || Boolean(busy)}><RefreshCw /> Refresh</Button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {receipt ? <p className="settlement-receipt"><ShieldCheck /> Fan Token payout confirmed <a href={`https://solscan.io/tx/${encodeURIComponent(receipt)}`} target="_blank" rel="noopener noreferrer">View receipt <ExternalLink /></a></p> : null}
      {paused ? <div className="settlement-paused"><ShieldCheck /><span><strong>Reward execution is paused</strong><small>Enable wallet execution before closing epochs or paying allocations.</small></span></div> : null}

      <div className="operations-settlements">
        <div className="operations-settlements-head"><span><strong>Published reward pools</strong><small>An epoch opens only after a verified reward swap funds real official Fan Token inventory.</small></span></div>
        {data?.launches.length ? data.launches.map((launch) => (
          <article key={launch.id} className="operations-settlement-row">
            <span><strong>${launch.symbol}</strong><small>{launch.name}, rewards in ${launch.rewardSymbol}</small></span>
            <code>{shortAddress(launch.rewardMint)}</code>
            <Button onClick={() => void act("start_epoch", launch.id)} disabled={paused || activeLaunchIds.has(launch.id) || Boolean(busy)}><Coins /> Open 24h epoch</Button>
            <a href={`https://solscan.io/token/${encodeURIComponent(launch.rewardMint)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${launch.rewardSymbol} on Solscan`}><ExternalLink /></a>
          </article>
        )) : <p>No verified mainnet reward pools exist yet.</p>}
      </div>

      <div className="settlement-grid">
        {data?.epochs.map((epoch) => (
          <article className="settlement-card" key={epoch.id}>
            <div><span><strong>${epoch.launchSymbol} epoch</strong><small>Rewards in ${epoch.rewardSymbol}</small></span><code>{epoch.state}</code></div>
            <dl>
              <div><dt>Starts</dt><dd>{new Date(epoch.startsAt).toLocaleString()}</dd></div>
              <div><dt>Allocation</dt><dd>{epoch.rewardDecimals === null ? "Accruing" : `${formatAtomic(epoch.allocatedAmountAtomic, epoch.rewardDecimals)} $${epoch.rewardSymbol}`}</dd></div>
            </dl>
            {epoch.state === "accruing" ? <div className="settlement-actions"><Button variant="outline" onClick={() => void act("sample_epoch", epoch.id)} disabled={Boolean(busy)}><Activity /> Index holders</Button><Button onClick={() => void act("close_epoch", epoch.id)} disabled={paused || Boolean(busy)}><ShieldCheck /> Close and allocate</Button></div> : null}
            {epoch.allocationHash ? <small className="settlement-note">Allocation proof {epoch.allocationHash.slice(0, 16)}... at slot {epoch.cutoffSlot}</small> : null}
          </article>
        ))}
      </div>

      <div className="operations-settlements">
        <div className="operations-settlements-head"><span><strong>Ready payouts</strong><small>Each exact transfer requires the verified 80% reward treasury wallet.</small></span>{walletSession.wallet ? <code>{shortAddress(walletSession.wallet)}</code> : <Button variant="outline" onClick={() => void walletSession.connectAndVerify()} disabled={walletSession.busy}><Wallet /> Verify reward treasury</Button>}</div>
        {data?.claims.length ? data.claims.map((claim) => (
          <article key={claim.id} className="operations-settlement-row">
            <span><strong>{formatAtomic(claim.amountAtomic, claim.rewardDecimals)} ${claim.rewardSymbol}</strong><small>${claim.launchSymbol} holder {shortAddress(claim.wallet)}</small></span>
            <code>{claim.state}</code>
            {claim.state === "submission_unknown" ? <Button variant="outline" onClick={() => void reconcile(claim)} disabled={Boolean(busy)}><RefreshCw /> Reconcile</Button> : <Button onClick={() => void pay(claim)} disabled={paused || claim.state !== "claimable" || Boolean(busy)}><Coins /> Send payout</Button>}
            {claim.signature || claim.pendingSignature ? <a href={`https://solscan.io/tx/${encodeURIComponent(claim.signature ?? claim.pendingSignature ?? "")}`} target="_blank" rel="noopener noreferrer"><ExternalLink /></a> : <span />}
          </article>
        )) : <p>No finalized holder allocations are waiting for payout.</p>}
      </div>
    </section>
  );
}
