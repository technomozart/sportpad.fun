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
  const rewardSwaps = protocol?.counts.rewardSwaps ?? 0;
  const buybackSwaps = protocol?.counts.buybackSwaps ?? 0;
  const sportpadBurns = protocol?.counts.sportpadBurns ?? 0;
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro
          kicker="Proof of Rewards"
          title="Mainnet evidence appears only after verified execution."
          copy="The launcher records verified Pump mainnet creation and immutable 80/20 fee configuration receipts. Finalized fee distributions are indexed from chain. Wallet-confirmed Jupiter swaps and SPORTPAD burns are recorded as they happen. Holder allocations and claims appear only after verified reward inventory exists."
        >
          <div className="transparency-fresh">
            <Radio />
            <span><strong>{feeEvents ? `${feeEvents} fee events observed` : "No fee events yet"}</strong><small>{protocol?.capabilities.walletExecutionEnabled ? "Wallet-confirmed treasury execution enabled" : "Treasury execution is paused"}</small></span>
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
            eyebrow="Deployed capital flow"
            title="One verified source and two wallet-confirmed outcomes."
            copy="Counts remain at zero until real finalized transactions are recorded. Nothing below is simulated."
          />
          <div className="capital-flow">
            <div className="flow-source"><CircleDollarSign /><span>Creator fees</span><strong>{feeEvents ? `${feeEvents} observed` : "None observed"}</strong><small>Only exact finalized Pump 80/20 distributions are indexed</small></div>
            <ArrowDown />
            <div className="flow-gate"><ShieldCheck /><span>Finality and reconciliation</span><small>Durable intents and exact signed messages</small></div>
            <ArrowDown />
            <div className="flow-split"><span>80 / 20</span><strong>Immutable onchain split</strong></div>
            <div className="flow-branches">
              <div><Trophy /><span>OFFICIAL FAN TOKEN REWARDS · 80%</span><strong>{rewardSwaps ? `${rewardSwaps} swaps submitted` : "No swaps submitted"}</strong><ArrowDown /><small>{rewardVaults ? `${rewardVaults} inventory records` : "No verified inventory yet"}</small><ArrowDown /><b>No epochs yet</b></div>
              <div><Flame /><span>SPORTPAD BUYBACK + BURN · 20%</span><strong>{buybackSwaps ? `${buybackSwaps} buybacks submitted` : "No buybacks submitted"}</strong><ArrowDown /><small>{mainnet.sportpadMint ? "SPORTPAD mint configured" : "SPORTPAD mint not deployed"}</small><ArrowDown /><b>{sportpadBurns ? `${sportpadBurns} burns submitted` : "No burn events yet"}</b></div>
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
            <p>The live checks confirm provider access. Transaction counters above come only from durable receipts and never from provider health checks.</p>
          </div>
          <SystemStatus />
        </section>

        <div className="incident-note">
          <AlertTriangle />
          <div><strong>{mainnet.ready ? "Mainnet launcher is enabled." : "Mainnet launcher setup is incomplete."}</strong><p>The finalized fee indexer and wallet-confirmed settlement console are deployed. Fully unattended execution, reward epochs, and claims stay independently gated until managed signers and verified reward inventory are configured.</p></div>
        </div>
      </main>
    </SiteChrome>
  );
}
