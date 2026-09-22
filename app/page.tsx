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
import { readMainnetConfig } from "@/lib/server/mainnet-config";

export default function Home() {
  const bar = fanAssets.find((asset) => asset.symbol === "BAR") ?? fanAssets[0];
  const mainnet = readMainnetConfig();

  return (
    <SiteChrome>
      <main>
        <section className="home-hero page-wrap">
          <div className="home-hero-copy">
            <div className="hero-kicker"><span className="live-pulse" /> Solana sports launches · official Fan Token rewards</div>
            <h1>Launch the culture.<br /><span>Route the rewards.</span></h1>
            <p>Create a community coin on Solana, select an official Fan Token reward, and lock that coin&apos;s creator fees 80% to rewards and 20% to SPORTPAD buyback and burn. SPORTPAD&apos;s own creator fees remain with the project for development.</p>
            <div className="hero-actions">
              <Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 font-semibold text-[#071008] hover:bg-[#adff7d]">
                <Link href="/launch"><Sparkles className="size-4" /> Start a launch draft</Link>
              </Button>
              <Button asChild variant="outline" className="h-12 rounded-full border-white/10 bg-white/[0.035] px-6 text-white hover:bg-white/10 hover:text-white">
                <Link href="/discover">Explore the product <ArrowRight className="size-4" /></Link>
              </Button>
            </div>
            <div className="hero-proof-row">
              <span><BadgeCheck /> {fanAssets.length} official Fan Tokens on Solana</span>
              <span><WalletCards /> One Solana wallet</span>
              <span><ShieldCheck /> Honest deployment states</span>
            </div>
          </div>

          <div className="match-console" aria-label="SportPad mainnet fee configuration">
            <div className="match-console-head"><span><Radio /> Mainnet configuration</span><span className={mainnet.ready ? "route-ready" : "route-research"}>{mainnet.ready ? "Launcher live" : "Treasury setup required"}</span></div>
            <div className="scoreboard">
              <div><small>COMMUNITY TOKEN</small><TokenMark token="YOURS" color="#9cff57" size="lg" /><strong>Your coin</strong><span>Creator name and image</span></div>
              <div className="scoreboard-center"><span>EARNS<br />REWARDS</span><Goal /><small>After funding</small></div>
              <div><small>OFFICIAL FAN TOKEN</small><TokenMark token={bar.symbol} color={bar.color} imagePath={bar.imagePath} size="lg" /><strong>${bar.symbol}</strong><span>Available on Solana</span></div>
            </div>
            <div className="fee-split-visual">
              <div className="split-source"><CircleDollarSign /><span>Community coin creator fees</span><strong>{mainnet.ready ? "Mainnet" : "Awaiting setup"}</strong></div>
              <div className="split-line"><span style={{ width: "80%" }} /><span style={{ width: "20%" }} /></div>
              <div className="split-destinations"><div><Trophy /><span>80% official Fan Token rewards</span><strong>{mainnet.rewardTreasury ? "Treasury set" : "Address required"}</strong></div><div><Flame /><span>20% SPORTPAD buyback + burn</span><strong>{mainnet.buybackTreasury ? "Treasury set" : "Address required"}</strong></div></div>
            </div>
            <p className="match-console-note">Community coins trade against SOL. The selected official Fan Token is purchased from that launch&apos;s 80% fee share, not used as its market pair. SPORTPAD&apos;s own fees are reserved for project development.</p>
          </div>
        </section>

        <section className="protocol-stats page-wrap" aria-label="Current protocol deployment status">
          <div><span>Mainnet launcher</span><strong>{mainnet.ready ? "Enabled" : "Setup required"}</strong><small>{mainnet.ready ? "Wallet-signed Pump launch and 80/20 fee lock" : mainnet.missing.join(", ")}</small></div>
          <div><span>Official Fan Tokens on Solana</span><strong>{fanAssets.length}</strong><small>Exact token addresses registry-listed</small></div>
          <div><span>Reward vaults and claims</span><strong>Not deployed</strong><small>No balances or positions</small></div>
          <div><span>SPORTPAD main token</span><strong>Not deployed</strong><small>No burns have occurred</small></div>
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
              <p>An official Fan Token issued for the named sports organization. Chiliz Chain is its core network, with an official Solana token address published for this omnichain asset.</p>
              <ul><li>Official sports organization Fan Token</li><li>Official Solana token address shown publicly</li><li>Route and vault status checked separately</li></ul>
            </div>
          </div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Community launch protocol" title="One community fee stream. Two visible outcomes." copy="Each community launch locks its own 80/20 Pump fee recipients on mainnet. SPORTPAD's creator fees stay outside this split and fund project development." action={<Link href="/how-it-works" className="text-link">Read the full mechanics <ArrowRight /></Link>} />
          <div className="how-flow">
            {[
              { icon: Coins, step: "01", title: "Fees are finalized", copy: "Eligible creator fee events would be indexed and credited only after Solana finality." },
              { icon: Layers3, step: "02", title: "80 / 20 is reconciled", copy: "Reward and SPORTPAD legs would become separate, replay-safe settlement records." },
              { icon: Trophy, step: "03", title: "Fan Token rewards are funded", copy: "The selected official Fan Token would be acquired or reserved in a deployed Solana vault." },
              { icon: Flame, step: "04", title: "SPORTPAD burn is verified", copy: "The SPORTPAD output would be burned and checked against the main token's supply." },
            ].map((item) => <article key={item.step} className="how-step"><span>{item.step}</span><item.icon /><h3>{item.title}</h3><p>{item.copy}</p></article>)}
          </div>
          <div className="formula-strip"><div><small>Proposed holder allocation</small><strong>Funded Fan Tokens × wallet token-seconds ÷ all eligible token-seconds</strong></div><Link href="/rewards">See the reward methodology <ArrowRight /></Link></div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Official reward registry" title={`${fanAssets.length} official Fan Tokens are published on Solana.`} copy="Fan Tokens are rooted in the Chiliz ecosystem and now use an omnichain model across Chiliz Chain, Solana, and Base. The official image, identity, and Solana token address come from FanTokens and Chiliz sources. Every selected asset is checked for a live Jupiter route before a mainnet launch can proceed." action={<Link href="/fan-tokens" className="text-link">Open all {fanAssets.length} assets <ArrowRight /></Link>} />
          <div className="asset-directory">
            <div className="asset-directory-head"><span>Official Fan Token</span><span>Solana token address</span><span>Reward route</span><span>Vault</span></div>
            {fanAssets.slice(0, 5).map((asset) => (
              <div className="asset-row" key={asset.symbol}>
                <div><TokenMark token={asset.symbol} color={asset.color} imagePath={asset.imagePath} /><span><strong>{asset.name}</strong><small>{asset.category} · ${asset.symbol}</small></span></div>
                <code>{asset.mint.slice(0, 7)}...{asset.mint.slice(-6)}</code>
                <span>{asset.route}</span>
                <span className="asset-status status-registry-listed">{asset.vault}</span>
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
            <p>The transparency explorer separates fee collection, swaps, inventory, epochs, claims, and SPORTPAD burns. It stays empty until mainnet economic execution is enabled.</p>
            <div className="proof-list"><span><BarChart3 /> Finality and reconciliation state</span><span><Trophy /> Reward purchase and vault reservation</span><span><Flame /> SPORTPAD buyback and verified burn</span><span><ShieldCheck /> Pauses, exceptions, and safe retries</span></div>
            <Button asChild variant="outline" className="mt-7 rounded-full border-white/12 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"><Link href="/transparency">Open transparency explorer <ArrowRight /></Link></Button>
          </div>
          <div className="ledger-card"><div className="ledger-head"><span>Protocol events</span><span className={mainnet.ready ? "route-ready" : "route-research"}>{mainnet.ready ? "Launcher enabled" : "Setup required"}</span></div><div className="empty-ledger"><ShieldCheck /><strong>No economic events recorded</strong><p>No reward purchases, claims, or SPORTPAD burns have occurred.</p></div></div>
        </section>

        <section className="page-section page-wrap">
          <SectionHeading eyebrow="Learn" title="Understand it before you sign it." copy="Plain-language guides explain the assets, accounting, wallets, inventory states, and risks behind the planned product." action={<Link href="/learn" className="text-link">Open learning hub <ArrowRight /></Link>} />
          <div className="learn-card-grid">
            {[{icon:Goal,title:"Community coin and Fan Token",copy:"How a launch asset differs from the official reward asset.",href:"/learn#two-assets"},{icon:WalletCards,title:"One-wallet reward flow",copy:"How Solana-native claims can avoid an unnecessary MetaMask step.",href:"/learn#networks"},{icon:Layers3,title:"Epochs and token-seconds",copy:"How time-weighted balances can become funded allocations.",href:"/learn#rewards"},{icon:ShieldCheck,title:"Liquidity and protocol risk",copy:"What the future system must do if a route or inventory is unavailable.",href:"/learn#risk"}].map((item) => <Link href={item.href} key={item.title} className="learn-card"><item.icon /><h3>{item.title}</h3><p>{item.copy}</p><span>Read guide <ArrowRight /></span></Link>)}
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
