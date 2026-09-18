import Link from "next/link";
import { ArrowRight, BadgeCheck, Boxes, CheckCircle2, CircleDollarSign, Flame, Layers3, Radio, ShieldCheck, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { FeeCalculator } from "./fee-calculator";

const stages = [
  { icon: BadgeCheck, title: "Select a verified reward", copy: "The creator chooses an allowlisted Fan Token whose exact Solana mint and route policy are visible." },
  { icon: CircleDollarSign, title: "Creator fees accrue", copy: "Only qualifying creator fees actually received enter SportPad accounting. Pump controls the underlying fee schedule." },
  { icon: Radio, title: "Finality and reconciliation", copy: "Events are deduplicated, finalized, and matched against treasury balance changes before any economic action." },
  { icon: Layers3, title: "The split is applied", copy: "80% becomes a fan-token acquisition intent; 20% becomes a SPORT buyback-and-burn intent." },
  { icon: Boxes, title: "The epoch is funded", copy: "Fan Tokens are acquired or reserved from inventory. A calculation never becomes payable before the vault is funded." },
  { icon: WalletCards, title: "Holders claim on Solana", copy: "Eligible time-weighted balances receive pro-rata allocations through a published distribution proof." },
];

export default function HowItWorksPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="How SportPad works" title="From creator fees to holder rewards—with every state exposed." copy="SportPad links independently created Solana coins to verified Fan Token reward pools. The system batches fees, respects liquidity limits, funds epochs, and publishes evidence before claims open.">
          <div className="route-mini"><span>TRADE</span><ArrowRight /><strong>80 / 20</strong><ArrowRight /><span>REWARD + BURN</span></div>
        </PageIntro>
        <SafetyNotice>Linked does not mean paired. A community coin usually trades in a SOL-based market; its creator fees fund rewards in a separate Fan Token.</SafetyNotice>

        <section className="content-section process-timeline">
          {stages.map((stage, index) => <article key={stage.title}><span className="process-number">0{index + 1}</span><div className="process-icon"><stage.icon /></div><div><h2>{stage.title}</h2><p>{stage.copy}</p></div>{index < stages.length - 1 ? <span className="process-line" /> : null}</article>)}
        </section>

        <section className="page-section calculator-layout"><div><p className="section-eyebrow">Economics</p><h2>The split is simple. Settlement is not.</h2><p>Every leg must survive finality, quote expiry, price-impact checks, retries, balance reconciliation, and on-chain proof. “Submitted” never means “complete.”</p><ul className="check-list"><li><CheckCircle2 /> Exact integer accounting</li><li><CheckCircle2 /> Idempotent settlement state</li><li><CheckCircle2 /> Bounded slippage and price impact</li><li><CheckCircle2 /> Supply delta verified after every burn</li></ul></div><FeeCalculator /></section>

        <section className="page-section">
          <SectionHeading eyebrow="Reward accounting" title="One funded pool, divided by time-weighted participation." copy="Epoch rules are versioned before the accounting window starts. Closed epochs are never silently rewritten." />
          <div className="equation-card"><span>YOUR FUNDED REWARD</span><div><strong>Fan Tokens funded for epoch</strong><b>×</b><strong>Your eligible token-seconds</strong><b>÷</b><strong>All eligible token-seconds</strong></div><p>Raw trade volume is not automatically rewarded. Protocol, LP, bonding-curve, treasury, and burn accounts are excluded.</p></div>
          <div className="epoch-states">{["Accruing", "Cutoff reached", "Reconciling", "Funded", "Root published", "Claimable", "Closed"].map((state,index)=><span key={state} className={index < 4 ? "complete" : ""}><b>{index+1}</b>{state}</span>)}</div>
        </section>

        <section className="page-section route-paths">
          <div><p className="section-eyebrow">Route A</p><h2>Solana-native acquisition</h2><p>The preferred path. Jupiter supplies a bounded executable quote, the output settles directly into the Solana reward vault, and claims remain on one network.</p><span className="route-label route-ready">Preferred when liquid</span></div>
          <div><p className="section-eyebrow">Route B</p><h2>Inventory replenishment</h2><p>When Solana liquidity is insufficient, a capped vault is funded in advance and replenished asynchronously through an approved cross-chain route.</p><span className="route-label route-inventory">Claims wait for funding</span></div>
          <div className="route-safety"><ShieldCheck /><h3>Safe failure beats a bad execution.</h3><p>Acquisition pauses when quotes disappear, price impact rises, inventory runs low, or RPC/bridge health degrades. Existing funded claims remain reserved.</p></div>
        </section>

        <section className="page-section burn-proof"><div><Flame /><span><p className="section-eyebrow">Planned buyback and burn</p><h2>A wallet transfer would not count as a burn.</h2><p>After SPORT is deployed and execution is audited, the 20% leg would purchase SPORT, call SPL Token BurnChecked, wait for finality, and verify that mint supply decreased by the expected atomic amount.</p></span></div><Button asChild variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"><Link href="/transparency">Inspect the demo ledger <ArrowRight /></Link></Button></section>
      </main>
    </SiteChrome>
  );
}
