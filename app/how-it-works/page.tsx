import { SiteLink as Link } from "@/components/site-link";
import { ArrowRight, BadgeCheck, Boxes, Circle, CircleDollarSign, Flame, Layers3, Radio, ShieldCheck, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { FeeCalculator } from "./fee-calculator";

const stages = [
  { icon: BadgeCheck, title: "Choose a current Chiliz Fan Token", copy: "A draft may select one of the official 18-decimal V2 contracts. Selection is not an executable purchase or a launch approval." },
  { icon: CircleDollarSign, title: "Collect finalized Solana fees", copy: "A separate collector must distribute the community coin's creator fees. The indexer verifies the real 80/20 treasury receipts; SPORTPAD's own fees are excluded." },
  { icon: Radio, title: "Trace the exact 80%", copy: "Each finalized fee receipt must be linked to a bounded SOL-to-Solana-CHZ swap, not merely priced with an indicative quote." },
  { icon: Layers3, title: "Bridge CHZ to Chiliz Chain", copy: "A bounded, reconciled CHZ amount must reach the Chiliz treasury through a finalized bridge transfer before it can fund a reward purchase." },
  { icon: Boxes, title: "Buy and allocate the V2 reward", copy: "A verified Chiliz market purchase must increase the selected Fan Token inventory. Holder allocations are calculated from finalized Solana holding snapshots." },
  { icon: WalletCards, title: "Link MetaMask and claim", copy: "A holder verifies their Solana wallet and a separate 0x wallet, switches MetaMask to Chiliz Chain, and claims only inventory already funded for their position." },
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

        <section className="page-section calculator-layout"><div><p className="section-eyebrow">Economics</p><h2>The split is simple. Settlement is not.</h2><p>Every leg must survive finality, quote expiry, price-impact checks, retries, balance reconciliation, and on-chain proof. “Submitted” never means “complete.” Required before activation:</p><ul className="check-list pending"><li><Circle /> Exact integer accounting</li><li><Circle /> Idempotent settlement state</li><li><Circle /> Bounded slippage and price impact</li><li><Circle /> Supply delta proof after each burn</li></ul></div><FeeCalculator /></section>

        <section className="page-section">
          <SectionHeading eyebrow="Reward accounting" title="One funded pool, divided by time-weighted participation." copy="Epoch rules are fixed before the accounting window starts, and closed allocations are never silently rewritten." />
          <div className="equation-card"><span>YOUR FUNDED REWARD</span><div><strong>Fan Tokens funded for epoch</strong><b>×</b><strong>Your eligible token-seconds</strong><b>÷</b><strong>All eligible token-seconds</strong></div><p>Raw trade volume is not automatically rewarded. Protocol, LP, bonding-curve, treasury, and burn accounts are excluded.</p></div>
          <div className="epoch-states">{["Accruing", "Cutoff reached", "Reconciling", "Funded", "Root published", "Claimable", "Closed"].map((state,index)=><span key={state}><b>{index+1}</b>{state}</span>)}</div>
        </section>

        <section className="page-section route-paths">
          <div><p className="section-eyebrow">Primary route</p><h2>Chiliz V2 acquisition and MetaMask claim</h2><p>The community coin trades on Solana; its Fan Token reward is a separate asset on Chiliz Chain, not an Ethereum-mainnet token or a liquidity pair. Chiliz replaced its old Fan Token contracts with 18-decimal V2 contracts. The intended automatic path is finalized fee SOL → official Solana CHZ → native Chiliz CHZ → the selected current V2 Fan Token → a verified holder&apos;s 0x wallet. The swap, bridge, purchase, and payout are not yet enabled.</p><span className="route-label route-inventory">78 V2 contracts cataloged; execution paused</span></div>
          <div><p className="section-eyebrow">Holder wallet</p><h2>Chiliz Chain, not Ethereum mainnet</h2><p>The holder links a 0x wallet such as MetaMask and verifies control of it before requesting a claim. The planned payout worker would pay CHZ gas to transfer the funded V2 Fan Token directly to that address. Wallet linking grants no spending permission, and no claim is available yet.</p><span className="route-label route-inventory">MetaMask claim flow; payout paused</span></div>
          <div className="route-safety"><ShieldCheck /><h3>Safe failure beats a bad execution.</h3><p>Execution must stay paused when quotes disappear, price impact exceeds limits, inventory runs low, or RPC health degrades. Uncertain on-chain submissions require reconciliation before any retry.</p></div>
        </section>

        <section className="page-section burn-proof"><div><Flame /><span><p className="section-eyebrow">Proposed community-funded SPORTPAD burn</p><h2>Only the 20% share from other launches is earmarked for burns.</h2><p>Once the SPORTPAD mint exists and the buyback lane passes review, the 20% treasury is intended to buy SPORTPAD through Jupiter and burn the purchased amount. No automatic buyback or burn is active now. SPORTPAD&apos;s own creator fees remain with the project for development.</p></span></div><Button asChild variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"><Link href="/transparency">View deployment status <ArrowRight /></Link></Button></section>
      </main>
    </SiteChrome>
  );
}
