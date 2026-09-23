import { AlertTriangle, ArrowDown, CircleDollarSign, Flame, Radio, ShieldCheck, Trophy } from "lucide-react";

import { PageIntro, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { getExecutionStatus } from "@/lib/server/execution-status";
import { readGlobalLaunchReadiness } from "@/lib/server/launch-automation-readiness";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { SystemStatus } from "./system-status";

export const dynamic = "force-dynamic";

export default async function TransparencyPage() {
  const mainnet = readMainnetConfig();
  const [protocol, launch] = await Promise.all([
    getExecutionStatus().catch(() => null),
    readGlobalLaunchReadiness(),
  ]);
  const feeEvents = protocol?.counts.feeEvents;
  const protocolEvents = protocol?.counts.protocolEvents;
  const rewardVaults = protocol?.counts.rewardVaults;
  const rewardSwaps = protocol?.counts.rewardSwaps ?? 0;
  const buybackSwaps = protocol?.counts.buybackSwaps ?? 0;
  const sportpadBurns = protocol?.counts.sportpadBurns ?? 0;
  const sportpadMint = protocol?.protocolSettings.sportpadMint ?? mainnet.sportpadMint;
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro
          kicker="Proof of Rewards"
          title="Mainnet evidence appears only after verified execution."
          copy="When enabled, the launcher will record community coin creation and immutable 80/20 fee receipts. SPORTPAD's own creator fees are excluded and retained for development. Chiliz V2 purchase and payout routes remain unverified, and financial execution is paused."
        >
          <div className="transparency-fresh">
            <Radio />
            <span><strong>{feeEvents ? `${feeEvents} fee events observed` : "No fee events yet"}</strong><small>{protocol?.capabilities.unattendedAutomation ? "Worker heartbeat observed; financial execution remains separately gated" : "Treasury automation is paused"}</small></span>
          </div>
        </PageIntro>

        <section className="content-section transparency-metrics">
          <div><span>Fee events</span><strong>{feeEvents ?? "Unavailable"}</strong><small>Finalized fee records in the ledger</small></div>
          <div><span>Protocol events</span><strong>{protocolEvents ?? "Unavailable"}</strong><small>Auditable control and observation records</small></div>
          <div><span>Reward vaults</span><strong>{rewardVaults ?? "Unavailable"}</strong><small>Fan Token inventory records in the ledger</small></div>
          <div><span>SPORTPAD mint</span><strong>{sportpadMint ? "Configured" : "Not configured"}</strong><small>{sportpadMint ? "Buyback asset address is registered" : "Buyback and burn lane stays locked"}</small></div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Planned capital flow"
            title="One fee source and two intended outcomes."
            copy="Automatic purchases, claims, and burns are paused. Counts remain at zero until real finalized transactions are recorded. Nothing below is simulated."
          />
          <div className="capital-flow">
            <div className="flow-source"><CircleDollarSign /><span>Community launch creator fees</span><strong>{feeEvents ? `${feeEvents} observed` : "None observed"}</strong><small>SPORTPAD&apos;s own fee stream is excluded from this ledger</small></div>
            <ArrowDown />
            <div className="flow-gate"><ShieldCheck /><span>Finality and reconciliation</span><small>Durable intents and exact signed messages</small></div>
            <ArrowDown />
            <div className="flow-split"><span>80 / 20</span><strong>Target onchain fee split</strong></div>
            <div className="flow-branches">
              <div><Trophy /><span>OFFICIAL FAN TOKEN REWARDS · 80%</span><strong>{rewardSwaps ? `${rewardSwaps} swap records` : "No swap records"}</strong><ArrowDown /><small>{rewardVaults ? `${rewardVaults} inventory records` : "No verified inventory yet"}</small><ArrowDown /><b>{protocol?.counts.rewardEpochs ? `${protocol.counts.rewardEpochs} reward epochs` : "No epochs yet"}</b></div>
              <div><Flame /><span>COMMUNITY-FUNDED SPORTPAD BURN · 20%</span><strong>{buybackSwaps ? `${buybackSwaps} buyback records` : "No buyback records"}</strong><ArrowDown /><small>{sportpadMint ? "SPORTPAD mint configured" : "SPORTPAD mint not configured"}</small><ArrowDown /><b>{sportpadBurns ? `${sportpadBurns} burn records` : "No burn events yet"}</b></div>
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
            title={rewardVaults ? `${rewardVaults} reward vault records.` : "No reward vaults are funded."}
            copy="A vault record alone does not prove the current Fan Token is held. Balances, claim liabilities, and unallocated inventory require verified token accounts and chain receipts."
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
            <p>The live checks confirm provider access. Transaction counters above come only from durable receipts and never from provider health checks.</p>
          </div>
          <SystemStatus />
        </section>

        <div className="incident-note">
          <AlertTriangle />
          <div><strong>{launch.ready ? "Mainnet launcher is enabled." : "New mainnet launches are paused until required financial automation is verified."}</strong><p>The 80/20 route applies to community launches only. SPORTPAD&apos;s own creator fees stay with the project for development. {launch.ready ? sportpadMint ? "Reward and buyback workers passed the launch gate." : "Reward execution passed the launch gate. The 20% share accumulates in its dedicated treasury until the SPORTPAD mint and buyback execution are ready." : `Waiting for: ${launch.missing.join(", ")}.`}</p></div>
        </div>
      </main>
    </SiteChrome>
  );
}
