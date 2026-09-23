"use client";

import { useState } from "react";

type MarketAudit = {
  quoteAvailable: boolean;
  executionApproved: false;
  depthImpactBps: number | null;
  reason: string;
};

function auditMessage(audit: MarketAudit) {
  if (audit.reason === "quote_available") {
    return `Direct V2 quotes found at 1 and 100 CHZ. Estimated 100 CHZ depth impact: ${((audit.depthImpactBps ?? 0) / 100).toFixed(2)}%. Rewards remain paused.`;
  }
  if (audit.reason === "shallow_depth") {
    return `Direct V2 quotes found, but the 100 CHZ depth impact is ${((audit.depthImpactBps ?? 0) / 100).toFixed(2)}%. Rewards remain paused.`;
  }
  if (audit.reason === "wrong_decimals") return "The token did not report the expected 18 decimals. Rewards remain paused.";
  if (audit.reason === "wrong_chain") return "The Chiliz RPC returned the wrong network. Rewards remain paused.";
  if (audit.reason === "no_contract") return "The listed V2 address did not return contract code. Rewards remain paused.";
  if (audit.reason === "dust_quote") return "Kayen returned only a negligible token amount. Rewards remain paused.";
  if (audit.reason === "provider_unavailable") return "The Chiliz RPC could not be checked right now. Rewards remain paused.";
  return "Kayen did not return a usable direct V2 quote at both sizes. Rewards remain paused.";
}

export function RouteAuditCell({ symbol }: { symbol: string }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  async function check() {
    setChecking(true);
    setMessage("");
    try {
      const response = await fetch(`/api/reward-routes/${encodeURIComponent(symbol)}?chain=chiliz`, { cache: "no-store" });
      if (!response.ok) throw new Error("Route check failed");
      const body = await response.json() as { market?: MarketAudit };
      if (!body.market || body.market.executionApproved !== false) throw new Error("Route check incomplete");
      setMessage(auditMessage(body.market));
    } catch {
      setMessage("The read-only route check is unavailable. Rewards remain paused.");
    } finally {
      setChecking(false);
    }
  }

  return <div className="registry-route-check">
    <button type="button" onClick={check} disabled={checking}>{checking ? "Checking market..." : "Check V2 market"}</button>
    {message && <span role="status">{message}</span>}
  </div>;
}
