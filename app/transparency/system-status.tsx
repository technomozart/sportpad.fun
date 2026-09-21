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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("health request failed");
        return response.json() as Promise<HealthResponse>;
      })
      .then(setHealth)
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
      <div><span className="neutral" /><strong>Fee indexer</strong><small>Worker not deployed</small><code>NOT DEPLOYED</code></div>
      <div><span className="neutral" /><strong>Reward inventory</strong><small>No reward vaults are deployed</small><code>NOT DEPLOYED</code></div>
      <div><span className="neutral" /><strong>Claims</strong><small>Claim program not deployed</small><code>NOT DEPLOYED</code></div>
      <div><span className="neutral" /><strong>Cross-chain</strong><small>No replenishment route is enabled</small><code>NOT ENABLED</code></div>
    </div>
  );
}
