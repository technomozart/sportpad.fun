import { SiteLink as Link } from "@/components/site-link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpen,
  CircleDollarSign,
  Clock3,
  Coins,
  Flame,
  Goal,
  Layers3,
  Radio,
  ShieldCheck,
  Sparkles,
  Trophy,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DemoBadge, LaunchCard, SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { fanAssets, faqItems, feeEvents, fixtures, launches } from "@/lib/site-data";

export default function Home() {
  return (
    <SiteChrome>
      <main>
        <section className="home-hero page-wrap">
          <div className="home-hero-copy">
            <div className="hero-kicker"><span className="live-pulse" /> Solana community coins · verified reward assets</div>
            <h1>Launch the culture.<br /><span>Reward the holders.</span></h1>
            <p>Create a community token on Solana, link it to a verified sports Fan Token, and route qualifying creator fees into transparent holder rewards and planned SPORT buybacks.</p>
            <div className="hero-actions">
              <Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 font-semibold text-[#071008] hover:bg-[#adff7d]">
                <Link href="/launch"><Sparkles className="size-4" /> Launch a token</Link>
              </Button>
              <Button asChild variant="outline" className="h-12 rounded-full border-white/10 bg-white/[0.035] px-6 text-white hover:bg-white/10 hover:text-white">
                <Link href="/discover">Explore launches <ArrowRight className="size-4" /></Link>
              </Button>
            </div>
            <div className="hero-proof-row">
              <span><BadgeCheck /> Verified reward mints</span>
              <span><WalletCards /> One Solana wallet</span>
              <span><ShieldCheck /> On-chain proofs</span>
            </div>
          </div>
          <div className="match-console" aria-label="SportPad protocol preview">
            <div className="match-console-head"><span><Radio /> Protocol preview</span><DemoBadge /></div>
            <div className="scoreboard">
              <div><small>COMMUNITY COIN</small><TokenMark token="CATALA" color="#9cff57" size="lg" /><strong>$CATALA</strong><span>1,284 holders</span></div>
              <div className="scoreboard-center"><span>LINKED<br />REWARDS</span><Goal /><small>Epoch 27</small></div>
              <div><small>VERIFIED REWARD</small><TokenMark token="BAR" color="#66e4ff" size="lg" /><strong>$BAR</strong><span>Official Solana mint</span></div>
            </div>
            <div className="fee-split-visual">
              <div className="split-source"><CircleDollarSign /><span>Creator fees received</span><strong>12.50 SOL</strong></div>
              <div className="split-line"><span style={{ width: "80%" }} /><span style={{ width: "20%" }} /></div>
              <div className="split-destinations"><div><Trophy /><span>80% reward inventory</span><strong>10.00 SOL</strong></div><div><Flame /><span>20% planned buyback</span><strong>2.50 SOL</strong></div></div>
            </div>
            <p className="match-console-note">Illustrative protocol data. No mainnet transactions are enabled.</p>
          </div>
        </section>

        <section className="protocol-stats page-wrap" aria-label="Protocol preview statistics">
          <div><span>Creator fees reconciled</span><strong>41.30 SOL</strong><small>Demo fixture</small></div>
          <div><span>Reward inventory value</span><strong>$8,420</strong><small>Demo value · 5 separate assets</small></div>
          <div><span>Completed reward epochs</span><strong>26</strong><small>Allocation proofs</small></div>
          <div><span>Planned SPORT burn</span><strong>4.82M</strong><small>Demo target · mint not deployed</small></div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Discover" title="Community launches with a reward story." copy="Browse independently created coins and see the verified Fan Token each reward pool is designed to fund." action={<Link href="/discover" className="text-link">View all launches <ArrowRight /></Link>} />
          <div className="featured-launch-grid">{launches.slice(0, 3).map((launch) => <LaunchCard key={launch.slug} launch={launch} />)}</div>
          <p className="section-footnote">Market values are illustrative while mainnet execution is locked. A verified reward mint does not make the community token official.</p>
        </section>

        <section className="page-section page-wrap">
          <div className="identity-explainer">
            <div className="identity-card community-card">
              <span className="identity-number">01</span><div className="identity-icon"><Sparkles /></div>
              <p className="section-eyebrow">What you launch</p><h2>Community token</h2>
              <p>An independent Solana coin built around a supporter narrative, matchday moment, athlete meme, or sports community.</p>
              <ul><li>Created by an independent wallet</li><li>Trades through its own market</li><li>Never presented as club-issued</li></ul>
            </div>
            <div className="identity-link"><span>LINKED TO</span><ArrowRight /></div>
            <div className="identity-card reward-card">
              <span className="identity-number">02</span><div className="identity-icon"><BadgeCheck /></div>
              <p className="section-eyebrow">What holders can earn</p><h2>Verified reward asset</h2>
              <p>An existing Fan Token whose chain-specific mint is checked against an official first-party registry.</p>
              <ul><li>Exact mint shown on every page</li><li>Liquidity and inventory checked separately</li><li>Does not imply a partnership</li></ul>
            </div>
          </div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Protocol" title="One fee stream. Two visible outcomes." copy="Rewards are processed in controlled batches and credited only after fees, swaps, inventory, and holder calculations are finalized." action={<Link href="/how-it-works" className="text-link">Read the full mechanics <ArrowRight /></Link>} />
          <div className="how-flow">
            {[
              { icon: Coins, step: "01", title: "Fees are observed", copy: "Pump creator-fee events are indexed and credited only after Solana finality." },
              { icon: Layers3, step: "02", title: "80 / 20 is reconciled", copy: "The reward and buyback legs are recorded as separate, replay-safe settlement intents." },
              { icon: Trophy, step: "03", title: "Rewards are funded", copy: "The selected Fan Token is acquired or reserved from verified Solana inventory." },
              { icon: Flame, step: "04", title: "SPORT burn is verified", copy: "After SPORT is deployed, buyback output is designed to be destroyed with BurnChecked and verified against mint supply." },
            ].map((item) => <article key={item.step} className="how-step"><span>{item.step}</span><item.icon /><h3>{item.title}</h3><p>{item.copy}</p></article>)}
          </div>
          <div className="formula-strip"><div><small>Holder allocation</small><strong>Funded fan tokens × wallet token-seconds ÷ all eligible token-seconds</strong></div><Link href="/rewards">See the reward methodology <ArrowRight /></Link></div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Reward registry" title="Mint verification is only the first check." copy="SportPad separates official token identity from route availability. A deployed mint can still have shallow liquidity or require pre-funded inventory." action={<Link href="/fan-tokens" className="text-link">Open full registry <ArrowRight /></Link>} />
          <div className="asset-directory">
            <div className="asset-directory-head"><span>Reward asset</span><span>Solana mint</span><span>Execution route</span><span>Status</span></div>
            {fanAssets.slice(0, 5).map((asset) => (
              <div className="asset-row" key={asset.symbol}>
                <div><TokenMark token={asset.symbol} color={asset.color} /><span><strong>{asset.name}</strong><small>{asset.category} · ${asset.symbol}</small></span></div>
                <code>{asset.mint.slice(0, 7)}…{asset.mint.slice(-6)}</code>
                <span>{asset.route}</span>
                <span className={`asset-status status-${asset.status.toLowerCase().replaceAll(" ", "-")}`}>{asset.status}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Matchday" title="A sports-native pulse, not a generic coin feed." copy="Fixtures give communities context without promising that a result will move prices or increase rewards." action={<Link href="/matchday" className="text-link">View matchday hub <ArrowRight /></Link>} />
          <div className="fixture-grid">
            {fixtures.map((fixture) => <article key={`${fixture.home}-${fixture.away}`} className="fixture-card"><div className="fixture-date"><strong>{fixture.date}</strong><span>{fixture.competition}</span></div><div className="fixture-teams"><span>{fixture.home}</span><small>VS</small><span>{fixture.away}</span></div><div className="fixture-link"><span>{fixture.linked}</span><small><Clock3 /> {fixture.countdown}</small></div></article>)}
          </div>
        </section>

        <section className="page-section page-wrap transparency-preview">
          <div className="transparency-copy">
            <p className="section-eyebrow">Proof of rewards</p><h2>Follow every state—not just the happy ending.</h2>
            <p>Submitted is not finalized. Estimated is not claimable. The transparency explorer keeps fee collection, swaps, inventory, epochs, claims, and burns as distinct verifiable stages.</p>
            <div className="proof-list"><span><BarChart3 /> Finality cutoff and reconciliation state</span><span><Trophy /> Reward purchase and vault reservation</span><span><Flame /> Buyback plus verified supply reduction</span><span><ShieldCheck /> Pauses, exceptions, and safe retries</span></div>
            <Button asChild variant="outline" className="mt-7 rounded-full border-white/12 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"><Link href="/transparency">Open transparency explorer <ArrowRight /></Link></Button>
          </div>
          <div className="ledger-card">
            <div className="ledger-head"><span>Recent protocol events</span><DemoBadge /></div>
            {feeEvents.slice(0, 5).map((event) => <div className="ledger-event" key={event.id}><span className={`event-dot event-${event.state.toLowerCase()}`} /><div><strong>{event.kind}</strong><small>{event.launch} · {event.time}</small></div><span>{event.amount}</span><code>{event.state}</code></div>)}
            <div className="ledger-footer"><span>Last reconciled slot</span><strong>361,284,102</strong><span>Indexer status</span><strong className="positive">Healthy</strong></div>
          </div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Learn" title="Understand it before you sign it." copy="Original, plain-language guides explain the assets, accounting, wallets, inventory states, and risks behind the product." action={<Link href="/learn" className="text-link">Open learning hub <ArrowRight /></Link>} />
          <div className="learn-card-grid">
            {[{icon:Goal,title:"Community coin vs Fan Token",copy:"Why the two assets are separate and what verified really means.",href:"/learn#two-assets"},{icon:WalletCards,title:"One-wallet reward flow",copy:"How Solana-native claims avoid an unnecessary MetaMask step.",href:"/learn#networks"},{icon:Layers3,title:"Epochs and token-seconds",copy:"How time-weighted balances become pro-rata funded allocations.",href:"/learn#rewards"},{icon:ShieldCheck,title:"Liquidity and protocol risk",copy:"What happens when a route disappears or inventory runs low.",href:"/learn#risk"}].map((item) => <Link href={item.href} key={item.title} className="learn-card"><item.icon /><h3>{item.title}</h3><p>{item.copy}</p><span>Read guide <ArrowRight /></span></Link>)}
          </div>
        </section>

        <section id="faq" className="page-section page-wrap faq-section">
          <SectionHeading eyebrow="FAQ" title="The important questions, answered plainly." copy="No guaranteed yield, no hidden pairing claims, and no confusion about which asset is official." />
          <div className="faq-grid">{faqItems.slice(0, 6).map((item) => <details key={item.question}><summary>{item.question}<span>+</span></summary><p>{item.answer}</p></details>)}</div>
        </section>

        <section className="final-cta page-wrap">
          <div><p className="section-eyebrow">Build the next supporter economy</p><h2>Pick the narrative. Verify the reward. Show every receipt.</h2><p>Create a private launch draft and review the full routing configuration before anything can touch mainnet.</p></div>
          <div><Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 font-semibold text-[#071008] hover:bg-[#adff7d]"><Link href="/launch">Start a launch draft <ArrowRight /></Link></Button><Link href="/learn" className="text-link justify-center">Read the docs <BookOpen /></Link></div>
        </section>
      </main>
    </SiteChrome>
  );
}
