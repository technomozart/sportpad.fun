import { SiteLink as Link } from "@/components/site-link";
import { ArrowRight, BadgeCheck, Boxes, CheckCircle2, CircleDollarSign, Flame, Layers3, Radio, ShieldCheck, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { FeeCalculator } from "./fee-calculator";

const stages = [
  { icon: BadgeCheck, title: "Select an official reward", copy: "The creator chooses an official Fan Token whose registry-listed Solana token address is visible." },
  { icon: CircleDollarSign, title: "Community fees finalize", copy: "The system accepts only qualifying creator fees from community launches after Solana finality. SPORTPAD's own fees are excluded." },
  { icon: Radio, title: "Reconcile each event", copy: "The planned indexer deduplicates events and matches them against treasury balance changes before economic action." },
  { icon: Layers3, title: "Apply the community split", copy: "80% of a community coin's fees becomes a Fan Token reward intent; 20% becomes a SPORTPAD buyback and burn intent." },
  { icon: Boxes, title: "Fund the reward epoch", copy: "The planned system acquires or reserves Fan Tokens. A calculation cannot become payable before the vault is funded." },
  { icon: WalletCards, title: "Open Solana claims", copy: "Eligible time-weighted balances can receive pro-rata allocations only after a distribution proof is published." },
];

export default function HowItWorksPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="How SportPad works" title="Community launch fees fund rewards and SPORTPAD burns." copy="Every community launch uses the immutable 80/20 fee route. SPORTPAD's own creator fees are kept for project development and never enter that split. Every treasury spend still requires the matching wallet to review and sign.">
          <div className="route-mini"><span>TRADE</span><ArrowRight /><strong>80 / 20</strong><ArrowRight /><span>REWARD + BURN</span></div>
        </PageIntro>
        <SafetyNotice>Linked does not mean paired. A community coin trades in a SOL-based market; its creator fees fund rewards in a separate Fan Token. SPORTPAD&apos;s own fee stream is reserved for development.</SafetyNotice>

        <section className="content-section process-timeline">
          {stages.map((stage, index) => <article key={stage.title}><span className="process-number">0{index + 1}</span><div className="process-icon"><stage.icon /></div><div><h2>{stage.title}</h2><p>{stage.copy}</p></div>{index < stages.length - 1 ? <span className="process-line" /> : null}</article>)}
        </section>

        <section className="page-section calculator-layout"><div><p className="section-eyebrow">Economics</p><h2>The split is simple. Settlement is not.</h2><p>Every leg must survive finality, quote expiry, price-impact checks, retries, balance reconciliation, and on-chain proof. “Submitted” never means “complete.”</p><ul className="check-list"><li><CheckCircle2 /> Exact integer accounting</li><li><CheckCircle2 /> Idempotent settlement state</li><li><CheckCircle2 /> Bounded slippage and price impact</li><li><CheckCircle2 /> Supply delta verified after every burn</li></ul></div><FeeCalculator /></section>

        <section className="page-section">
          <SectionHeading eyebrow="Planned reward accounting" title="One funded pool, divided by time-weighted participation." copy="In the proposed design, epoch rules would be versioned before the accounting window starts, and closed epochs would never be silently rewritten." />
          <div className="equation-card"><span>YOUR FUNDED REWARD</span><div><strong>Fan Tokens funded for epoch</strong><b>×</b><strong>Your eligible token-seconds</strong><b>÷</b><strong>All eligible token-seconds</strong></div><p>Raw trade volume is not automatically rewarded. Protocol, LP, bonding-curve, treasury, and burn accounts are excluded.</p></div>
          <div className="epoch-states">{["Accruing", "Cutoff reached", "Reconciling", "Funded", "Root published", "Claimable", "Closed"].map((state,index)=><span key={state}><b>{index+1}</b>{state}</span>)}</div>
        </section>

        <section className="page-section route-paths">
          <div><p className="section-eyebrow">Planned route A</p><h2>Solana-native acquisition</h2><p>The preferred future path uses a bounded executable quote, settles output into a deployed Solana reward vault, and keeps claims on one network.</p><span className="route-label route-research">Not enabled</span></div>
          <div><p className="section-eyebrow">Planned route B</p><h2>Inventory replenishment</h2><p>If Solana liquidity is insufficient, a future capped vault could be funded in advance and replenished through an approved cross-chain route.</p><span className="route-label route-research">Not deployed</span></div>
          <div className="route-safety"><ShieldCheck /><h3>Safe failure beats a bad execution.</h3><p>The planned executor would pause acquisition when quotes disappear, price impact rises, inventory runs low, or RPC or bridge health degrades. Any previously funded claims would remain reserved.</p></div>
        </section>

        <section className="page-section burn-proof"><div><Flame /><span><p className="section-eyebrow">Community-funded SPORTPAD burn</p><h2>Only the 20% share from other launches is burned.</h2><p>The 20% treasury uses community launch fees to buy SPORTPAD through Jupiter, then prepares an exact SPL Token burn for the purchased amount. SPORTPAD&apos;s own creator fees remain with the project for development.</p></span></div><Button asChild variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"><Link href="/transparency">View deployment status <ArrowRight /></Link></Button></section>
      </main>
    </SiteChrome>
  );
}
