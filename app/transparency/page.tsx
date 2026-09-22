import { AlertTriangle, ArrowDown, CircleDollarSign, Flame, Radio, ShieldCheck, Trophy } from "lucide-react";

import { PageIntro, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { getExecutionStatus } from "@/lib/server/execution-status";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { SystemStatus } from "./system-status";

export const dynamic = "force-dynamic";

export default async function TransparencyPage() {
  const mainnet = readMainnetConfig();
  const protocol = await getExecutionStatus().catch(() => null);
  const feeEvents = protocol?.counts.feeEvents;
  const protocolEvents = protocol?.counts.protocolEvents;
  const rewardVaults = protocol?.counts.rewardVaults;
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro
          kicker="Proof of Rewards"
          title="Mainnet evidence appears only after verified execution."
          copy="The launcher records verified Pump mainnet coin creation and immutable 80/20 fee configuration receipts. The execution control plane records treasury observations and worker runs. Reward purchases, holder allocations, claims, and SPORTPAD burns appear only after verified source transactions exist."
        >
          <div className="transparency-fresh">
            <Radio />
            <span><strong>{feeEvents ? `${feeEvents} fee events observed` : "No fee events yet"}</strong><small>{protocol?.mode === "execution_ready" ? "All execution gates are ready" : "Transaction execution remains locked"}</small></span>
          </div>
        </PageIntro>

        <section className="content-section transparency-metrics">
          <div><span>Fee events</span><strong>{feeEvents ?? "Unavailable"}</strong><small>Finalized fee records in the ledger</small></div>
          <div><span>Protocol events</span><strong>{protocolEvents ?? "Unavailable"}</strong><small>Auditable control and observation records</small></div>
          <div><span>Reward vaults</span><strong>{rewardVaults ?? "Unavailable"}</strong><small>Verified official Fan Token inventory accounts</small></div>
          <div><span>SPORTPAD mint</span><strong>{mainnet.sportpadMint ? "Configured" : "Not configured"}</strong><small>{mainnet.sportpadMint ? "Buyback asset address is registered" : "Buyback and burn lane stays locked"}</small></div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Planned capital flow"
            title="One source and two separately verified outcomes."
            copy="This diagram describes the planned accounting path. It does not represent a completed transaction."
          />
          <div className="capital-flow">
            <div className="flow-source"><CircleDollarSign /><span>Creator fees</span><strong>{feeEvents ? `${feeEvents} observed` : "None observed"}</strong><small>The settlement lane remains fail-closed</small></div>
            <ArrowDown />
            <div className="flow-gate"><ShieldCheck /><span>Finality and reconciliation</span><small>Durable control plane deployed</small></div>
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
            title={protocol?.counts.settlements ? `${protocol.counts.settlements} settlement records.` : "No mainnet settlement events yet."}
            copy="Every settlement record must link to its source transaction, reconciliation state, idempotent worker steps, and final evidence."
          />
          <div className="source-panel">
            <div><Radio /><span><strong>{protocol?.counts.settlements ? "Settlement records available" : "No settlements yet"}</strong><small>{protocol?.readiness.settlement.missing.join(", ") || "Settlement lane ready"}</small></span></div>
            <span className="asset-status status-researching">{protocol?.readiness.settlement.ready ? "Ready" : "Locked"}</span>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Reward vaults"
            title={rewardVaults ? `${rewardVaults} reward vaults verified.` : "No reward vaults are funded."}
            copy="Balances, claim liabilities, and unallocated inventory remain absent until verified vault addresses and official Fan Token inventory exist."
          />
          <div className="source-panel">
            <div><ShieldCheck /><span><strong>{rewardVaults ? "Vault inventory records available" : "No inventory data"}</strong><small>{protocol?.readiness.rewards.missing.join(", ") || "Reward lane ready"}</small></span></div>
            <span className="asset-status status-researching">{protocol?.readiness.rewards.ready ? "Ready" : "Locked"}</span>
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
          <div><strong>{mainnet.ready ? "Mainnet launcher is enabled. Transaction workers remain independently gated." : "Mainnet launcher setup is incomplete."}</strong><p>The control plane and read-only treasury observer are deployed. Settlement batches, reward vaults, claims, and SPORTPAD burn proofs appear only after their managed signers are connected and their transactions are independently verified.</p></div>
        </div>
      </main>
    </SiteChrome>
  );
}
