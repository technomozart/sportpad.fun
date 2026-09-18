import { AlertTriangle, ArrowDown, CircleDollarSign, Flame, Radio, ShieldCheck, Trophy } from "lucide-react";

import { PageIntro, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { SystemStatus } from "./system-status";

export default function TransparencyPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro
          kicker="Proof of Rewards"
          title="Mainnet economic evidence will appear here after deployment."
          copy="No mainnet fee, reward, claim, or SPORTPAD burn events exist in this build. Private drafts can record verified Pump devnet creation and fee-share transactions. SportPad will publish only records backed by source transactions and reconciled balances."
        >
          <div className="transparency-fresh">
            <Radio />
            <span><strong>No mainnet events yet</strong><small>Mainnet execution is disabled</small></span>
          </div>
        </PageIntro>

        <section className="content-section transparency-metrics">
          <div><span>Fee indexer</span><strong>Not deployed</strong><small>No creator-fee events are being processed</small></div>
          <div><span>Protocol events</span><strong>No events yet</strong><small>No live settlement records</small></div>
          <div><span>Reward vaults</span><strong>Not deployed</strong><small>No official Fan Token inventory held</small></div>
          <div><span>SPORTPAD mint</span><strong>Not deployed</strong><small>No official address or supply</small></div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Planned capital flow"
            title="One source and two separately verified outcomes."
            copy="This diagram describes the planned accounting path. It does not represent a completed transaction."
          />
          <div className="capital-flow">
            <div className="flow-source"><CircleDollarSign /><span>Creator fees</span><strong>Not connected</strong><small>No collector or indexer deployed</small></div>
            <ArrowDown />
            <div className="flow-gate"><ShieldCheck /><span>Finality and reconciliation</span><small>Not deployed</small></div>
            <ArrowDown />
            <div className="flow-split"><span>80 / 20</span><strong>Planned deterministic split</strong></div>
            <div className="flow-branches">
              <div><Trophy /><span>OFFICIAL FAN TOKEN REWARDS · 80%</span><strong>Not funded</strong><ArrowDown /><small>No reward vaults deployed</small><ArrowDown /><b>No epochs yet</b></div>
              <div><Flame /><span>SPORTPAD BUYBACK + BURN · 20%</span><strong>Not executable</strong><ArrowDown /><small>SPORTPAD mint not deployed</small><ArrowDown /><b>No burn events yet</b></div>
            </div>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Settlement explorer"
            title="No mainnet settlement events yet."
            copy="When mainnet settlement is deployed, each row must link to its source transaction, reconciliation state, and final evidence."
          />
          <div className="source-panel">
            <div><Radio /><span><strong>No events yet</strong><small>The fee indexer and settlement workers are not deployed</small></span></div>
            <span className="asset-status status-researching">Not deployed</span>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Reward vaults"
            title="No reward vaults are deployed."
            copy="Balances, claim liabilities, and unallocated inventory will remain absent until verified vault addresses exist."
          />
          <div className="source-panel">
            <div><ShieldCheck /><span><strong>No inventory data</strong><small>No live vault address is available to verify</small></span></div>
            <span className="asset-status status-researching">Not deployed</span>
          </div>
        </section>

        <section id="status" className="page-section status-section">
          <div>
            <p className="section-eyebrow">System status</p>
            <h2>Provider checks are separate from protocol deployment.</h2>
            <p>The live checks below confirm provider access only. They do not prove that fee indexing, reward acquisition, claims, or SPORTPAD burns are running.</p>
          </div>
          <SystemStatus />
        </section>

        <div className="incident-note">
          <AlertTriangle />
          <div><strong>No mainnet execution is active.</strong><p>Production treasury addresses, mainnet transaction links, settlement batches, reward vaults, claims, and SPORTPAD burn proofs will appear only after those systems are deployed and independently verifiable.</p></div>
        </div>
      </main>
    </SiteChrome>
  );
}
