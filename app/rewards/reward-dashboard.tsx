"use client";

import { CheckCircle2, Clock3, Coins, ExternalLink, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { useSolanaWalletSession } from "@/components/solana-wallet-session";
import { Button } from "@/components/ui/button";

type RewardProtocolStatus = {
  readiness: { rewards: { ready: boolean; missing: string[] }; claims: { ready: boolean; missing: string[] } };
  capabilities: { holderIndexerEnabled: boolean };
  counts: { rewardEpochs: number; confirmedClaims: number; rewardVaults: number };
};

type WalletRewardData = {
  claims: Array<{
    id: string; epochId: string; amountAtomic: string; signature: string | null; state: string;
    launchName: string; launchSymbol: string; rewardSymbol: string; rewardDecimals: number; cutoffSlot: number | null;
  }>;
  positions: Array<{
    epochId: string; launchName: string; launchSymbol: string; rewardSymbol: string;
    tokenSecondsAtomic: string; endingBalanceAtomic: string; lastObservedSlot: number | null; epochState: string;
  }>;
};

function formatAtomic(value: string, decimals: number) {
  const amount = BigInt(value);
  if (decimals === 0) return amount.toString();
  const padded = amount.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, 6);
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

function shortAtomic(value: string) {
  const amount = BigInt(value);
  if (amount < 1_000_000n) return amount.toString();
  return `${amount.toString().slice(0, -6)}M atomic`;
}

function payoutState(state: string) {
  if (state === "confirmed") return "Paid";
  if (state === "submission_unknown") return "Reconciliation pending";
  if (state === "submitting" || state === "submitted") return "Submitting";
  return "Ready for payout";
}

export function RewardDashboard() {
  const walletSession = useSolanaWalletSession();
  const [protocol, setProtocol] = useState<RewardProtocolStatus | null>(null);
  const [walletData, setWalletData] = useState<WalletRewardData | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/protocol/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("status unavailable")))
      .then((value) => setProtocol(value as RewardProtocolStatus))
      .catch((error) => { if ((error as Error).name !== "AbortError") setProtocol(null); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!walletSession.wallet) return;
    const controller = new AbortController();
    fetch("/api/rewards", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("wallet rewards unavailable")))
      .then((value) => setWalletData(value as WalletRewardData))
      .catch((error) => { if ((error as Error).name !== "AbortError") setWalletData(null); });
    return () => controller.abort();
  }, [walletSession.wallet]);
  const walletLabel = walletSession.wallet
    ? `${walletSession.wallet.slice(0, 5)}...${walletSession.wallet.slice(-5)}`
    : "Not connected";
  const visibleWalletData = walletSession.wallet ? walletData : null;
  const lifecycle = [
    { icon: Coins, title: "Earning", copy: protocol?.capabilities.holderIndexerEnabled ? "Holder indexer enabled" : "Holder indexer locked" },
    { icon: Clock3, title: "Closing", copy: protocol ? `${protocol.counts.rewardEpochs} reward epochs` : "Reading epoch ledger" },
    { icon: Wallet, title: "Funding", copy: protocol ? `${protocol.counts.rewardVaults} verified vaults` : "Reading vault ledger" },
    { icon: CheckCircle2, title: "Payout", copy: "Reward treasury reviews and signs exact transfers" },
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
        <div><span>Confirmed payouts</span><strong>{protocol?.counts.confirmedClaims ?? "Unavailable"}</strong><small>Verified Solana transfer receipts only</small></div>
        <div><span>Reward vaults</span><strong>{protocol?.counts.rewardVaults ?? "Unavailable"}</strong><small>{protocol?.readiness.rewards.ready ? "Reward lane ready" : "No funded inventory available"}</small></div>
      </div>

      <div className="dashboard-notice">
        <ShieldCheck />
        <span>SportPad does not display estimated balances, claim amounts, or lifetime rewards without verified wallet ownership and reconciled protocol data.</span>
      </div>

      <div className="dashboard-toolbar">
        <div><Wallet /><span>Verified wallet <code>{walletLabel}</code></span></div>
        {!walletSession.wallet ? <Button onClick={() => void walletSession.connectAndVerify()} disabled={walletSession.busy}><Wallet /> Verify wallet</Button> : <span className="claim-status">{visibleWalletData?.claims.length ? `${visibleWalletData.claims.length} allocation${visibleWalletData.claims.length === 1 ? "" : "s"}` : "No allocations yet"}</span>}
      </div>

      <div className="positions-table">
        <div className="positions-head"><span>Community position</span><span>Balance</span><span>Reward</span><span>Current estimate</span><span>Claimable</span><span>Status</span><span /></div>
        {visibleWalletData?.positions.map((position) => (
          <div className="position-row" key={`position:${position.epochId}`}>
            <span><strong>${position.launchSymbol}</strong><small>{position.launchName}</small></span>
            <code>{shortAtomic(position.endingBalanceAtomic)}</code>
            <strong>${position.rewardSymbol}</strong>
            <span>{shortAtomic(position.tokenSecondsAtomic)} token-seconds</span>
            <span>Pending epoch close</span>
            <span className="claim-status">{position.epochState}</span>
            <span />
          </div>
        ))}
        {visibleWalletData?.claims.map((claim) => (
          <div className="position-row" key={claim.id}>
            <span><strong>${claim.launchSymbol}</strong><small>{claim.launchName}</small></span>
            <span>Epoch closed</span>
            <strong>${claim.rewardSymbol}</strong>
            <span>Finalized at slot {claim.cutoffSlot ?? "recorded"}</span>
            <strong>{formatAtomic(claim.amountAtomic, claim.rewardDecimals)} ${claim.rewardSymbol}</strong>
            <span className="claim-status">{payoutState(claim.state)}</span>
            {claim.signature ? <a href={`https://solscan.io/tx/${encodeURIComponent(claim.signature)}`} target="_blank" rel="noopener noreferrer" aria-label="Open payout receipt"><ExternalLink /></a> : <span />}
          </div>
        ))}
        {!visibleWalletData || (!visibleWalletData.positions.length && !visibleWalletData.claims.length) ? (
          <div className="empty-state">
            <Wallet />
            <h2>No reward positions to show.</h2>
            <p>{walletSession.wallet ? "This verified wallet has no finalized SportPad holder position yet." : "Verify your Solana wallet to load only its real indexed positions and allocations."}</p>
          </div>
        ) : null}
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
