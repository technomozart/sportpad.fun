import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BadgeCheck, BarChart3, Clock3, Copy, ExternalLink, Flame, Goal, ShieldCheck, Trophy, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DemoBadge, LaunchCard, MiniChart, SafetyNotice, SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { compactNumber, feeEvents, formatUsd, getLaunch, launches } from "@/lib/site-data";
import { RewardEstimator } from "./reward-estimator";

export function generateStaticParams() { return launches.map((launch)=>({slug:launch.slug})); }

export default async function LaunchDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const launch = getLaunch(slug);
  if (!launch) notFound();
  const related = launches.filter((item)=>item.rewardSymbol === launch.rewardSymbol && item.slug !== launch.slug).slice(0,2);
  return (
    <SiteChrome>
      <main className="page-wrap inner-page token-page">
        <Link href="/discover" className="back-link"><ArrowLeft /> Back to Discover</Link>
        <section className="token-hero">
          <div className="token-hero-main"><div className="token-labels"><span>Unofficial community token</span><DemoBadge /></div><div className="token-title"><TokenMark token={launch.ticker} color={launch.tone} size="lg" /><div><h1>{launch.name}</h1><p>${launch.ticker} · {launch.sport} · demo age {launch.age}</p></div></div><p className="token-description">{launch.description}</p><div className="token-actions"><Button className="rounded-full bg-[#9cff57] text-[#071008] hover:bg-[#adff7d]" disabled><WalletCards /> Trading locked in demo</Button><Button disabled variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"><Copy /> Mint not deployed</Button></div></div>
          <div className="token-reward-card"><div className="verified-label"><BadgeCheck /> Verified reward asset</div><div><TokenMark token={launch.rewardSymbol} color={launch.tone} size="lg" /><span><strong>{launch.rewardName}</strong><small>${launch.rewardSymbol} on Solana</small></span></div><p>Eligible ${launch.ticker} holders can receive pro-rata {launch.rewardSymbol} allocations after an epoch is funded and finalized.</p><dl><div><dt>Route</dt><dd>{launch.availability === "routed" ? "Direct Solana route" : "Inventory-backed"}</dd></div><div><dt>Lifetime funded</dt><dd>{launch.rewardsFunded} {launch.rewardSymbol}</dd></div><div><dt>Current epoch</dt><dd>Accruing · 18h left</dd></div></dl><small>No club or issuer endorsement is implied.</small></div>
        </section>
        <SafetyNotice>{launch.name} is community-created and not club-issued. Verification applies only to the linked {launch.rewardName} mint.</SafetyNotice>

        <section className="token-market-layout">
          <div className="chart-panel"><div className="chart-head"><div><span>Demo price</span><strong>$0.00018423</strong><small className={launch.change24h >= 0 ? "positive" : "negative"}>{launch.change24h >= 0 ? "+" : ""}{launch.change24h}% in fixture</small></div><div className="chart-times" aria-label="Demo chart range"><button disabled>1H</button><button disabled>4H</button><button disabled className="active">1D</button><button disabled>7D</button><button disabled>ALL</button></div></div><div className="large-chart-grid"><MiniChart values={[...launch.activity,...launch.activity.slice().reverse().map((n)=>Math.min(98,n+3))]} color={launch.tone} tall /></div><div className="chart-caption"><span>Illustrative price series</span><span>Demo epoch window <b>18h 04m</b></span></div></div>
          <div className="market-side"><div className="market-metrics"><div><span>Market cap</span><strong>{formatUsd(launch.marketCap)}</strong></div><div><span>24h volume</span><strong>{formatUsd(launch.volume24h)}</strong></div><div><span>Holders</span><strong>{compactNumber(launch.holders)}</strong></div><div><span>Reward funded</span><strong>{formatUsd(launch.rewardUsd)}</strong></div></div><div className="curve-panel"><span><strong>Bonding curve</strong><b>{launch.curve}%</b></span><Progress value={launch.curve} className="h-2 bg-white/8 [&_[data-slot=progress-indicator]]:bg-[#9cff57]" /><p>Demo graduation progress. Actual curve data will come from Pump accounts.</p></div><div className="route-health"><span className={launch.availability === "routed" ? "healthy" : "warning"} /><div><strong>{launch.availability === "routed" ? "Reward route ready" : "Inventory-backed route"}</strong><small>{launch.availability === "routed" ? "Live quote plus vault checks required" : "Claims depend on pre-funded vault inventory"}</small></div></div></div>
        </section>

        <section className="page-section reward-detail-layout">
          <div><SectionHeading eyebrow="Your position" title="See the calculation before it becomes a claim." copy="Production values require a wallet-signed session. This estimator shows the shape of the formula without pretending the demo has real eligibility data." /><RewardEstimator ticker={launch.ticker} rewardSymbol={launch.rewardSymbol} /></div>
          <div className="epoch-card"><div className="epoch-head"><Trophy /><span><small>CURRENT EPOCH</small><strong>{launch.ticker} · Epoch 27</strong></span><code>ACCRUING</code></div><dl><div><dt>Window</dt><dd>Sep 15–22, 2026 UTC</dd></div><div><dt>Finalized creator fees</dt><dd>8.340000 SOL</dd></div><div><dt>Projected reward leg</dt><dd>6.672000 SOL</dd></div><div><dt>Fan tokens funded</dt><dd>Pending acquisition</dd></div><div><dt>Eligible wallets</dt><dd>568 currently indexed</dd></div><div><dt>Cutoff</dt><dd>18h 04m remaining</dd></div></dl><div className="epoch-note"><Clock3 /> Estimates can move until the cutoff, acquisition, funding, and allocation root all finalize.</div></div>
        </section>

        <section className="page-section"><SectionHeading eyebrow="Fee flow" title="The proposed route for this launch." /><div className="token-flow"><div><Goal /><span><small>01</small><strong>${launch.ticker} trades</strong><p>Pump bonding curve / PumpSwap</p></span></div><ArrowRight /><div><BarChart3 /><span><small>02</small><strong>Creator fees</strong><p>Finality + reconciliation</p></span></div><ArrowRight /><div className="split-flow"><span><Trophy /><b>80% · {launch.rewardSymbol} rewards</b></span><span><Flame /><b>20% · planned SPORT burn</b></span></div></div></section>

        <section className="page-section"><SectionHeading eyebrow="Activity" title="Every status says exactly what happened." copy="Demo rows show the intended evidence surface. Production rows will link to their source transaction and reconciliation detail." /><div className="token-activity">{feeEvents.slice(0,5).map((event)=><div key={event.id}><span className={`event-dot event-${event.state.toLowerCase()}`} /><div><strong>{event.kind}</strong><small>{event.id} · {event.time}</small></div><span>{event.amount}</span><code>{event.state.toUpperCase()}</code><span title="Demo signature—not linked"><ExternalLink /></span></div>)}</div></section>

        <section className="page-section contract-grid"><div><p className="section-eyebrow">Community-token contract</p><h3>${launch.ticker} demo metadata</h3><dl><dt>Mint</dt><dd>Available after launch</dd><dt>Creator</dt><dd>Wallet-signed identity required</dd><dt>Pump holder rewards</dt><dd>Disabled</dd><dt>Fee shares</dt><dd>8,000 / 2,000 bps target</dd><dt>Trading</dt><dd>Mainnet locked</dd></dl></div><div><p className="section-eyebrow">Reward contract</p><h3>{launch.rewardName}</h3><dl><dt>Symbol</dt><dd>{launch.rewardSymbol}</dd><dt>Network</dt><dd>Solana</dd><dt>Verification</dt><dd><BadgeCheck /> Official registry match</dd><dt>Route state</dt><dd>{launch.availability === "routed" ? "Direct route" : "Inventory-backed"}</dd><dt>Non-affiliation</dt><dd>Required on every surface</dd></dl></div><div className="contract-risk"><ShieldCheck /><h3>Know the distinction.</h3><p>This market is an independently created community concept. The named team and reward issuer have not created, sponsored, approved, or endorsed it.</p></div></section>

        {related.length ? <section className="page-section"><SectionHeading eyebrow={`More ${launch.rewardSymbol} communities`} title="Different narratives, the same verified reward asset." /><div className="market-card-grid">{related.map((item)=><LaunchCard key={item.slug} launch={item} compact />)}</div></section> : null}
      </main>
    </SiteChrome>
  );
}
