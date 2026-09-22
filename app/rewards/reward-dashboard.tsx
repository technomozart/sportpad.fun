"use client";

import { CheckCircle2, Clock3, Coins, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { useSolanaWalletSession } from "@/components/solana-wallet-session";

type RewardProtocolStatus = {
  readiness: { rewards: { ready: boolean; missing: string[] }; claims: { ready: boolean; missing: string[] } };
  capabilities: { holderIndexerEnabled: boolean };
  counts: { rewardEpochs: number; confirmedClaims: number; rewardVaults: number };
};

export function RewardDashboard() {
  const walletSession = useSolanaWalletSession();
  const [protocol, setProtocol] = useState<RewardProtocolStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/protocol/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("status unavailable")))
      .then((value) => setProtocol(value as RewardProtocolStatus))
      .catch((error) => { if ((error as Error).name !== "AbortError") setProtocol(null); });
    return () => controller.abort();
  }, []);
  const walletLabel = walletSession.wallet
    ? `${walletSession.wallet.slice(0, 5)}...${walletSession.wallet.slice(-5)}`
    : "Not connected";
  const lifecycle = [
    { icon: Coins, title: "Earning", copy: protocol?.capabilities.holderIndexerEnabled ? "Holder indexer enabled" : "Holder indexer locked" },
    { icon: Clock3, title: "Closing", copy: protocol ? `${protocol.counts.rewardEpochs} reward epochs` : "Reading epoch ledger" },
    { icon: Wallet, title: "Funding", copy: protocol ? `${protocol.counts.rewardVaults} verified vaults` : "Reading vault ledger" },
    { icon: CheckCircle2, title: "Claimable", copy: protocol?.readiness.claims.ready ? "Claim lane ready" : "Claim lane locked" },
  ];

  return (
    <div>
      <div className="reward-summary-grid">
        <div className="reward-summary-primary">
          <span>Wallet-linked reward data</span>
          <strong>{walletLabel}</strong>
          <small>{walletSession.wallet ? "Wallet verified. Positions appear only after finalized holder indexing and a funded epoch." : "Verify a wallet to establish ownership. No balances are estimated without finalized index data."}</small>
        </div>
        <div><span>Reward epochs</span><strong>{protocol?.counts.rewardEpochs ?? "Unavailable"}</strong><small>{protocol?.capabilities.holderIndexerEnabled ? "Holder indexing enabled" : "Holder indexing locked"}</small></div>
        <div><span>Confirmed claims</span><strong>{protocol?.counts.confirmedClaims ?? "Unavailable"}</strong><small>{protocol?.readiness.claims.ready ? "Claim lane ready" : "Claim lane locked"}</small></div>
        <div><span>Reward vaults</span><strong>{protocol?.counts.rewardVaults ?? "Unavailable"}</strong><small>{protocol?.readiness.rewards.ready ? "Reward lane ready" : "No funded inventory available"}</small></div>
      </div>

      <div className="dashboard-notice">
        <ShieldCheck />
        <span>SportPad does not display estimated balances, claim amounts, or lifetime rewards without verified wallet ownership and reconciled protocol data.</span>
      </div>

      <div className="dashboard-toolbar">
        <div><Wallet /><span>Verified wallet <code>{walletLabel}</code></span></div>
        <span className="claim-status">{protocol?.readiness.claims.ready ? "Claims ready" : "Claims locked"}</span>
      </div>

      <div className="positions-table">
        <div className="positions-head"><span>Community position</span><span>Balance</span><span>Reward</span><span>Current estimate</span><span>Claimable</span><span>Status</span><span /></div>
        <div className="empty-state">
          <Wallet />
          <h2>No reward positions to show.</h2>
          <p>Real positions will appear only after wallet verification, public launches, finalized holder indexing, funded reward epochs, and claim reconciliation.</p>
        </div>
      </div>

      <div className="reward-lifecycle">
        {lifecycle.map((item, index) => (
          <div key={item.title}>
            <span>{index + 1}</span>
            <item.icon />
            <strong>{item.title}</strong>
            <small>{item.copy}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
