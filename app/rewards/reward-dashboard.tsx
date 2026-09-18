"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Clock3, Coins, Filter, ShieldCheck, Trophy, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TokenMark } from "@/components/sport-ui";

const positions = [
  { coin: "CATALA", name: "Catalan Cats", balance: "1,840,000", reward: "BAR", color: "#9cff57", estimate: "2.341", claimable: "4.783", lifetime: "11.620", state: "Claimable", progress: 100 },
  { coin: "CANNON", name: "North London Cannon", balance: "920,400", reward: "AFC", color: "#ffb84d", estimate: "1.084", claimable: "0.000", lifetime: "3.229", state: "Accruing", progress: 68 },
  { coin: "ULTRA", name: "Paris Ultras", balance: "411,200", reward: "PSG", color: "#72a7ff", estimate: "0.722", claimable: "1.114", lifetime: "5.872", state: "Claimable", progress: 100 },
  { coin: "CITYZ", name: "Cityzens Onchain", balance: "305,000", reward: "CITY", color: "#66e4ff", estimate: "0.381", claimable: "0.000", lifetime: "1.882", state: "Funding", progress: 82 },
];

export function RewardDashboard() {
  const [filter, setFilter] = useState("All positions");
  const [expanded, setExpanded] = useState("CATALA");
  const [notice, setNotice] = useState("");
  const visible = useMemo(() => positions.filter((item) => filter === "All positions" || item.state === filter), [filter]);

  function previewClaim() {
    setNotice("Demo only: a production claim would show the exact mint, destination, network fee, and transaction simulation before wallet approval.");
  }

  return (
    <div>
      <div className="reward-summary-grid">
        <div className="reward-summary-primary"><span>Claimable now</span><strong>$86.42</strong><small>4.783 BAR + 1.114 PSG · 2 demo epochs</small><Button onClick={previewClaim} className="mt-5 rounded-full bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]"><Trophy /> Preview claim all</Button></div>
        <div><span>Accruing estimate</span><strong>$42.18</strong><small>Not final or funded</small></div>
        <div><span>Pending settlement</span><strong>$18.73</strong><small>Inventory reconciliation</small></div>
        <div><span>Claimed lifetime</span><strong>$314.08</strong><small>Per-asset totals shown below</small></div>
      </div>
      {notice ? <div className="dashboard-notice"><ShieldCheck /><span>{notice}</span><button onClick={() => setNotice("")}>Dismiss</button></div> : null}
      <div className="dashboard-toolbar"><div><Wallet /><span>Demo wallet <code>9xM4…pQ21</code></span></div><label><Filter /><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All positions</option><option>Claimable</option><option>Accruing</option><option>Funding</option></select></label></div>
      <div className="positions-table">
        <div className="positions-head"><span>Community position</span><span>Balance</span><span>Reward</span><span>Current estimate</span><span>Claimable</span><span>Status</span><span /></div>
        {visible.map((item) => (
          <div key={item.coin} className="position-wrap">
            <button className="position-row" aria-expanded={expanded === item.coin} aria-controls={`position-${item.coin}`} onClick={() => setExpanded(expanded === item.coin ? "" : item.coin)}>
              <span><TokenMark token={item.coin} color={item.color} /><span><strong>{item.name}</strong><small>${item.coin}</small></span></span><strong>{item.balance}</strong><strong>{item.reward}</strong><span>{item.estimate} {item.reward}<small>Estimated</small></span><span>{item.claimable} {item.reward}<small>{Number(item.claimable) ? "Funded" : "—"}</small></span><span className={`position-state state-${item.state.toLowerCase()}`}>{item.state}</span><ChevronDown className={expanded === item.coin ? "rotate-180" : ""} />
            </button>
            {expanded === item.coin ? <div id={`position-${item.coin}`} className="position-detail"><div><span>Current token balance</span><strong>{item.balance} {item.coin}</strong></div><div><span>Epoch average eligible</span><strong>{item.coin === "CATALA" ? "1,721,300" : "Calculating"} {item.coin}</strong></div><div><span>Wallet share</span><strong>{item.coin === "CATALA" ? "0.6432%" : "Updating"}</strong></div><div><span>Claimed lifetime</span><strong>{item.lifetime} {item.reward}</strong></div><div className="position-progress"><span><span>Epoch state</span><strong>{item.state}</strong></span><Progress value={item.progress} className="h-1.5 bg-white/8 [&_[data-slot=progress-indicator]]:bg-[#9cff57]" /></div>{Number(item.claimable) ? <Button onClick={previewClaim} variant="outline" className="border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white">Preview {item.reward} claim</Button> : <span className="claim-status">Not claimable · {item.state.toLowerCase()}</span>}</div> : null}
          </div>
        ))}
      </div>
      <div className="reward-lifecycle">
        {[
          { icon: Coins, title: "Earning", copy: "Live estimate can change", done: true },
          { icon: Clock3, title: "Closing", copy: "Cutoff data reconciles", done: true },
          { icon: Wallet, title: "Funding", copy: "Inventory is reserved", done: true },
          { icon: CheckCircle2, title: "Claimable", copy: "Final and funded", done: false },
        ].map((item, index) => <div key={item.title} className={item.done ? "done" : ""}><span>{index + 1}</span><item.icon /><strong>{item.title}</strong><small>{item.copy}</small></div>)}
      </div>
    </div>
  );
}
