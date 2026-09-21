import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, BadgeCheck, BarChart3, ExternalLink, Flame, Goal, ShieldCheck, Trophy } from "lucide-react";

import { ExampleBadge, LaunchCard, SafetyNotice, SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { SiteLink as Link } from "@/components/site-link";
import { fanAssets, getLaunch, launches } from "@/lib/site-data";
import { getPublicLaunch, getPublicLaunches } from "@/lib/server/public-launches";

function devnetExplorer(value: string, type: "address" | "tx") {
  return `https://explorer.solana.com/${type}/${encodeURIComponent(value)}?cluster=devnet`;
}

function mainnetExplorer(value: string, type: "address" | "tx") {
  return `https://explorer.solana.com/${type}/${encodeURIComponent(value)}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const launch = getLaunch(slug) ?? await getPublicLaunch(slug).catch(() => undefined);
  if (!launch) return { title: "Launch not found" };
  const canonical = `/launches/${encodeURIComponent(launch.slug)}`;
  const title = `${launch.name} ($${launch.ticker})`;
  const description = launch.isExample
    ? `${launch.name} is a clearly labeled SportPad product example.`
    : launch.mainnet
      ? `${launch.name} is a verified Solana mainnet launch with an official ${launch.rewardSymbol} Fan Token reward selection.`
      : `${launch.name} is a creator-submitted, operator-approved Solana devnet receipt with an official ${launch.rewardSymbol} Fan Token reward selection.`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      title,
      description,
      images: launch.imagePath ? [{ url: launch.imagePath }] : undefined,
    },
    twitter: {
      card: launch.imagePath ? "summary_large_image" : "summary",
      title,
      description,
      images: launch.imagePath ? [launch.imagePath] : undefined,
    },
  };
}

export default async function LaunchDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let launch = getLaunch(slug);
  if (launch) {
    let liveLaunchExists = false;
    try {
      liveLaunchExists = (await getPublicLaunches(1)).length > 0;
    } catch (error) {
      console.error("example_visibility_check_failed", error);
      throw error;
    }
    if (liveLaunchExists) notFound();
  } else {
    try {
      launch = await getPublicLaunch(slug);
    } catch (error) {
      console.error("public_launch_detail_get_failed", error);
      throw error;
    }
  }
  if (!launch) notFound();
  const rewardAsset = fanAssets.find((asset) => asset.symbol === launch.rewardSymbol);
  if (!rewardAsset) notFound();
  const rewardTokenAddress = launch.mainnet?.rewardTokenAddress ?? launch.devnet?.rewardTokenAddress ?? rewardAsset.mint;
  const isMainnet = Boolean(launch.mainnet);
  let related = launches.filter((item) => item.slug !== launch.slug).slice(0, 2);
  if (!launch.isExample) {
    try {
      related = (await getPublicLaunches(3)).filter((item) => item.slug !== launch.slug).slice(0, 2);
    } catch (error) {
      console.error("related_public_launches_get_failed", error);
      related = [];
    }
  }

  return (
    <SiteChrome>
      <main className="page-wrap inner-page token-page">
        <Link href="/discover" className="back-link"><ArrowLeft /> Back to Discover</Link>

        <section className="token-hero">
          <div className="token-hero-main">
            <div className="token-labels"><span>{launch.isExample ? "Product example" : isMainnet ? "Verified mainnet launch" : "Public devnet receipt"}</span>{launch.isExample ? <ExampleBadge /> : <span className="route-ready">{isMainnet ? "LIVE" : "DEVNET ONLY"}</span>}</div>
            <div className="token-title"><TokenMark token={launch.ticker} color={launch.tone} imagePath={launch.imagePath} size="lg" /><div><h1>{launch.name}</h1><p>${launch.ticker} · {launch.sport} · {launch.isExample ? "not launched" : isMainnet ? "Solana mainnet" : "verified Solana devnet"}</p></div></div>
            <p className="token-description">{launch.description}</p>
            <div className="token-actions">
              <Link className="inline-flex items-center gap-2 rounded-full bg-[#9cff57] px-5 py-3 text-sm font-semibold text-[#071008]" href="/launch"><Goal /> Build your own draft</Link>
              {launch.website ? <a href={launch.website} target="_blank" rel="noopener noreferrer">Website <ExternalLink /></a> : null}
              {launch.social ? <a href={launch.social} target="_blank" rel="noopener noreferrer">Social <ExternalLink /></a> : null}
            </div>
          </div>

          <div className="token-reward-card">
            <div className="verified-label"><BadgeCheck /> {launch.isExample ? "Official Fan Token reward example" : "Selected official Fan Token"}</div>
            <div><TokenMark token={rewardAsset.symbol} color={rewardAsset.color} imagePath={rewardAsset.imagePath} size="lg" /><span><strong>{rewardAsset.name}</strong><small>${rewardAsset.symbol} on Solana</small></span></div>
            <p>The official {rewardAsset.symbol} Fan Token is the selected reward asset in this {launch.isExample ? "example" : isMainnet ? "mainnet launch" : "published devnet receipt"}. The selected reward is a separate Solana asset from the community coin.</p>
            <dl><div><dt>Solana token address</dt><dd><code>{rewardTokenAddress}</code></dd></div><div><dt>Identity</dt><dd>{rewardAsset.status}</dd></div><div><dt>Reward route</dt><dd>{isMainnet ? "Jupiter route verified at launch" : rewardAsset.route}</dd></div><div><dt>Reward vault</dt><dd>{isMainnet ? "80% treasury published" : rewardAsset.vault}</dd></div></dl>
          </div>
        </section>

        <SafetyNotice>{launch.isExample ? "This is an example concept only. It has no deployed token, market, price, volume, holders, fees, reward position, or claim." : isMainnet ? "This page proves the Pump coin creation and immutable 80/20 creator-fee split on Solana mainnet. Reward balances and claim epochs appear only after creator fees are collected, swapped, reconciled, and allocated." : "This creator-submitted, operator-approved receipt proves a coin creation and fee configuration on Solana devnet only. It is not a mainnet launch."}</SafetyNotice>

        {launch.mainnet ? (
          <section className="page-section">
            <SectionHeading eyebrow="Verified Solana mainnet evidence" title="Inspect the mint and immutable fee split." copy="SportPad independently matched both finalized mainnet transactions to the approved launch configuration before publishing this page." />
            <div className="devnet-evidence">
              <div><small>Network</small><code>Solana mainnet</code><strong className="route-ready">LIVE</strong></div>
              <div><small>Community mint</small><code>{launch.mainnet.mint}</code><a href={mainnetExplorer(launch.mainnet.mint, "address")} target="_blank" rel="noopener noreferrer">Open mint <ExternalLink /></a></div>
              <div><small>Coin creation · slot {launch.mainnet.createSlot}</small><code>{launch.mainnet.createSignature}</code><a href={mainnetExplorer(launch.mainnet.createSignature, "tx")} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink /></a></div>
              <div><small>80/20 fee lock · slot {launch.mainnet.feeSlot}</small><code>{launch.mainnet.feeSignature}</code><a href={mainnetExplorer(launch.mainnet.feeSignature, "tx")} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink /></a></div>
              <div><small>80% reward treasury</small><code>{launch.mainnet.rewardTreasury}</code><a href={mainnetExplorer(launch.mainnet.rewardTreasury, "address")} target="_blank" rel="noopener noreferrer">Open address <ExternalLink /></a></div>
              <div><small>20% buyback treasury</small><code>{launch.mainnet.buybackTreasury}</code><a href={mainnetExplorer(launch.mainnet.buybackTreasury, "address")} target="_blank" rel="noopener noreferrer">Open address <ExternalLink /></a></div>
              <div><small>Independent verification</small><code>{launch.mainnet.verifiedAt}</code><span>Finalized onchain</span></div>
            </div>
          </section>
        ) : null}

        {launch.devnet ? (
          <section className="page-section">
            <SectionHeading eyebrow="Verified Solana devnet evidence" title="Inspect every public launch receipt." copy="SportPad matched both finalized devnet transactions to the frozen draft before an operator approved this page for publication." />
            <div className="devnet-evidence">
              <div><small>Network</small><code>Solana devnet only</code><strong className="devnet-badge">NOT MAINNET</strong></div>
              <div><small>Community mint</small><code>{launch.devnet.mint}</code><a href={devnetExplorer(launch.devnet.mint, "address")} target="_blank" rel="noopener noreferrer">Open mint <ExternalLink /></a></div>
              <div><small>Coin creation · slot {launch.devnet.createSlot}</small><code>{launch.devnet.createSignature}</code><a href={devnetExplorer(launch.devnet.createSignature, "tx")} target="_blank" rel="noopener noreferrer">View receipt <ExternalLink /></a></div>
              <div><small>80/20 fee lock · slot {launch.devnet.feeSlot}</small><code>{launch.devnet.feeSignature}</code><a href={devnetExplorer(launch.devnet.feeSignature, "tx")} target="_blank" rel="noopener noreferrer">View receipt <ExternalLink /></a></div>
              <div><small>Configured 80% recipient</small><code>{launch.devnet.rewardWallet}</code><a href={devnetExplorer(launch.devnet.rewardWallet, "address")} target="_blank" rel="noopener noreferrer">Open address <ExternalLink /></a></div>
              <div><small>Configured 20% recipient</small><code>{launch.devnet.burnWallet}</code><a href={devnetExplorer(launch.devnet.burnWallet, "address")} target="_blank" rel="noopener noreferrer">Open address <ExternalLink /></a></div>
              <div><small>Publication approval</small><code>{launch.devnet.publishedAt}</code><span>Operator approved</span></div>
            </div>
          </section>
        ) : null}

        <section className="page-section">
          <SectionHeading eyebrow={launch.isExample ? "What this example demonstrates" : isMainnet ? "Verified mainnet configuration" : "Verified devnet configuration"} title="A community narrative can choose an official Fan Token reward." copy="The community token and the official Fan Token remain separate assets with separate identities and contracts." />
          <div className="four-checks">
            <article><span>01</span><Goal /><h3>Creator identity</h3><p>The creator supplies a name, ticker, image, links, and optional description for the community token.</p></article>
            <article><span>02</span><BadgeCheck /><h3>Official reward</h3><p>The reward selection points to the official {rewardAsset.symbol} Fan Token address published for Solana.</p></article>
            <article><span>03</span><Trophy /><h3>80% rewards</h3><p>{isMainnet ? "The immutable Pump fee configuration assigns 80% to the official Fan Token reward treasury." : "The proposed configuration assigns 80% to official Fan Token rewards."}</p></article>
            <article><span>04</span><Flame /><h3>20% SPORTPAD burn</h3><p>{isMainnet ? "The immutable Pump fee configuration assigns 20% to the SPORTPAD buyback treasury." : "The proposed configuration assigns 20% to SPORTPAD buyback and burn."}</p></article>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow={isMainnet ? "Mainnet fee flow" : "Planned fee flow"} title={isMainnet ? "The creator-fee split is live and verifiable." : "No disabled step is represented as live."} copy={isMainnet ? "Pump distributes creator fees 80/20 to the published treasuries. Reward acquisition, allocation, and claims are recorded separately as they settle." : "Execution stays disabled until the required vaults, quotes, signers, and claims are ready."} />
          <div className="token-flow"><div><Goal /><span><small>01</small><strong>${launch.ticker} trades</strong><p>{isMainnet ? "Pump SOL market" : "Future community token market"}</p></span></div><ArrowRight /><div><BarChart3 /><span><small>02</small><strong>Eligible creator fees</strong><p>Finality and reconciliation</p></span></div><ArrowRight /><div className="split-flow"><span><Trophy /><b>80% · {rewardAsset.symbol} rewards</b></span><span><Flame /><b>20% · SPORTPAD buyback + burn</b></span></div></div>
        </section>

        <section className="page-section contract-grid">
          <div><p className="section-eyebrow">Community token</p><h3>${launch.ticker}{launch.isExample ? " example" : ""}</h3><dl><dt>Mint</dt><dd>{launch.isExample ? "Not deployed" : launch.mainnet?.mint ?? launch.devnet?.mint}</dd><dt>Network</dt><dd>{launch.isExample ? "None" : isMainnet ? "Solana mainnet" : "Solana devnet"}</dd><dt>Creator</dt><dd>{launch.isExample ? "Not assigned" : "Visible in the public transaction"}</dd><dt>Market</dt><dd>{launch.isExample ? "Not created" : isMainnet ? "Pump SOL market" : "No verified mainnet market"}</dd><dt>Status</dt><dd>{launch.isExample ? "Example only" : isMainnet ? "Live mainnet launch" : "Verified devnet receipt"}</dd></dl></div>
          <div><p className="section-eyebrow">Official reward asset</p><h3>{rewardAsset.name}</h3><dl><dt>Symbol</dt><dd>{rewardAsset.symbol}</dd><dt>Network</dt><dd>Solana</dd><dt>Verification</dt><dd><BadgeCheck /> Official registry match</dd><dt>Route</dt><dd>{isMainnet ? "Jupiter route verified" : rewardAsset.route}</dd><dt>Vault</dt><dd>{isMainnet ? "80% treasury published" : rewardAsset.vault}</dd></dl></div>
          <div className="contract-risk"><ShieldCheck /><h3>{isMainnet ? "Verified identity and fee routing." : "Verified identity, disabled execution."}</h3><p>{isMainnet ? "The official Fan Token address, live acquisition route, community mint, and 80/20 Pump fee recipients are public. Claims depend on funded and reconciled reward epochs." : "The official Fan Token address on Solana is known. Acquisition, custody, allocation, and claims are not enabled for this receipt."}</p></div>
        </section>

        {related.length ? <section className="page-section"><SectionHeading eyebrow={launch.isExample ? "More product examples" : "More launches"} title="Explore other community and reward combinations." /><div className="market-card-grid">{related.map((item) => <LaunchCard key={item.slug} launch={item} compact />)}</div></section> : null}
      </main>
    </SiteChrome>
  );
}
