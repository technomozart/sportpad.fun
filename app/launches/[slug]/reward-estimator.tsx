"use client";

import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";

export function RewardEstimator({ ticker, rewardSymbol }: { ticker: string; rewardSymbol: string }) {
  const [balance, setBalance] = useState("1000000");
  const [days, setDays] = useState("7");
  const result = useMemo(() => {
    const amount = Math.max(0, Number(balance) || 0);
    const duration = Math.min(7, Math.max(0, Number(days) || 0));
    const share = Math.min(4.5, (amount * duration / 12_000_000) * 100);
    return { share, tokens: share * 0.728 };
  }, [balance, days]);
  return <div className="reward-estimator"><div><Calculator /><span><strong>Epoch estimator</strong><small>Illustrative only · not a promise</small></span></div><label>${ticker} balance<input value={balance} onChange={(event)=>setBalance(event.target.value.replace(/[^0-9]/g,""))} /></label><label>Days held this epoch<input value={days} onChange={(event)=>setDays(event.target.value.replace(/[^0-9.]/g,""))} /></label><div className="estimator-result"><span>Estimated pool share<strong>{result.share.toFixed(4)}%</strong></span><span>Estimated allocation<strong>{result.tokens.toFixed(3)} {rewardSymbol}</strong></span></div><p>Actual allocations use finalized balance intervals, total eligible token-seconds, and the funded reward amount. This preview cannot determine a claim.</p></div>;
}
