import { Calculator, CircleHelp, Layers3, ShieldCheck } from "lucide-react";

import { PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { RewardDashboard } from "./reward-dashboard";

export default function RewardsPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Wallet rewards" title="Track your wallet's reward position." copy="Verify the Solana wallet holding a SportPad launch token. Chiliz rewards are designed for claims to a linked MetaMask wallet, but new claims are paused until financial execution is verified.">
          <div className="reward-hero-formula"><Calculator /><span>Your reward</span><strong>funded pool × your token-seconds</strong><small>÷ all eligible token-seconds</small></div>
        </PageIntro>
        <SafetyNotice>No balances are simulated. Every displayed position comes from finalized holder indexing, every allocation is limited by acquired inventory, and every payout links to its onchain receipt.</SafetyNotice>
        <section className="content-section"><RewardDashboard /></section>
        <section className="page-section">
          <SectionHeading eyebrow="Methodology" title="Time in the stands matters." copy="The target model uses time-weighted balances instead of one convenient end-of-epoch snapshot." />
          <div className="method-grid">
            <article><Layers3 /><h3>Balance over time</h3><p>Every finalized balance interval contributes token-seconds. Holding more for longer generally produces more eligible points.</p></article>
            <article><ShieldCheck /><h3>Controlled accounts excluded</h3><p>The launch creator, bonding curve, fee configuration, protocol treasuries, off-curve program owners, and burn addresses do not share user rewards.</p></article>
            <article><Calculator /><h3>Integer-safe allocation</h3><p>Each epoch rounds down in atomic token units. Remainder dust is recorded and carried forward rather than disappearing.</p></article>
            <article><CircleHelp /><h3>Final only when funded</h3><p>An estimate becomes claimable only after the epoch closes, inventory is reserved, allocation is committed, and the claim root is published.</p></article>
          </div>
        </section>
      </main>
    </SiteChrome>
  );
}
