"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";

import { MiniChart } from "@/components/sport-ui";
import { SiteLink as Link } from "@/components/site-link";
import { Button } from "@/components/ui/button";

const ranges = ["1H", "4H", "1D", "7D", "ALL"] as const;
type Range = (typeof ranges)[number];

function rangeValues(activity: number[], range: Range) {
  const full = [...activity, ...activity.slice().reverse().map((value) => Math.min(98, value + 3))];
  if (range === "1H") return full.slice(-6);
  if (range === "4H") return full.slice(-10);
  if (range === "1D") return full.slice(-16);
  if (range === "7D") return full;
  return [...activity.map((value) => Math.max(4, value - 8)), ...full];
}

export function LaunchHeroActions({ rewardSymbol, rewardMint }: { rewardSymbol: string; rewardMint: string | null }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function copyRewardMint() {
    if (!rewardMint) return;
    try {
      await navigator.clipboard.writeText(rewardMint);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2200);
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="token-action-wrap">
      <div className="token-actions">
        <Button asChild className="rounded-full bg-[#9cff57] text-[#071008] hover:bg-[#adff7d]">
          <Link href="/policy#readiness"><ShieldCheck /> Review launch readiness</Link>
        </Button>
        {rewardMint ? <Button type="button" onClick={copyRewardMint} variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white">
          {copyState === "copied" ? <Check /> : <Copy />}
          {copyState === "copied" ? "Reward mint copied" : `Copy ${rewardSymbol} reward mint`}
        </Button> : <span className="claim-status">Reward mint under review</span>}
      </div>
      {copyState === "error" ? <p role="status" className="action-feedback action-error">Clipboard access was blocked. The full reward mint is listed below.</p> : null}
    </div>
  );
}

export function DemoMarketChart({ activity, color, change24h }: { activity: number[]; color: string; change24h: number }) {
  const [range, setRange] = useState<Range>("1D");
  const values = useMemo(() => rangeValues(activity, range), [activity, range]);
  const rangeChange = range === "1H" ? change24h / 7 : range === "4H" ? change24h / 3 : range === "7D" ? change24h * 1.25 : range === "ALL" ? change24h * 1.8 : change24h;

  return (
    <div className="chart-panel">
      <div className="chart-head">
        <div><span>Demo price</span><strong>$0.00018423</strong><small className={rangeChange >= 0 ? "positive" : "negative"}>{rangeChange >= 0 ? "+" : ""}{rangeChange.toFixed(1)}% · {range} fixture</small></div>
        <div className="chart-times" aria-label="Demo chart range">
          {ranges.map((item) => <button type="button" key={item} className={range === item ? "active" : ""} aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}
        </div>
      </div>
      <div className="large-chart-grid"><MiniChart values={values} color={color} tall /></div>
      <div className="chart-caption"><span>Interactive illustrative series · {range}</span><span>Demo epoch window <b>18h 04m</b></span></div>
    </div>
  );
}
