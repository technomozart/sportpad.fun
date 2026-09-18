import Link from "next/link";
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
import { DemoBadge, PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { Button } from "@/components/ui/button";

const burnStages = [
  {
    icon: CircleDollarSign,
    title: "Fee leg finalized",
    copy: "Exactly 20% of a reconciled qualifying creator-fee batch becomes a SPORT acquisition intent.",
  },
  {
    icon: Coins,
    title: "SPORT acquired",
    copy: "Execution proceeds only inside published quote, price-impact, slippage, and treasury limits.",
  },
  {
    icon: Flame,
    title: "BurnChecked submitted",
    copy: "Acquired SPORT is destroyed with the SPL Token BurnChecked instruction—not sent to a vanity wallet.",
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
          title="SPORT is the protocol token concept—not a deployed asset."
          copy="SportPad’s proposed economics route 20% of qualifying creator fees toward market purchases and permanent burns of a future SPORT token. The mint, supply, launch terms, and utility are not final."
        >
          <div className="page-stat-card">
            <DemoBadge />
            <strong>TBD</strong>
            <span>SPORT mint address</span>
            <small>Mainnet deployment locked</small>
          </div>
        </PageIntro>

        <SafetyNotice>
          No SPORT token has been deployed, offered, sold, or made tradeable through this build. Ignore any address claiming to be official until it is published here and independently verifiable on Solana.
        </SafetyNotice>

        <section className="content-section protocol-stats" aria-label="SPORT deployment status">
          <div><span>Mint</span><strong>Not deployed</strong><small>No official address</small></div>
          <div><span>Total supply</span><strong>Not defined</strong><small>Tokenomics pending review</small></div>
          <div><span>Buyback allocation</span><strong>20% target</strong><small>Qualifying creator fees</small></div>
          <div><span>Execution</span><strong>Mainnet locked</strong><small>Audit and canary required</small></div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Proposed mechanism"
            title="A buyback is not a burn until supply falls."
            copy="The 20% leg is designed as a separately reconciled settlement path. Quotes, transactions, finality, and mint supply must agree before the public explorer marks a batch complete."
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
            <p className="section-eyebrow">Illustrative accounting</p>
            <h2>The percentage is fixed in the concept. The output is not.</h2>
            <p>A 12.50 SOL finalized fee batch would create a 2.50 SOL SPORT buyback intent. The number of SPORT acquired depends on an executable quote at that moment; no token-output estimate is guaranteed.</p>
            <ul className="check-list">
              <li><CheckCircle2 /> Integer-safe 80 / 20 split</li>
              <li><CheckCircle2 /> Maximum price-impact policy</li>
              <li><CheckCircle2 /> Replay-safe settlement IDs</li>
              <li><CheckCircle2 /> Post-burn supply verification</li>
            </ul>
          </div>
          <div className="fee-calculator" aria-label="Demo SPORT buyback accounting example">
            <div className="fee-calculator-head">
              <Flame />
              <div><span>DEMO BATCH</span><strong>SET-SPORT-DEMO-0001</strong></div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><span className="text-white/45">Gross creator fees</span><strong className="mt-2 block text-xl">12.50 SOL</strong></div>
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><span className="text-white/45">20% buyback intent</span><strong className="mt-2 block text-xl text-[#9cff57]">2.50 SOL</strong></div>
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><span className="text-white/45">SPORT acquired</span><strong className="mt-2 block text-xl">Demo only</strong></div>
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><span className="text-white/45">Verified supply delta</span><strong className="mt-2 block text-xl">Demo only</strong></div>
            </div>
            <p>Values illustrate the accounting surface. They are not a quote, forecast, token allocation, or promise of future performance.</p>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Utility boundaries"
            title="What SPORT may coordinate—and what it will never promise."
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
              <p>SPORT does not represent equity, club ownership, dividends, interest, revenue rights, guaranteed appreciation, guaranteed liquidity, or access to a team’s official benefits.</p>
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
              <h2>Research and private-prototype stage.</h2>
              <p>No countdown, presale, allocation, airdrop, or token-generation event has been announced. This page is the canonical in-product status until that changes.</p>
            </span>
          </div>
          <Button asChild variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white">
            <Link href="/transparency">Open demo proofs <ArrowRight /></Link>
          </Button>
        </section>

        <section className="final-cta compact-cta">
          <div>
            <p className="section-eyebrow">Understand the whole route</p>
            <h2>SPORT is one leg of a two-outcome fee system.</h2>
            <p>The other 80% is designed to fund verified Fan Token rewards for eligible community-token holders.</p>
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
