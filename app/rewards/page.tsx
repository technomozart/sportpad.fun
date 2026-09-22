import { Calculator, CircleHelp, Layers3, ShieldCheck } from "lucide-react";

import { PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { RewardDashboard } from "./reward-dashboard";

export default function RewardsPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Wallet rewards" title="Accruing, funded, and claimable are not the same thing." copy="The dashboard separates protocol readiness from finalized allocations. The durable reward ledger is deployed, while holder indexing, funded vaults, and claims remain locked until their production gates are satisfied.">
          <div className="reward-hero-formula"><Calculator /><span>Your reward</span><strong>funded pool × your token-seconds</strong><small>÷ all eligible token-seconds</small></div>
        </PageIntro>
        <SafetyNotice>No wallet balances or reward amounts are simulated. Real positions will appear only after wallet ownership is verified and finalized protocol data exists.</SafetyNotice>
        <section className="content-section"><RewardDashboard /></section>
        <section className="page-section">
          <SectionHeading eyebrow="Methodology" title="Time in the stands matters." copy="The target model uses time-weighted balances instead of one convenient end-of-epoch snapshot." />
          <div className="method-grid">
            <article><Layers3 /><h3>Balance over time</h3><p>Every finalized balance interval contributes token-seconds. Holding more for longer generally produces more eligible points.</p></article>
            <article><ShieldCheck /><h3>System accounts excluded</h3><p>Bonding curves, liquidity pools, protocol treasuries, burns, and other controlled accounts do not share user rewards.</p></article>
            <article><Calculator /><h3>Integer-safe allocation</h3><p>Each epoch rounds down in atomic token units. Remainder dust is recorded and carried forward rather than disappearing.</p></article>
            <article><CircleHelp /><h3>Final only when funded</h3><p>An estimate becomes claimable only after the epoch closes, inventory is reserved, allocation is committed, and the claim root is published.</p></article>
          </div>
        </section>
      </main>
    </SiteChrome>
  );
}
