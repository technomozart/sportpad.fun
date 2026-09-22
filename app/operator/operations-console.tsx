"use client";

import { Activity, CirclePause, RefreshCw, ServerCog, ShieldCheck, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type Lane = { ready: boolean; missing: string[] };
type OperationsStatus = {
  mode: "execution_ready" | "execution_locked";
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

  async function act(action: "observe_treasuries" | "index_fees" | "pause_all") {
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

  const lanes = status ? Object.entries(status.readiness) as Array<[string, Lane]> : [];
  return (
    <section className="operations-console">
      <div className="operations-heading">
        <div><p className="section-eyebrow">Execution control plane</p><h2>Infrastructure operations</h2><p>Observe real treasury state and inspect every safety gate. No button on this screen can sign a swap, claim, or burn transaction.</p></div>
        <div className="operations-actions">
          <Button variant="outline" onClick={() => void load()} disabled={loading || Boolean(busy)}><RefreshCw /> Refresh</Button>
          <Button variant="outline" onClick={() => void act("observe_treasuries")} disabled={!status?.capabilities.treasuryObserver || Boolean(busy)}><Activity /> Observe treasuries</Button>
          <Button variant="outline" onClick={() => void act("index_fees")} disabled={!status?.capabilities.finalizedPumpFeeIndexer || Boolean(busy)}><RefreshCw /> Index finalized fees</Button>
          <Button variant="outline" onClick={() => void act("pause_all")} disabled={Boolean(busy)}><CirclePause /> Pause all</Button>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!status && loading ? <div className="operator-empty"><ServerCog /><h2>Loading infrastructure state</h2><p>Reading controls, workers, treasuries, and protocol records.</p></div> : null}
      {status ? (
        <>
          <div className="operations-summary">
            <div><ShieldCheck /><span>Execution mode</span><strong>{status.mode === "execution_ready" ? "Ready" : "Locked"}</strong><small>Revision {status.controls.revision}, {status.controls.pauseReason.replaceAll("_", " ")}</small></div>
            <div><Wallet /><span>Reward treasury</span><strong>{shortAddress(status.treasuries.reward)}</strong><small>{status.treasuries.observations.find((item) => item.purpose === "reward") ? sol(status.treasuries.observations.find((item) => item.purpose === "reward")!.balanceLamports) : "Not observed yet"}</small></div>
            <div><Wallet /><span>Buyback treasury</span><strong>{shortAddress(status.treasuries.buyback)}</strong><small>{status.treasuries.observations.find((item) => item.purpose === "buyback") ? sol(status.treasuries.observations.find((item) => item.purpose === "buyback")!.balanceLamports) : "Not observed yet"}</small></div>
            <div><ServerCog /><span>Protocol records</span><strong>{status.counts.protocolEvents}</strong><small>{status.counts.feeEvents} verified fee events, indexer {status.capabilities.finalizedPumpFeeIndexer ? "enabled" : "locked"}</small></div>
          </div>
          <div className="operations-lanes">
            {lanes.map(([name, lane]) => <article key={name} className={lane.ready ? "ready" : "locked"}><span>{name}</span><strong>{lane.ready ? "Ready" : "Locked"}</strong><small>{lane.ready ? "All required gates are satisfied" : lane.missing.join(", ")}</small></article>)}
          </div>
          <div className="operations-runs">
            <div><strong>Recent worker runs</strong><small>Treasury observation and fee indexing are read-only. Transaction workers remain locked.</small></div>
            {status.workerRuns.length ? status.workerRuns.map((run) => <div key={`${run.worker}:${run.startedAt}`}><code>{run.worker}</code><span>{run.state}</span><small>{run.startedAt}{run.errorCode ? `, ${run.errorCode}` : ""}</small></div>) : <p>No worker runs recorded yet.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}
