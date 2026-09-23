import { Calculator, CircleHelp, Layers3, ShieldCheck } from "lucide-react";

import { PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { RewardDashboard } from "./reward-dashboard";

export default function RewardsPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Wallet rewards" title="Track your wallet's reward position." copy="Verify the Solana wallet holding a SportPad launch token. Chiliz rewards would be sent as current V2 Fan Tokens to a separately verified 0x wallet. Purchases and claims remain paused until the V2 route and financial execution pass verification.">
          <div className="reward-hero-formula"><Calculator /><span>Your reward</span><strong>funded pool × your token-seconds</strong><small>÷ all eligible token-seconds</small></div>
        </PageIntro>
        <SafetyNotice>No balances are simulated. Every displayed position comes from finalized holder indexing, every allocation is limited by acquired inventory, and every payout links to its onchain receipt.</SafetyNotice>
        <section className="content-section"><RewardDashboard /></section>
        <section className="page-section">
          <SectionHeading eyebrow="Methodology" title="Time in the stands matters." copy="The target model approximates time-weighted balances from periodic finalized holder snapshots, rather than using only an end-of-epoch balance." />
          <div className="method-grid">
            <article><Layers3 /><h3>Balance over time</h3><p>Each finalized snapshot updates token-seconds using the last observed balance. Transfers between snapshots take effect at the next observation, so allocations are an approximation.</p></article>
            <article><ShieldCheck /><h3>Controlled accounts excluded</h3><p>The launch creator, bonding curve, fee configuration, protocol treasuries, off-curve program owners, and burn addresses do not share user rewards.</p></article>
            <article><Calculator /><h3>Integer-safe allocation</h3><p>Each epoch rounds down in atomic token units. Remainder dust is recorded and carried forward rather than disappearing.</p></article>
            <article><CircleHelp /><h3>Final only when funded</h3><p>An estimate becomes claimable only after the epoch closes, current-token inventory is reserved, and the allocation commitment is recorded.</p></article>
          </div>
        </section>
      </main>
    </SiteChrome>
  );
}
