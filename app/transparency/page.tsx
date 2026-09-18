import { AlertTriangle, ArrowDown, BadgeCheck, CheckCircle2, CircleDollarSign, Flame, Radio, ShieldCheck, Trophy } from "lucide-react";

import { DemoBadge, PageIntro, SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { fanAssets, feeEvents } from "@/lib/site-data";
import { SystemStatus } from "./system-status";

const batchStages = ["OBSERVED", "FINALIZED", "COLLECTED", "SPLIT_CONFIRMED", "REWARD_ACQUIRED", "BURN_FINALIZED", "SUPPLY_VERIFIED"];

export default function TransparencyPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Proof of Rewards" title="Follow every SOL from fee receipt to reward or burn." copy="This explorer treats accounting as evidence, not marketing: finalized source events, exact splits, acquired inventory, distribution commitments, claims, and verified supply reduction.">
          <div className="transparency-fresh"><Radio /><span><strong>Indexer healthy</strong><small>Demo cutoff slot 361,284,102</small></span><DemoBadge /></div>
        </PageIntro>

        <section className="content-section transparency-metrics">
          <div><span>Finalized creator fees</span><strong>41.300000 SOL</strong><small>Demo reconciliation total</small></div><div><span>Reward allocation</span><strong>33.040000 SOL</strong><small>80.00% exact split</small></div><div><span>Buyback allocation</span><strong>8.260000 SOL</strong><small>20.00% exact split</small></div><div><span>Unresolved variance</span><strong className="positive">0.000000 SOL</strong><small>At displayed cutoff</small></div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Capital flow" title="One source, two independently reconciled legs." copy="The production explorer will link every completed box to its transaction, quote, balance delta, and finality state." />
          <div className="capital-flow">
            <div className="flow-source"><CircleDollarSign /><span>Creator fees received</span><strong>12.500000 SOL</strong><small>SET-2026-09-18-004281</small></div><ArrowDown />
            <div className="flow-gate"><ShieldCheck /><span>Finality + balance reconciliation</span><small>Source delta verified</small></div><ArrowDown />
            <div className="flow-split"><span>80 / 20</span><strong>Deterministic atomic split</strong></div>
            <div className="flow-branches"><div><Trophy /><span>REWARD LEG · 80%</span><strong>10.000000 SOL</strong><ArrowDown /><small>31.742 BAR acquired</small><ArrowDown /><b>Epoch 26 reserved</b></div><div><Flame /><span>BUYBACK LEG · 20%</span><strong>2.500000 SOL</strong><ArrowDown /><small>1,284,399 SPORT acquired</small><ArrowDown /><b>Supply delta verified</b></div></div>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Settlement explorer" title="Recent protocol events." copy="Demo signatures are shortened and intentionally non-clickable. Production rows will resolve to Solscan." />
          <div className="explorer-table-wrap"><table className="explorer-table"><thead><tr><th>Event</th><th>Source</th><th>Amount</th><th>State</th><th>Evidence</th><th>Time</th></tr></thead><tbody>{feeEvents.map((event)=><tr key={event.id}><td><span className={`event-dot event-${event.state.toLowerCase()}`} /><span><strong>{event.kind}</strong><small>{event.id}</small></span></td><td>{event.launch}</td><td>{event.amount}</td><td><code>{event.state.toUpperCase()}</code></td><td><span className="signature">Demo fixture · {event.signature}</span></td><td>{event.time}</td></tr>)}</tbody></table></div>
        </section>

        <section className="page-section batch-detail">
          <div className="batch-heading"><div><p className="section-eyebrow">Completed batch</p><h2>SET-2026-09-18-004281</h2><p>One fee receipt traced through both downstream economic legs.</p></div><span className="asset-status route-ready"><BadgeCheck /> Supply delta verified</span></div>
          <div className="batch-timeline">{batchStages.map((stage,index)=><div key={stage}><span><CheckCircle2 /></span><strong>{stage}</strong><small>{index < 2 ? "Finalized slot" : index < 4 ? "Treasury reconciled" : index < 6 ? "Transaction finalized" : "Mint supply checked"}</small></div>)}</div>
          <div className="batch-values"><div><span>Gross fees</span><strong>12.500000 SOL</strong></div><div><span>BAR acquired</span><strong>31.742000 BAR</strong></div><div><span>SPORT acquired</span><strong>1,284,399.420</strong></div><div><span>SPORT burned</span><strong>1,284,399.420</strong></div><div><span>Accounting dust</span><strong>0 lamports</strong></div></div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Reward vaults" title="Inventory reserved is not inventory available." copy="Each vault separates claim liabilities, future allocations, and unallocated treasury inventory." />
          <div className="vault-grid">{fanAssets.slice(0,5).map((asset,index)=><article key={asset.symbol}><div><TokenMark token={asset.symbol} color={asset.color} /><span><strong>{asset.symbol} vault</strong><small>{asset.status}</small></span></div><dl><dt>Total balance</dt><dd>{[620.4,488.1,904.8,202.4,178.2][index]} {asset.symbol}</dd><dt>Reserved for claims</dt><dd>{[428.6,319.7,511.2,186.1,94.8][index]} {asset.symbol}</dd><dt>Unallocated</dt><dd>{[191.8,168.4,393.6,16.3,83.4][index]} {asset.symbol}</dd></dl><span className={`asset-status status-${asset.status.toLowerCase().replaceAll(" ", "-")}`}>{asset.status}</span></article>)}</div>
        </section>

        <section id="status" className="page-section status-section">
          <div><p className="section-eyebrow">System status</p><h2>Safe systems show degraded states.</h2><p>Production components will report the last processed slot, last successful transaction, backlog, and active incident instead of collapsing health into one green dot.</p></div>
          <SystemStatus />
        </section>

        <div className="incident-note"><AlertTriangle /><div><strong>No mainnet execution is active.</strong><p>All values on this page are coherent demo fixtures designed to show the eventual proof surface. Treasury addresses and live transaction links will appear only after audited contracts and capped signers are deployed.</p></div></div>
      </main>
    </SiteChrome>
  );
}
