import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight, BadgeCheck, Clock3, ShieldCheck } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { compactNumber, formatUsd, type Launch } from "@/lib/site-data";

export function TokenMark({ token, color, size = "md" }: { token: string; color: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`token-mark token-mark-${size}`} style={{ "--token-color": color } as CSSProperties} aria-hidden="true">
      <span>{token.slice(0, 3)}</span>
    </div>
  );
}

export function MiniChart({ values, color, tall = false }: { values: number[]; color: string; tall?: boolean }) {
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - value}`).join(" ");
  const area = `0,100 ${points} 100,100`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={tall ? "h-44 w-full" : "h-14 w-full"} aria-hidden="true">
      <defs>
        <linearGradient id={`chart-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#chart-${color.replace("#", "")})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={tall ? "1.6" : "3"} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DemoBadge() {
  return <span className="demo-badge"><span /> Demo data</span>;
}

export function SectionHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <p className="section-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {copy ? <p>{copy}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

export function LaunchCard({ launch, compact = false }: { launch: Launch; compact?: boolean }) {
  return (
    <Link href={`/launches/${launch.slug}`} className={`launch-card-v2 group ${compact ? "launch-card-compact" : ""}`}>
      <div className="launch-card-topline">
        <span>Community-created</span>
        <span className={launch.availability === "routed" ? "route-ready" : "route-inventory"}>
          {launch.availability === "routed" ? "Direct route" : "Inventory-backed"}
        </span>
      </div>
      <div className="launch-card-identity">
        <TokenMark token={launch.ticker} color={launch.tone} size="lg" />
        <div className="min-w-0 flex-1">
          <h3>{launch.name}</h3>
          <p>${launch.ticker} · {launch.narrative}</p>
        </div>
        <ArrowUpRight className="launch-arrow" />
      </div>
      <div className="launch-reward-band">
        <div><BadgeCheck /><span>Eligible for</span><strong>{launch.rewardSymbol} rewards</strong></div>
        <small>{launch.rewardsFunded.toLocaleString()} {launch.rewardSymbol} funded</small>
      </div>
      {!compact ? <div className="launch-mini-chart"><MiniChart values={launch.activity} color={launch.tone} /></div> : null}
      <div className="launch-stats">
        <div><span>Market cap</span><strong>{formatUsd(launch.marketCap)}</strong></div>
        <div><span>24h volume</span><strong>{formatUsd(launch.volume24h)}</strong></div>
        <div><span>24h</span><strong className={launch.change24h >= 0 ? "positive" : "negative"}>{launch.change24h >= 0 ? "+" : ""}{launch.change24h}%</strong></div>
        <div><span>Holders</span><strong>{compactNumber(launch.holders)}</strong></div>
      </div>
      <div className="curve-row"><div><span>Bonding curve</span><span>{launch.curve}%</span></div><Progress value={launch.curve} className="h-1.5 bg-white/8 [&_[data-slot=progress-indicator]]:bg-[#9cff57]" /></div>
      <div className="launch-card-footer"><Clock3 /> Demo epoch window · illustrative 18h remaining</div>
    </Link>
  );
}

export function PageIntro({ kicker, title, copy, children }: { kicker: string; title: string; copy: string; children?: ReactNode }) {
  return (
    <section className="page-intro">
      <div>
        <p className="section-eyebrow">{kicker}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {children ? <div className="page-intro-aside">{children}</div> : null}
    </section>
  );
}

export function SafetyNotice({ children }: { children: ReactNode }) {
  return <div className="safety-notice"><ShieldCheck /> <p>{children}</p></div>;
}
