import { SiteLink as Link } from "@/components/site-link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpen,
  CircleDollarSign,
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
import { SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { LaunchShowcase } from "@/components/launch-showcase";
import { fanAssets, faqItems } from "@/lib/site-data";
import { readGlobalLaunchReadiness } from "@/lib/server/launch-automation-readiness";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { getExecutionStatus } from "@/lib/server/execution-status";

export const dynamic = "force-dynamic";

export default async function Home() {
  const bar = fanAssets.find((asset) => asset.symbol === "BAR") ?? fanAssets[0];
  const chilizCount = fanAssets.filter((asset) => asset.chain === "chiliz").length;
  const solanaCount = fanAssets.filter((asset) => asset.chain === "solana").length;
  const mainnet = readMainnetConfig();
  const protocol = await getExecutionStatus().catch(() => null);
  const launch = protocol?.launchReadiness ?? await readGlobalLaunchReadiness();

  return (
    <SiteChrome>
      <main>
        <section className="home-hero page-wrap">
          <div className="home-hero-copy">
            <div className="hero-kicker"><span className="live-pulse" /> Solana sports launch drafts · planned Fan Token rewards</div>
            <h1>Launch the culture.<br /><span>Route the rewards.</span></h1>
            <p>Draft a Solana community coin and select an official Fan Token reward. A mainnet launch locks its creator fees 80% to a reward treasury and 20% to a SPORTPAD buyback treasury. Reward purchases require verified execution. The 20% share accumulates until a SPORTPAD mint and buyback route are ready. {launch.ready ? "Eligible mainnet launches are enabled." : "New mainnet launches are currently paused."} SPORTPAD&apos;s own creator fees are reserved for development.</p>
            <div className="hero-actions">
              <Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 font-semibold text-[#071008] hover:bg-[#adff7d]">
                <Link href="/launch"><Sparkles className="size-4" /> Start a launch draft</Link>
              </Button>
              <Button asChild variant="outline" className="h-12 rounded-full border-white/10 bg-white/[0.035] px-6 text-white hover:bg-white/10 hover:text-white">
                <Link href="/discover">Explore the product <ArrowRight className="size-4" /></Link>
              </Button>
            </div>
            <div className="hero-proof-row">
              <span><BadgeCheck /> {chilizCount} Chiliz V2 addresses + {solanaCount} Solana options</span>
              <span><WalletCards /> Solana wallet + 0x wallet for Chiliz claims</span>
              <span><ShieldCheck /> Honest deployment states</span>
            </div>
          </div>

          <div className="match-console" aria-label="SportPad mainnet fee configuration">
            <div className="match-console-head"><span><Radio /> Example mainnet fee configuration</span><span className={launch.ready ? "route-ready" : "route-research"}>{launch.ready ? "Launcher live" : "Launches paused"}</span></div>
            <div className="scoreboard">
              <div><small>COMMUNITY TOKEN</small><TokenMark token="YOURS" color="#9cff57" size="lg" /><strong>Your coin</strong><span>Creator name and image</span></div>
              <div className="scoreboard-center"><span>EARNS<br />REWARDS</span><Goal /><small>After funding</small></div>
              <div><small>EXAMPLE FAN TOKEN</small><TokenMark token={bar.symbol} color={bar.color} imagePath={bar.imagePath} size="lg" /><strong>${bar.symbol}</strong><span>Planned Chiliz claim</span></div>
            </div>
            <div className="fee-split-visual">
              <div className="split-source"><CircleDollarSign /><span>Community coin creator fees</span><strong>{mainnet.ready ? "Recipients set" : "Awaiting setup"}</strong></div>
              <div className="split-line"><span style={{ width: "80%" }} /><span style={{ width: "20%" }} /></div>
              <div className="split-destinations"><div><Trophy /><span>80% official Fan Token rewards</span><strong>{mainnet.rewardTreasury ? "Treasury set" : "Address required"}</strong></div><div><Flame /><span>20% SPORTPAD buyback + burn</span><strong>{mainnet.buybackTreasury ? "Treasury set" : "Address required"}</strong></div></div>
            </div>
            <p className="match-console-note">Community coins trade against SOL; a selected Fan Token is a separate reward, not its market pair. A fee transfer does not itself buy that token. The current Chiliz V2 contracts need a verified purchase and payout route, and automatic SOL-to-CHZ replenishment is not implemented.</p>
          </div>
        </section>

        <section className="protocol-stats page-wrap" aria-label="Current protocol deployment status">
          <div><span>Mainnet launcher</span><strong>{launch.ready ? "Enabled" : "Paused"}</strong><small>{launch.ready ? "Wallet-signed Pump launch and 80/20 fee lock" : launch.missing.join(", ")}</small></div>
          <div><span>Catalogued Fan Token addresses</span><strong>{chilizCount} + {solanaCount}</strong><small>Chiliz V2 routes are unverified; no reward is funded</small></div>
          <div><span>Reward wallet flow</span><strong>Two networks</strong><small>Verified Solana holder wallet and Chiliz claim wallet</small></div>
          <div><span>SPORTPAD main token</span><strong>{protocol?.protocolSettings.sportpadMint ? "Mint recorded" : "Not configured"}</strong><small>{protocol ? `${protocol.counts.sportpadBurns} recorded burns` : "Status unavailable"}</small></div>
        </section>

        <LaunchShowcase />

        <section className="page-section page-wrap">
          <div className="identity-explainer">
            <div className="identity-card community-card">
              <span className="identity-number">01</span><div className="identity-icon"><Sparkles /></div>
              <p className="section-eyebrow">What you launch</p><h2>Community token</h2>
              <p>A Solana coin built around a supporter narrative, matchday moment, athlete meme, or sports community.</p>
              <ul><li>Created from your own wallet</li><li>Uses your uploaded name and image</li><li>Trades against SOL through its Pump market</li></ul>
            </div>
            <div className="identity-link"><span>REWARDED IN</span><ArrowRight /></div>
            <div className="identity-card reward-card">
              <span className="identity-number">02</span><div className="identity-icon"><BadgeCheck /></div>
              <p className="section-eyebrow">What holders can earn</p><h2>Official Fan Token</h2>
              <p>SportPad lists current V2 Chiliz Fan Token contracts and two Solana options. The former Kayen wrapped-token routes refer to legacy contracts, so Chiliz acquisition and payouts remain disabled while current V2 routes are verified.</p>
              <ul><li>Official sports organization Fan Token</li><li>Exact network contract shown publicly</li><li>Route, inventory, and payout checked separately</li></ul>
            </div>
          </div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Proposed community launch protocol" title="One community fee stream. Two intended destinations." copy="A future mainnet community launch would lock its own 80/20 Pump fee recipients. Funding a Fan Token reward or burning SPORTPAD requires additional verified transactions. SPORTPAD's own creator fees stay outside this split and fund project development." action={<Link href="/how-it-works" className="text-link">Read the full mechanics <ArrowRight /></Link>} />
          <div className="how-flow">
            {[
              { icon: Coins, step: "01", title: "Fees are finalized", copy: "Eligible creator fee events are indexed and credited only after Solana finality." },
              { icon: Layers3, step: "02", title: "80 / 20 is reconciled", copy: "Reward and SPORTPAD legs become separate, replay-safe settlement records." },
              { icon: Trophy, step: "03", title: "Fan Token inventory must be funded", copy: "A claim could open only after an audited purchase of the current reward token, inventory reservation, and allocation." },
              { icon: Flame, step: "04", title: "SPORTPAD burn must be verified", copy: "When buybacks are enabled, a burn would need a finalized transaction and a matching supply reduction." },
            ].map((item) => <article key={item.step} className="how-step"><span>{item.step}</span><item.icon /><h3>{item.title}</h3><p>{item.copy}</p></article>)}
          </div>
          <div className="formula-strip"><div><small>Proposed holder allocation</small><strong>Funded Fan Tokens × wallet token-seconds ÷ all eligible token-seconds</strong></div><Link href="/rewards">See the reward methodology <ArrowRight /></Link></div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Official reward assets" title={`${chilizCount} current Chiliz V2 addresses and ${solanaCount} Solana options.`} copy="The Chiliz addresses come from the issuer's 2026 migration registry. Their SportPad purchase and payout routes are not verified. A published address must never be confused with a funded reward or an active claim." action={<Link href="/fan-tokens" className="text-link">Explore reward assets <ArrowRight /></Link>} />
          <div className="asset-directory">
            <div className="asset-directory-head"><span>Official Fan Token</span><span>Token address</span><span>Route status</span><span>Check</span></div>
            {fanAssets.slice(0, 5).map((asset) => (
              <div className="asset-row" key={asset.id}>
                <div><TokenMark token={asset.symbol} color={asset.color} imagePath={asset.imagePath} /><span><strong>{asset.name}</strong><small>{asset.category} · ${asset.symbol}</small></span></div>
                <code>{asset.mint.slice(0, 7)}...{asset.mint.slice(-6)}</code>
                <span>{asset.chain === "chiliz" ? "Chiliz V2 / unverified" : "Solana / Jupiter"}</span>
                <span className="asset-status status-registry-listed">Paused</span>
              </div>
            ))}
          </div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Matchday" title="Sports context will appear when a verified fixture feed is connected." copy="SportPad will not publish made-up games, scores, or countdowns. Matchday remains empty until a real sports data source is integrated." action={<Link href="/matchday" className="text-link">View matchday status <ArrowRight /></Link>} />
          <div className="empty-state"><Goal /><h2>Fixture feed not connected</h2><p>No fixtures or match-linked activity are shown.</p></div>
        </section>

        <section className="page-section page-wrap transparency-preview">
          <div className="transparency-copy">
            <p className="section-eyebrow">Proof of rewards</p><h2>Every real event will need a receipt.</h2>
            <p>The transparency explorer separates fee collection, swaps, inventory, epochs, claims, and SPORTPAD burns. It shows ledger-backed records and identifies paused execution.</p>
            <div className="proof-list"><span><BarChart3 /> Finality and reconciliation state</span><span><Trophy /> Reward purchase and vault reservation</span><span><Flame /> SPORTPAD buyback and verified burn</span><span><ShieldCheck /> Pauses, exceptions, and safe retries</span></div>
            <Button asChild variant="outline" className="mt-7 rounded-full border-white/12 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"><Link href="/transparency">Open transparency explorer <ArrowRight /></Link></Button>
          </div>
          <div className="ledger-card"><div className="ledger-head"><span>Protocol events</span><span className={launch.ready ? "route-ready" : "route-research"}>{launch.ready ? "Launcher enabled" : "Launches paused"}</span></div><div className="empty-ledger"><ShieldCheck /><strong>{protocol ? `${protocol.counts.protocolEvents} ledger events recorded` : "Ledger status unavailable"}</strong><p>{protocol ? `${protocol.counts.confirmedClaims} confirmed claims, ${protocol.counts.sportpadBurns} recorded SPORTPAD burns. Open transparency for the underlying state.` : "No event count is shown until the database can be read."}</p></div></div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Learn" title="Understand it before you sign it." copy="Plain-language guides explain the assets, accounting, wallets, inventory states, and risks behind the planned product." action={<Link href="/learn" className="text-link">Open learning hub <ArrowRight /></Link>} />
          <div className="learn-card-grid">
            {[{icon:Goal,title:"Community coin and Fan Token",copy:"How a launch asset differs from the official reward asset.",href:"/learn#two-assets"},{icon:WalletCards,title:"Two-network reward flow",copy:"How a Solana holder links a Chiliz claim wallet without granting spending access.",href:"/learn#networks"},{icon:Layers3,title:"Epochs and token-seconds",copy:"How time-weighted balances become funded allocations.",href:"/learn#rewards"},{icon:ShieldCheck,title:"Liquidity and protocol risk",copy:"What the system does if a route or inventory is unavailable.",href:"/learn#risk"}].map((item) => <Link href={item.href} key={item.title} className="learn-card"><item.icon /><h3>{item.title}</h3><p>{item.copy}</p><span>Read guide <ArrowRight /></span></Link>)}
          </div>
        </section>

        <section id="faq" className="page-section page-wrap faq-section">
          <SectionHeading eyebrow="FAQ" title="The important questions, answered plainly." copy="Official Fan Token identity, planned fee routing, wallet flow, reward math, and current deployment state." />
          <div className="faq-grid">{faqItems.slice(0, 6).map((item) => <details key={item.question}><summary>{item.question}<span>+</span></summary><p>{item.answer}</p></details>)}</div>
        </section>

        <section className="final-cta page-wrap">
          <div><p className="section-eyebrow">Build the next supporter economy</p><h2>Pick the narrative. Verify the reward. Show every receipt.</h2><p>Create a private launch draft, upload the token image, and review the configuration before anything can touch mainnet.</p></div>
          <div><Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 font-semibold text-[#071008] hover:bg-[#adff7d]"><Link href="/launch">Start a launch draft <ArrowRight /></Link></Button><Link href="/learn" className="text-link justify-center">Read the docs <BookOpen /></Link></div>
        </section>
      </main>
    </SiteChrome>
  );
}
