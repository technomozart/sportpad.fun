"use client";

import { CheckCircle2, Clock3, Coins, ExternalLink, Network, ShieldCheck, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useSolanaWalletSession } from "@/components/solana-wallet-session";
import { Button } from "@/components/ui/button";
import { CHILIZ_CHAIN } from "@/lib/protocol/chiliz-reward-assets";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
};
declare global { interface Window { ethereum?: EthereumProvider } }

type RewardProtocolStatus = {
  readiness: { rewards: { ready: boolean; missing: string[] }; claims: { ready: boolean; missing: string[] } };
  capabilities: { holderIndexerEnabled: boolean };
  counts: { rewardEpochs: number; confirmedClaims: number; rewardVaults: number };
};
type RewardClaim = {
  id: string; epochId: string; amountAtomic: string; feeAtomic: string; signature: string | null; state: string;
  destinationChain: string; destinationAddress: string | null; rewardChain: "chiliz" | "solana";
  launchName: string; launchSymbol: string; rewardSymbol: string; rewardDecimals: number; cutoffSlot: number | null;
};
type WalletRewardData = {
  wallet: string;
  evmWallet: { address: string; chainId: number; verifiedAt: number } | null;
  gasPolicy: "protocol_sponsored";
  claims: RewardClaim[];
  positions: Array<{
    epochId: string; launchName: string; launchSymbol: string; rewardSymbol: string; rewardChain: "chiliz" | "solana";
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
function shortAddress(value: string) { return `${value.slice(0, 6)}...${value.slice(-4)}`; }
function payoutState(state: string) {
  if (state === "confirmed") return "Paid";
  if (state === "queued") return "Automatic payout queued";
  if (state === "submission_unknown") return "Reconciliation pending";
  if (state === "submitting" || state === "submitted") return "Submitting";
  return "Ready to claim";
}
function textToHex(value: string) {
  return `0x${[...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function RewardDashboard() {
  const walletSession = useSolanaWalletSession();
  const [protocol, setProtocol] = useState<RewardProtocolStatus | null>(null);
  const [walletData, setWalletData] = useState<WalletRewardData | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const loadRewards = useCallback(async () => {
    if (!walletSession.wallet) return;
    const response = await fetch("/api/rewards", { cache: "no-store" });
    const body = await response.json() as WalletRewardData & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Wallet rewards are unavailable.");
    setWalletData(body);
  }, [walletSession.wallet]);

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
      .then(async (response) => {
        const body = await response.json() as WalletRewardData & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Wallet rewards are unavailable.");
        return body;
      })
      .then((body) => setWalletData(body))
      .catch((error) => { if ((error as Error).name !== "AbortError") setWalletData(null); });
    return () => controller.abort();
  }, [walletSession.wallet]);

  async function linkChilizWallet() {
    setBusy("wallet"); setNotice("");
    try {
      const provider = window.ethereum;
      if (!provider) throw new Error("Install MetaMask or another EVM wallet to receive Chiliz rewards.");
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No EVM wallet account was selected.");
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHILIZ_CHAIN.hexId }] });
      } catch (error) {
        const code = Number((error as { code?: unknown })?.code);
        if (code !== 4902) throw error;
        await provider.request({ method: "wallet_addEthereumChain", params: [{
          chainId: CHILIZ_CHAIN.hexId,
          chainName: CHILIZ_CHAIN.name,
          nativeCurrency: CHILIZ_CHAIN.nativeCurrency,
          rpcUrls: [CHILIZ_CHAIN.rpcUrl],
          blockExplorerUrls: [CHILIZ_CHAIN.explorerUrl],
        }] });
      }
      const challengeResponse = await fetch("/api/evm-wallet/challenge", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }),
      });
      const challenge = await challengeResponse.json() as { challengeId?: string; message?: string; address?: string; error?: string };
      if (!challengeResponse.ok || !challenge.challengeId || !challenge.message || !challenge.address) throw new Error(challenge.error ?? "Wallet verification could not start.");
      const signature = await provider.request({ method: "personal_sign", params: [textToHex(challenge.message), challenge.address] }) as string;
      const verifyResponse = await fetch("/api/evm-wallet/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, address: challenge.address, signature }),
      });
      const verified = await verifyResponse.json() as { error?: string };
      if (!verifyResponse.ok) throw new Error(verified.error ?? "Wallet verification failed.");
      await loadRewards();
      setNotice("Chiliz wallet verified. This signature did not grant spending permission.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Chiliz wallet verification failed.");
    } finally { setBusy(""); }
  }

  async function claimReward(claim: RewardClaim) {
    setBusy(claim.id); setNotice("");
    try {
      const response = await fetch("/api/rewards", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claimId: claim.id }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Reward claim could not be queued.");
      await loadRewards();
      setNotice(`${claim.rewardSymbol} payout queued to your verified ${claim.rewardChain === "chiliz" ? "Chiliz" : "Solana"} wallet.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Reward claim failed."); }
    finally { setBusy(""); }
  }

  const currentData = walletSession.wallet ? walletData : null;
  const walletLabel = walletSession.wallet ? shortAddress(walletSession.wallet) : "Not connected";
  const chartData = useMemo(() => (walletSession.wallet ? walletData?.claims ?? [] : []).map((claim) => ({
    name: `${claim.rewardSymbol} / ${claim.launchSymbol}`,
    amount: Number(formatAtomic(claim.amountAtomic, claim.rewardDecimals)),
  })).filter((item) => Number.isFinite(item.amount)), [walletData, walletSession.wallet]);
  const lifecycle = [
    { icon: Coins, title: "Earning", copy: protocol?.capabilities.holderIndexerEnabled ? "Finalized holder indexing enabled" : "Holder indexer locked" },
    { icon: Clock3, title: "Allocating", copy: protocol ? `${protocol.counts.rewardEpochs} recorded reward epochs` : "Reading epoch ledger" },
    { icon: Network, title: "Routing", copy: "Kayen on Chiliz or Jupiter on Solana" },
    { icon: CheckCircle2, title: "Claiming", copy: "Payouts paused pending ledger and receipt verification" },
  ];

  return <div>
    <div className="reward-summary-grid">
      <div className="reward-summary-primary"><span>Wallet-linked reward data</span><strong>{walletLabel}</strong><small>{walletSession.wallet ? "Finalized positions and funded allocations for this verified wallet." : "Verify your Solana wallet to load real holder data."}</small></div>
      <div><span>Chiliz payout wallet</span><strong>{currentData?.evmWallet ? shortAddress(currentData.evmWallet.address) : "Not linked"}</strong><small>MetaMask and compatible EVM wallets</small></div>
      <div><span>Confirmed payouts</span><strong>{protocol?.counts.confirmedClaims ?? "Unavailable"}</strong><small>Onchain receipts only</small></div>
      <div><span>Claim gas</span><strong>Planned</strong><small>SportPad treasury would pay CHZ gas when claims are enabled</small></div>
    </div>

    <div className="dashboard-notice"><ShieldCheck /><span>SportPad shows only indexed positions and funded allocations. Linking MetaMask signs a verification message only and never approves token spending.</span></div>
    <div className="dashboard-toolbar">
      <div><Wallet /><span>Verified Solana wallet <code>{walletLabel}</code></span></div>
      {!walletSession.wallet
        ? <Button onClick={() => void walletSession.connectAndVerify()} disabled={walletSession.busy}><Wallet /> Verify Solana wallet</Button>
        : <Button onClick={() => void linkChilizWallet()} disabled={Boolean(busy)}><Network /> {currentData?.evmWallet ? "Change Chiliz wallet" : "Connect Chiliz wallet"}</Button>}
    </div>
    {notice ? <p className="reward-action-notice" role="status">{notice}</p> : null}

    {chartData.length ? <div className="reward-wallet-chart">
      <div><strong>Rewards held for this wallet</strong><small>Finalized allocations grouped by Fan Token and launch.</small></div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 18, right: 18, left: 0, bottom: 12 }}>
          <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
          <XAxis dataKey="name" stroke="#8f9a92" tick={{ fontSize: 12 }} />
          <YAxis stroke="#8f9a92" tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={{ background: "#0d130f", border: "1px solid #273229", borderRadius: 12 }} />
          <Bar dataKey="amount" fill="#9cff57" radius={[7, 7, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div> : null}

    <div className="positions-table">
      <div className="positions-head"><span>Community position</span><span>Balance</span><span>Reward</span><span>Network</span><span>Claimable</span><span>Status</span><span /></div>
      {currentData?.positions.map((position) => <div className="position-row" key={`position:${position.epochId}`}>
        <span><strong>${position.launchSymbol}</strong><small>{position.launchName}</small></span>
        <code>{shortAtomic(position.endingBalanceAtomic)}</code><strong>${position.rewardSymbol}</strong>
        <span>{position.rewardChain === "chiliz" ? "Chiliz" : "Solana"}</span><span>Pending epoch close</span>
        <span className="claim-status">{position.epochState}</span><span />
      </div>)}
      {currentData?.claims.map((claim) => <div className="position-row" key={claim.id}>
        <span><strong>${claim.launchSymbol}</strong><small>{claim.launchName}</small></span><span>Epoch closed</span>
        <strong>${claim.rewardSymbol}</strong><span>{claim.rewardChain === "chiliz" ? "Chiliz" : "Solana"}</span>
        <strong>{formatAtomic(claim.amountAtomic, claim.rewardDecimals)} ${claim.rewardSymbol}</strong>
        <span className="claim-status">{payoutState(claim.state)}</span>
        {claim.signature ? <a href={claim.rewardChain === "chiliz" ? `${CHILIZ_CHAIN.explorerUrl}/tx/${claim.signature}` : `https://solscan.io/tx/${claim.signature}`} target="_blank" rel="noopener noreferrer" aria-label="Open payout receipt"><ExternalLink /></a>
          : claim.state === "claimable" ? <Button size="sm" onClick={() => void claimReward(claim)} disabled={Boolean(busy) || (claim.rewardChain === "chiliz" && !currentData.evmWallet)}>{busy === claim.id ? "Queueing" : "Claim"}</Button> : <span />}
      </div>)}
      {!currentData || (!currentData.positions.length && !currentData.claims.length) ? <div className="empty-state"><Wallet /><h2>No reward positions to show.</h2><p>{walletSession.wallet ? "This wallet has no finalized SportPad holder position yet." : "Verify your Solana wallet to load its real indexed positions and allocations."}</p></div> : null}
    </div>

    <div className="reward-lifecycle">{lifecycle.map((item, index) => <div key={item.title}><span>{index + 1}</span><item.icon /><strong>{item.title}</strong><small>{item.copy}</small></div>)}</div>
  </div>;
}
