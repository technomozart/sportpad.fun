"use client";

import { Activity, CirclePause, ExternalLink, RefreshCw, ServerCog, ShieldCheck, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useSolanaWalletSession } from "@/components/solana-wallet-session";
import { collectAndSplitPumpMainnetFees } from "@/lib/client/pump-mainnet";

type Lane = { ready: boolean; missing: string[] };
type OperationsStatus = {
  mode: "execution_ready" | "wallet_confirmed" | "execution_locked";
  controls: {
    settlementPaused: boolean;
    rewardsPaused: boolean;
    buybackPaused: boolean;
    pauseReason: string;
    revision: number;
    updatedAt: string | null;
  };
  readiness: { settlement: Lane; rewards: Lane; buyback: Lane; claims: Lane };
  capabilities: {
    treasuryObserver: boolean;
    finalizedPumpFeeIndexer: boolean;
    holderIndexerEnabled: boolean;
    signerProviderConfigured: boolean;
    workerAuthenticationConfigured: boolean;
  };
  treasuries: {
    reward: string | null;
    buyback: string | null;
    observations: Array<{ purpose: string; address: string; balanceLamports: string; slot: number; observedAt: string }>;
  };
  counts: {
    feeEvents: number;
    settlements: number;
    rewardEpochs: number;
    confirmedClaims: number;
    protocolEvents: number;
    rewardVaults: number;
  };
  workerRuns: Array<{
    worker: string;
    state: string;
    itemsSeen: number;
    itemsChanged: number;
    errorCode: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  feeLaunches: Array<{
    id: string;
    name: string;
    symbol: string;
    mint: string;
    rewardSymbol: string;
    rewardTreasury: string;
    buybackTreasury: string;
  }>;
};

function sol(lamports: string) {
  const amount = BigInt(lamports);
  const whole = amount / 1_000_000_000n;
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, "0").slice(0, 6).replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} SOL`;
}

function shortAddress(address: string | null) {
  return address ? `${address.slice(0, 6)}...${address.slice(-6)}` : "Not configured";
}

export function OperationsConsole() {
  const walletSession = useSolanaWalletSession();
  const [status, setStatus] = useState<OperationsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operator/operations", { cache: "no-store" });
      const body = await response.json() as OperationsStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Operations status failed.");
      setStatus(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operations status failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  async function act(action: "observe_treasuries" | "index_fees" | "pause_all" | "enable_wallet_execution") {
    if (action === "enable_wallet_execution" && !window.confirm("Enable wallet-confirmed reward swaps and SPORTPAD buybacks? Every transaction will still require the matching treasury wallet to review and sign.")) return;
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/operator/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json() as { status?: OperationsStatus; error?: string };
      if (!response.ok || !body.status) throw new Error(body.error ?? "Operation failed.");
      setStatus(body.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operation failed.");
    } finally {
      setBusy("");
    }
  }

  async function collectFees(launch: OperationsStatus["feeLaunches"][number]) {
    if (!walletSession.wallet) {
      await walletSession.connectAndVerify();
      return;
    }
    if (!window.confirm(`Collect finalized Pump creator fees for $${launch.symbol} and distribute them 80% to the ${launch.rewardSymbol} reward treasury and 20% to the SPORTPAD buyback treasury? Your connected wallet pays only the Solana network fee.`)) return;
    setBusy(`collect:${launch.id}`);
    setError("");
    try {
      const result = await collectAndSplitPumpMainnetFees({
        walletAddress: walletSession.wallet,
        mintAddress: launch.mint,
        rewardTreasury: launch.rewardTreasury,
        buybackTreasury: launch.buybackTreasury,
        signTransaction: walletSession.signTransaction,
        onSubmitted: () => undefined,
      });
      await act("index_fees");
      window.open(`https://solscan.io/tx/${encodeURIComponent(result.signature)}`, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Fee collection failed safely.");
    } finally {
      setBusy("");
    }
  }

  const lanes = status ? Object.entries(status.readiness) as Array<[string, Lane]> : [];
  return (
    <section className="operations-console">
      <div className="operations-heading">
        <div><p className="section-eyebrow">Execution control plane</p><h2>Infrastructure operations</h2><p>Observe real treasury state and inspect every safety gate. The app never holds a seed phrase, and treasury spends require the matching wallet to review and sign.</p></div>
        <div className="operations-actions">
          <Button variant="outline" onClick={() => void load()} disabled={loading || Boolean(busy)}><RefreshCw /> Refresh</Button>
          <Button variant="outline" onClick={() => void act("observe_treasuries")} disabled={!status?.capabilities.treasuryObserver || Boolean(busy)}><Activity /> Observe treasuries</Button>
          <Button variant="outline" onClick={() => void act("index_fees")} disabled={!status?.capabilities.finalizedPumpFeeIndexer || Boolean(busy)}><RefreshCw /> Index finalized fees</Button>
          {status?.controls.settlementPaused ? <Button onClick={() => void act("enable_wallet_execution")} disabled={Boolean(busy)}><ShieldCheck /> Enable wallet execution</Button> : null}
          <Button variant="outline" onClick={() => void act("pause_all")} disabled={Boolean(busy)}><CirclePause /> Pause all</Button>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!status && loading ? <div className="operator-empty"><ServerCog /><h2>Loading infrastructure state</h2><p>Reading controls, workers, treasuries, and protocol records.</p></div> : null}
      {status ? (
        <>
          <div className="operations-summary">
            <div><ShieldCheck /><span>Execution mode</span><strong>{status.mode === "execution_ready" ? "Automated" : status.mode === "wallet_confirmed" ? "Wallet confirmed" : "Locked"}</strong><small>Revision {status.controls.revision}, {status.controls.pauseReason.replaceAll("_", " ")}</small></div>
            <div><Wallet /><span>Reward treasury</span><strong>{shortAddress(status.treasuries.reward)}</strong><small>{status.treasuries.observations.find((item) => item.purpose === "reward") ? sol(status.treasuries.observations.find((item) => item.purpose === "reward")!.balanceLamports) : "Not observed yet"}</small></div>
            <div><Wallet /><span>Buyback treasury</span><strong>{shortAddress(status.treasuries.buyback)}</strong><small>{status.treasuries.observations.find((item) => item.purpose === "buyback") ? sol(status.treasuries.observations.find((item) => item.purpose === "buyback")!.balanceLamports) : "Not observed yet"}</small></div>
            <div><ServerCog /><span>Protocol records</span><strong>{status.counts.protocolEvents}</strong><small>{status.counts.feeEvents} verified fee events, indexer {status.capabilities.finalizedPumpFeeIndexer ? "enabled" : "locked"}</small></div>
          </div>
          <div className="operations-lanes">
            {lanes.map(([name, lane]) => <article key={name} className={lane.ready ? "ready" : "locked"}><span>{name}</span><strong>{lane.ready ? "Ready" : "Locked"}</strong><small>{lane.ready ? "All required gates are satisfied" : lane.missing.join(", ")}</small></article>)}
          </div>
          <div className="operations-runs">
            <div><strong>Recent worker runs</strong><small>Treasury observation, fee indexing, and holder indexing are read-only. Treasury transactions remain wallet-confirmed.</small></div>
            {status.workerRuns.length ? status.workerRuns.map((run) => <div key={`${run.worker}:${run.startedAt}`}><code>{run.worker}</code><span>{run.state}</span><small>{run.startedAt}{run.errorCode ? `, ${run.errorCode}` : ""}</small></div>) : <p>No worker runs recorded yet.</p>}
          </div>
          <div className="operations-settlements">
            <div className="operations-settlements-head">
              <span><strong>Published fee routes</strong><small>Permissionless Pump collection verifies the immutable onchain 80/20 route before your wallet can sign.</small></span>
              {!walletSession.wallet ? <Button variant="outline" onClick={() => void walletSession.connectAndVerify()} disabled={walletSession.busy}><Wallet /> Connect operator wallet</Button> : <code>{shortAddress(walletSession.wallet)}</code>}
            </div>
            {status.feeLaunches.length ? status.feeLaunches.map((launch) => (
              <article key={launch.id} className="operations-settlement-row">
                <span><strong>${launch.symbol}</strong><small>{launch.name} · rewards in ${launch.rewardSymbol}</small></span>
                <code>{shortAddress(launch.mint)}</code>
                <Button onClick={() => void collectFees(launch)} disabled={Boolean(busy)}><Activity /> Collect and split</Button>
                <a href={`https://solscan.io/token/${encodeURIComponent(launch.mint)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${launch.symbol} on Solscan`}><ExternalLink /></a>
              </article>
            )) : <p>No verified mainnet launches are published yet. The first published launch will appear here automatically.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}
