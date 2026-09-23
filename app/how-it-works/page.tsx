import { SiteLink as Link } from "@/components/site-link";
import { ArrowRight, BadgeCheck, Boxes, CheckCircle2, CircleDollarSign, Flame, Layers3, Radio, ShieldCheck, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { FeeCalculator } from "./fee-calculator";

const stages = [
  { icon: BadgeCheck, title: "Select an official reward", copy: "SportPad catalogs 78 current Chiliz V2 Fan Token contracts and two Solana options. Chiliz routes are not yet approved for launch." },
  { icon: CircleDollarSign, title: "Community fees finalize", copy: "The system accepts only qualifying creator fees from community launches after Solana finality. SPORTPAD's own fees are excluded." },
  { icon: Radio, title: "Reconcile each event", copy: "The indexer deduplicates finalized fee events and matches them against treasury balance changes before economic action." },
  { icon: Layers3, title: "Apply the community split", copy: "80% of a community coin's fees becomes a Fan Token reward intent; 20% becomes a SPORTPAD buyback and burn intent." },
  { icon: Boxes, title: "Fund the reward epoch", copy: "An audited route must acquire the current Fan Token contract and prove inventory before any allocation becomes payable." },
  { icon: WalletCards, title: "Claim on the reward network", copy: "Once claims are enabled, Solana rewards would go to the verified Base58 wallet and Chiliz rewards to a separately verified 0x address." },
];

export default function HowItWorksPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="How SportPad is designed to work" title="Community launch fees are intended to fund rewards and SPORTPAD burns." copy="The proposed mainnet launch locks an 80/20 fee split for community coins. SPORTPAD's own creator fees remain with the project for development. New mainnet launches, automatic reward purchases, claims, and buyback burns are paused until funded workers and end-to-end execution are verified.">
          <div className="route-mini"><span>TRADE</span><ArrowRight /><strong>80 / 20</strong><ArrowRight /><span>REWARD + BURN</span></div>
        </PageIntro>
        <SafetyNotice>Linked does not mean paired. A community coin trades in a SOL-based market; its creator fees fund rewards in a separate Fan Token. SPORTPAD&apos;s own fee stream is reserved for development.</SafetyNotice>

        <section className="content-section process-timeline">
          {stages.map((stage, index) => <article key={stage.title}><span className="process-number">0{index + 1}</span><div className="process-icon"><stage.icon /></div><div><h2>{stage.title}</h2><p>{stage.copy}</p></div>{index < stages.length - 1 ? <span className="process-line" /> : null}</article>)}
        </section>

        <section className="page-section calculator-layout"><div><p className="section-eyebrow">Economics</p><h2>The split is simple. Settlement is not.</h2><p>Every leg must survive finality, quote expiry, price-impact checks, retries, balance reconciliation, and on-chain proof. “Submitted” never means “complete.”</p><ul className="check-list"><li><CheckCircle2 /> Exact integer accounting</li><li><CheckCircle2 /> Idempotent settlement state</li><li><CheckCircle2 /> Bounded slippage and price impact</li><li><CheckCircle2 /> Supply delta verified after every burn</li></ul></div><FeeCalculator /></section>

        <section className="page-section">
          <SectionHeading eyebrow="Reward accounting" title="One funded pool, divided by time-weighted participation." copy="Epoch rules are fixed before the accounting window starts, and closed allocations are never silently rewritten." />
          <div className="equation-card"><span>YOUR FUNDED REWARD</span><div><strong>Fan Tokens funded for epoch</strong><b>×</b><strong>Your eligible token-seconds</strong><b>÷</b><strong>All eligible token-seconds</strong></div><p>Raw trade volume is not automatically rewarded. Protocol, LP, bonding-curve, treasury, and burn accounts are excluded.</p></div>
          <div className="epoch-states">{["Accruing", "Cutoff reached", "Reconciling", "Funded", "Root published", "Claimable", "Closed"].map((state,index)=><span key={state}><b>{index+1}</b>{state}</span>)}</div>
        </section>

        <section className="page-section route-paths">
          <div><p className="section-eyebrow">Route A</p><h2>Chiliz V2 acquisition and claim</h2><p>Chiliz replaced its former Fan Token contracts with 18-decimal V2 contracts. The old Kayen wrappers do not establish a route to these current assets. SportPad is testing a direct V2 purchase route funded by a separate CHZ treasury, followed by a direct transfer to the holder&apos;s verified 0x address. Neither execution nor automatic SOL-to-CHZ replenishment is enabled.</p><span className="route-label route-inventory">78 V2 contracts, route and payout paused</span></div>
          <div><p className="section-eyebrow">Route B</p><h2>Solana-native rewards</h2><p>AFC and ARG are the two listed Solana options. Once the worker is enabled and funded, it would use a bounded Jupiter quote to acquire the selected token and pay a verified Solana wallet.</p><span className="route-label route-inventory">2 market options, payout paused</span></div>
          <div className="route-safety"><ShieldCheck /><h3>Safe failure beats a bad execution.</h3><p>Execution must stay paused when quotes disappear, price impact exceeds limits, inventory runs low, or RPC health degrades. Uncertain on-chain submissions require reconciliation before any retry.</p></div>
        </section>

        <section className="page-section burn-proof"><div><Flame /><span><p className="section-eyebrow">Proposed community-funded SPORTPAD burn</p><h2>Only the 20% share from other launches is earmarked for burns.</h2><p>Once the SPORTPAD mint exists and the buyback lane passes review, the 20% treasury is intended to buy SPORTPAD through Jupiter and burn the purchased amount. No automatic buyback or burn is active now. SPORTPAD&apos;s own creator fees remain with the project for development.</p></span></div><Button asChild variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"><Link href="/transparency">View deployment status <ArrowRight /></Link></Button></section>
      </main>
    </SiteChrome>
  );
}
