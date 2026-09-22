"use client";

import { useMemo, useState } from "react";
import { Calculator, Flame, Trophy } from "lucide-react";

export function FeeCalculator() {
  const [fees, setFees] = useState("");
  const parsed = Math.max(0, Number(fees) || 0);
  const hasValue = fees.trim() !== "";
  const split = useMemo(() => ({ reward: parsed * 0.8, burn: parsed * 0.2 }), [parsed]);
  return (
    <div className="fee-calculator">
      <div className="fee-calculator-head"><Calculator /><div><span>Your input only</span><strong>What does the planned 80 / 20 split mean?</strong></div></div>
      <label>Enter community launch creator fees<input value={fees} placeholder="0.00" onChange={(event) => setFees(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /><span>SOL</span></label>
      <div className="calculator-bar"><span style={{ width: "80%" }} /><span style={{ width: "20%" }} /></div>
      <div className="calculator-results"><div><Trophy /><span><small>Reward allocation</small><strong>{hasValue ? `${split.reward.toFixed(4)} SOL` : "Enter amount"}</strong><em>80% · official Fan Token rewards</em></span></div><div><Flame /><span><small>Buyback allocation</small><strong>{hasValue ? `${split.burn.toFixed(4)} SOL` : "Enter amount"}</strong><em>20% · SPORTPAD buyback + burn</em></span></div></div>
      <p>This split applies only to other tokens launched on SportPad. SPORTPAD&apos;s own creator fees are retained for project development.</p>
    </div>
  );
}
