"use client";

import { useMemo, useState } from "react";
import { Calculator, Flame, Trophy } from "lucide-react";

export function FeeCalculator() {
  const [fees, setFees] = useState("12.5");
  const parsed = Math.max(0, Number(fees) || 0);
  const split = useMemo(() => ({ reward: parsed * 0.8, burn: parsed * 0.2 }), [parsed]);
  return (
    <div className="fee-calculator">
      <div className="fee-calculator-head"><Calculator /><div><span>Illustrative calculator</span><strong>What does the 80 / 20 split mean?</strong></div></div>
      <label>Qualifying creator fees actually received<input value={fees} onChange={(event) => setFees(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /><span>SOL</span></label>
      <div className="calculator-bar"><span style={{ width: "80%" }} /><span style={{ width: "20%" }} /></div>
      <div className="calculator-results"><div><Trophy /><span><small>Reward allocation</small><strong>{split.reward.toFixed(4)} SOL</strong><em>80% · Fan Token acquisition</em></span></div><div><Flame /><span><small>Buyback allocation</small><strong>{split.burn.toFixed(4)} SOL</strong><em>20% · SPORT buy + BurnChecked</em></span></div></div>
      <p>This calculator does not forecast activity or token output. Network, swap, and exceptional routing cost policy must be published before mainnet.</p>
    </div>
  );
}
