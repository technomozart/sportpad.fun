import { SiteLink as Link } from "@/components/site-link";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Coins,
  Flame,
  Layers3,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  Trophy,
  WalletCards,
} from "lucide-react";

import { SiteChrome } from "@/components/site-chrome";
import { PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { Button } from "@/components/ui/button";

const burnStages = [
  {
    icon: CircleDollarSign,
    title: "Fee leg finalized",
    copy: "The 20% share of a reconciled community-launch creator-fee batch becomes a SPORTPAD acquisition intent.",
  },
  {
    icon: Coins,
    title: "SPORTPAD acquired",
    copy: "Execution proceeds only inside published quote, price-impact, slippage, and treasury limits.",
  },
  {
    icon: Flame,
    title: "BurnChecked submitted",
    copy: "Acquired SPORTPAD is destroyed with the SPL Token BurnChecked instruction, not sent to a vanity wallet.",
  },
  {
    icon: BadgeCheck,
    title: "Supply delta verified",
    copy: "A batch is complete only after finality and an authoritative mint-supply reduction match the burn amount.",
  },
];

export default function SportTokenPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro
          kicker="Planned platform token"
          title="SPORTPAD is a protocol token concept, not a deployed asset."
          copy="The proposed community-launch fee lock sends 80% to a Fan Token reward treasury and 20% to a SPORTPAD buyback treasury. Those transfers do not themselves purchase rewards or burn tokens. SPORTPAD's own creator fees are reserved for project development."
        >
          <div className="page-stat-card">
            <strong>Not deployed</strong>
            <span>SPORTPAD mint address</span>
            <small>No official address exists</small>
          </div>
        </PageIntro>

        <SafetyNotice>
          No SPORTPAD token has been deployed, offered, sold, or made tradeable through this build. New mainnet launches and automatic buyback and burn execution are paused. Ignore any address claiming to be official until it is published here and independently verifiable on Solana.
        </SafetyNotice>

        <section className="content-section protocol-stats" aria-label="SPORTPAD deployment status">
          <div><span>Mint</span><strong>Not deployed</strong><small>No official address</small></div>
          <div><span>Total supply</span><strong>Not defined</strong><small>Tokenomics pending review</small></div>
          <div><span>Community launch rewards</span><strong>80% fee route designed</strong><small>Purchases and claims are not yet active</small></div>
          <div><span>Community-funded SPORTPAD burn</span><strong>20% fee route designed</strong><small>Buyback and burn are not yet active</small></div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Proposed mechanism"
            title="A buyback is not a burn until supply falls."
            copy="The 20% leg comes only from other tokens launched on SportPad. Quotes, transactions, finality, and mint supply must agree before the public explorer marks a batch complete."
          />
          <div className="how-flow">
            {burnStages.map((stage, index) => (
              <article key={stage.title} className="how-step">
                <span>0{index + 1}</span>
                <stage.icon />
                <h3>{stage.title}</h3>
                <p>{stage.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="page-section calculator-layout">
          <div>
            <p className="section-eyebrow">Current deployment state</p>
            <h2>The mechanism is built, but economic execution is paused.</h2>
            <p>The fee indexer, swap preparation, and burn builder exist in code. The SPORTPAD mint is not configured, the automatic buyback worker is not enabled, and no buyback or burn has been verified. A completed burn requires a finalized transaction and a matching supply reduction.</p>
            <ul className="check-list">
              <li><CheckCircle2 /> Proposed 80% share for official Fan Token rewards</li>
              <li><CheckCircle2 /> Proposed 20% share for SPORTPAD buyback and burn</li>
              <li><CheckCircle2 /> SPORTPAD&apos;s own fees fund project development</li>
              <li><CheckCircle2 /> No fabricated output estimates</li>
              <li><CheckCircle2 /> Supply proof required after deployment</li>
            </ul>
          </div>
          <div className="fee-calculator" aria-label="SPORTPAD deployment state">
            <div className="fee-calculator-head">
              <Flame />
              <div><span>CURRENT EXECUTION</span><strong>Paused</strong></div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><span className="text-white/45">Fee indexer</span><strong className="mt-2 block text-xl">Code ready</strong></div>
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><span className="text-white/45">SPORTPAD mint</span><strong className="mt-2 block text-xl">Not deployed</strong></div>
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><span className="text-white/45">Buyback execution</span><strong className="mt-2 block text-xl">Paused</strong></div>
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><span className="text-white/45">Verified burns</span><strong className="mt-2 block text-xl">No events yet</strong></div>
            </div>
            <p>These are deployment states, not balances, quotes, forecasts, or token allocations.</p>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Utility boundaries"
            title="What SPORTPAD may coordinate and what it will never promise."
            copy="Final utility must be technically useful, legally reviewed, and published before deployment. Holding a platform token should never be presented as guaranteed income."
          />
          <div className="route-paths">
            <div>
              <p className="section-eyebrow">Under evaluation</p>
              <h2>Protocol-aligned utility</h2>
              <p>Potential uses include transparent fee routing, creator reputation signals, governance over narrowly scoped protocol parameters, or access to non-financial product features. None are active today.</p>
              <span className="route-label route-inventory">Design and legal review</span>
            </div>
            <div>
              <p className="section-eyebrow">Explicitly not promised</p>
              <h2>No yield or ownership claims</h2>
              <p>SPORTPAD does not represent equity, club ownership, dividends, interest, revenue rights, guaranteed appreciation, guaranteed liquidity, or access to a team’s official benefits.</p>
              <span className="route-label negative">No guaranteed return</span>
            </div>
            <div className="route-safety">
              <ShieldAlert />
              <h3>Buybacks do not create a price floor.</h3>
              <p>Market prices can still fall to zero. Execution can pause when liquidity, quotes, treasury policy, infrastructure, compliance, or signer safety does not meet published limits.</p>
            </div>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Before deployment"
            title="The public checklist that must turn green first."
            copy="A real mint address should appear only after the economic model, contracts, custody boundaries, and operating controls are ready for independent scrutiny."
          />
          <div className="four-checks">
            <article><span>01</span><Layers3 /><h3>Tokenomics published</h3><p>Supply, allocations, vesting, authorities, liquidity plan, and material conflicts are disclosed in atomic and human-readable units.</p></article>
            <article><span>02</span><LockKeyhole /><h3>Authorities secured</h3><p>Mint, freeze, metadata, treasury, and upgrade authorities are removed or governed by explicit capped signer policies.</p></article>
            <article><span>03</span><ShieldCheck /><h3>Contracts reviewed</h3><p>Buyback, burn, accounting, pause, and recovery paths complete testing, external review, and a limited-value canary.</p></article>
            <article><span>04</span><WalletCards /><h3>Proof surface live</h3><p>The exact mint, treasury addresses, quotes, transaction signatures, burns, and supply deltas are visible in the transparency explorer.</p></article>
          </div>
        </section>

        <section className="page-section burn-proof">
          <div>
            <Clock3 />
            <span>
              <p className="section-eyebrow">Current status</p>
              <h2>Draft builder available. Mainnet launch paused.</h2>
              <p>No countdown, presale, allocation, airdrop, or token-generation event has been announced. SPORTPAD&apos;s own creator fees will fund project development after launch.</p>
            </span>
          </div>
          <Button asChild variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white">
            <Link href="/transparency">View system status <ArrowRight /></Link>
          </Button>
        </section>

        <section className="final-cta compact-cta">
          <div>
            <p className="section-eyebrow">Understand the whole route</p>
            <h2>The proposed fee route has two destinations.</h2>
            <p>For future community launches, the fee configuration would direct 80% to a Fan Token reward treasury and 20% to a SPORTPAD buyback treasury. Purchases and burns require separate verified execution. SPORTPAD&apos;s own fees stay with the project.</p>
          </div>
          <div>
            <Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 text-[#071008] hover:bg-[#adff7d]">
              <Link href="/how-it-works"><Trophy /> See the 80 / 20 flow</Link>
            </Button>
            <Link href="/policy" className="text-link">Read launch policy <ArrowRight /></Link>
          </div>
        </section>
      </main>
    </SiteChrome>
  );
}
