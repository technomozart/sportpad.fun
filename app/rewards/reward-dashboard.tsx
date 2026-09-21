"use client";

import { CheckCircle2, Clock3, Coins, ShieldCheck, Wallet } from "lucide-react";

import { useSolanaWalletSession } from "@/components/solana-wallet-session";

export function RewardDashboard() {
  const walletSession = useSolanaWalletSession();
  const walletLabel = walletSession.wallet
    ? `${walletSession.wallet.slice(0, 5)}...${walletSession.wallet.slice(-5)}`
    : "Not connected";
  const lifecycle = [
    { icon: Coins, title: "Earning", copy: "Indexer not deployed" },
    { icon: Clock3, title: "Closing", copy: "No reward epochs yet" },
    { icon: Wallet, title: "Funding", copy: "No reward vaults yet" },
    { icon: CheckCircle2, title: "Claimable", copy: "Claims not deployed" },
  ];

  return (
    <div>
      <div className="reward-summary-grid">
        <div className="reward-summary-primary">
          <span>Wallet-linked reward data</span>
          <strong>{walletLabel}</strong>
          <small>{walletSession.wallet ? "Wallet verified. The reward indexer is not deployed yet." : "Verify a wallet to establish ownership. No live reward indexer is deployed yet."}</small>
        </div>
        <div><span>Reward positions</span><strong>No data</strong><small>No live reward indexer is deployed</small></div>
        <div><span>Claim program</span><strong>Not deployed</strong><small>No claim can be submitted</small></div>
        <div><span>Reward vaults</span><strong>Not deployed</strong><small>No official Fan Token inventory is held</small></div>
      </div>

      <div className="dashboard-notice">
        <ShieldCheck />
        <span>SportPad does not display estimated balances, claim amounts, or lifetime rewards without verified wallet ownership and reconciled protocol data.</span>
      </div>

      <div className="dashboard-toolbar">
        <div><Wallet /><span>Verified wallet <code>{walletLabel}</code></span></div>
        <span className="claim-status">Claims not deployed</span>
      </div>

      <div className="positions-table">
        <div className="positions-head"><span>Community position</span><span>Balance</span><span>Reward</span><span>Current estimate</span><span>Claimable</span><span>Status</span><span /></div>
        <div className="empty-state">
          <Wallet />
          <h2>No reward positions to show.</h2>
          <p>Real positions will appear only after wallet verification, public launches, a deployed indexer, funded reward epochs, and claim reconciliation.</p>
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
