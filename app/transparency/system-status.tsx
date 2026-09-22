"use client";

import { useEffect, useState } from "react";

type ProviderState = {
  configured: boolean;
  healthy: boolean;
  checkedAt: string;
  detail: "operational" | "not_configured" | "timeout" | "authentication_failed" | "rate_limited" | "upstream_unavailable" | "invalid_response" | "network_error";
};

type HealthResponse = {
  status: "ok" | "degraded" | "configuration_required";
  providers: { helius: ProviderState; jupiter: ProviderState };
  mainnetExecution: boolean;
  mainnetMissing: string[];
  sportpadMintConfigured: boolean;
};

type ProtocolResponse = {
  mode: "execution_ready" | "wallet_confirmed" | "execution_locked";
  readiness: Record<"settlement" | "rewards" | "buyback" | "claims", { ready: boolean; missing: string[] }>;
  capabilities: { treasuryObserver: boolean; finalizedPumpFeeIndexer: boolean; holderIndexerEnabled: boolean; signerProviderConfigured: boolean; workerAuthenticationConfigured: boolean; walletExecutionEnabled: boolean; unattendedAutomation: boolean };
  automation: { chilizActive: boolean; solanaActive: boolean };
  counts: { feeEvents: number; settlements: number; rewardEpochs: number; confirmedClaims: number; protocolEvents: number; rewardVaults: number; rewardSwaps: number; buybackSwaps: number; sportpadBurns: number };
};

const detailLabel: Record<ProviderState["detail"], string> = {
  operational: "Live canary passed",
  not_configured: "Server credential not configured",
  timeout: "Live canary timed out",
  authentication_failed: "Credential rejected",
  rate_limited: "Provider rate limited",
  upstream_unavailable: "Provider unavailable",
  invalid_response: "Unexpected provider response",
  network_error: "Network check failed",
};

export function SystemStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [protocol, setProtocol] = useState<ProtocolResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/health", { cache: "no-store", signal: controller.signal }),
      fetch("/api/protocol/status", { cache: "no-store", signal: controller.signal }),
    ])
      .then(async ([healthResponse, protocolResponse]) => {
        if (!healthResponse.ok || !protocolResponse.ok) throw new Error("status request failed");
        const [nextHealth, nextProtocol] = await Promise.all([
          healthResponse.json() as Promise<HealthResponse>,
          protocolResponse.json() as Promise<ProtocolResponse>,
        ]);
        setHealth(nextHealth);
        setProtocol(nextProtocol);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const providers = health
    ? [
        { name: "Helius RPC", ...health.providers.helius },
        { name: "Jupiter quotes", ...health.providers.jupiter },
      ]
    : [];

  return (
    <div className="status-grid" aria-live="polite">
      {!health && !failed ? <div><span className="neutral" /><strong>Provider canaries</strong><small>Running live read-only checks…</small><code>CHECKING</code></div> : null}
      {failed ? <div><span className="danger" /><strong>Provider canaries</strong><small>Health endpoint could not be reached</small><code>UNAVAILABLE</code></div> : null}
      {providers.map((provider) => (
        <div key={provider.name}>
          <span className={provider.healthy ? "healthy" : provider.configured ? "warning" : "neutral"} />
          <strong>{provider.name}</strong>
          <small>{detailLabel[provider.detail]}</small>
          <code>{provider.healthy ? "OPERATIONAL" : provider.configured ? "DEGRADED" : "NOT CONFIGURED"}</code>
        </div>
      ))}
      <div><span className={health?.mainnetExecution ? "healthy" : "warning"} /><strong>Mainnet launcher</strong><small>{health?.mainnetExecution ? "Pump launch and fee-lock path enabled" : health?.mainnetMissing.join(", ") || "Configuration unavailable"}</small><code>{health?.mainnetExecution ? "ENABLED" : "SETUP REQUIRED"}</code></div>
      <div><span className={protocol?.capabilities.walletExecutionEnabled ? "healthy" : "warning"} /><strong>Settlement lane</strong><small>{protocol ? `${protocol.counts.feeEvents} finalized fee events observed` : "Loading control state"}</small><code>{protocol?.capabilities.walletExecutionEnabled ? "WALLET READY" : "PAUSED"}</code></div>
      <div><span className={protocol?.capabilities.holderIndexerEnabled ? "healthy" : "warning"} /><strong>Reward inventory</strong><small>{protocol ? `${protocol.counts.rewardVaults} verified reward vaults and ${protocol.counts.rewardEpochs} epochs` : "Loading inventory state"}</small><code>{protocol?.capabilities.holderIndexerEnabled ? "INDEXING READY" : "LOCKED"}</code></div>
      <div><span className={protocol?.automation.chilizActive || protocol?.automation.solanaActive ? "healthy" : "warning"} /><strong>Fan Token payouts</strong><small>{protocol ? `${protocol.counts.confirmedClaims} confirmed payouts` : "Loading payout state"}</small><code>{protocol?.automation.chilizActive || protocol?.automation.solanaActive ? "WORKER ACTIVE" : "PAUSED"}</code></div>
      <div><span className={protocol?.capabilities.treasuryObserver ? "healthy" : "neutral"} /><strong>Treasury observer</strong><small>{protocol?.capabilities.treasuryObserver ? "Finalized read-only balance checks available" : "Treasury addresses required"}</small><code>{protocol?.capabilities.treasuryObserver ? "AVAILABLE" : "LOCKED"}</code></div>
      <div><span className={protocol?.capabilities.finalizedPumpFeeIndexer ? "healthy" : "neutral"} /><strong>Pump fee indexer</strong><small>{protocol?.capabilities.finalizedPumpFeeIndexer ? "Finalized exact 80/20 distributions are indexed" : "Read-only worker is disabled"}</small><code>{protocol?.capabilities.finalizedPumpFeeIndexer ? "ENABLED" : "LOCKED"}</code></div>
      <div><span className={protocol?.capabilities.walletExecutionEnabled ? "healthy" : "warning"} /><strong>Wallet settlement console</strong><small>{protocol?.capabilities.walletExecutionEnabled ? "Exact Jupiter and burn intents require treasury signatures" : "Operator control plane is paused"}</small><code>{protocol?.capabilities.walletExecutionEnabled ? "ENABLED" : "PAUSED"}</code></div>
      <div><span className={protocol?.capabilities.unattendedAutomation ? "healthy" : "neutral"} /><strong>Unattended automation</strong><small>{protocol?.capabilities.unattendedAutomation ? "A restricted treasury worker reported recently" : "No automation worker heartbeat observed"}</small><code>{protocol?.capabilities.unattendedAutomation ? "ACTIVE" : "OFF"}</code></div>
      <div><span className={protocol?.automation.chilizActive ? "healthy" : "neutral"} /><strong>Chiliz reward lane</strong><small>{protocol?.automation.chilizActive ? "Prefunded CHZ acquisition and sponsored claims active" : "Chiliz treasury worker not observed"}</small><code>{protocol?.automation.chilizActive ? "ACTIVE" : "OFF"}</code></div>
    </div>
  );
}
