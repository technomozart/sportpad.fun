import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BadgeCheck, BarChart3, Flame, Goal, ShieldCheck, Trophy } from "lucide-react";

import { ExampleBadge, LaunchCard, SafetyNotice, SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { SiteLink as Link } from "@/components/site-link";
import { fanAssets, getLaunch, launches } from "@/lib/site-data";
import { getPublicLaunch, getPublicLaunches } from "@/lib/server/public-launches";

export default async function LaunchDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let launch = getLaunch(slug);
  if (launch) {
    let liveLaunchExists = false;
    try {
      liveLaunchExists = (await getPublicLaunches(1)).length > 0;
    } catch (error) {
      console.error("example_visibility_check_failed", error);
      notFound();
    }
    if (liveLaunchExists) notFound();
  } else {
    try {
      launch = await getPublicLaunch(slug);
    } catch (error) {
      console.error("public_launch_detail_get_failed", error);
    }
  }
  if (!launch) notFound();
  const rewardAsset = fanAssets.find((asset) => asset.symbol === launch.rewardSymbol);
  if (!rewardAsset) notFound();
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
            <div className="token-labels"><span>{launch.isExample ? "Product example" : "Public launch"}</span>{launch.isExample ? <ExampleBadge /> : <span className="route-ready">Published</span>}</div>
            <div className="token-title"><TokenMark token={launch.ticker} color={launch.tone} imagePath={launch.imagePath} size="lg" /><div><h1>{launch.name}</h1><p>${launch.ticker} · {launch.sport} · {launch.isExample ? "not launched" : "published record"}</p></div></div>
            <p className="token-description">{launch.description}</p>
            <div className="token-actions"><Link className="inline-flex items-center gap-2 rounded-full bg-[#9cff57] px-5 py-3 text-sm font-semibold text-[#071008]" href="/launch"><Goal /> Build your own draft</Link></div>
          </div>

          <div className="token-reward-card">
            <div className="verified-label"><BadgeCheck /> {launch.isExample ? "Official Fan Token reward example" : "Selected official Fan Token"}</div>
            <div><TokenMark token={rewardAsset.symbol} color={rewardAsset.color} imagePath={rewardAsset.imagePath} size="lg" /><span><strong>{rewardAsset.name}</strong><small>${rewardAsset.symbol} on Solana</small></span></div>
            <p>The official {rewardAsset.symbol} Fan Token is the selected reward asset in this {launch.isExample ? "example" : "published launch record"}. No reward vault or claim system is deployed.</p>
            <dl><div><dt>Official Solana mint</dt><dd><code>{rewardAsset.mint}</code></dd></div><div><dt>Identity</dt><dd>{rewardAsset.status}</dd></div><div><dt>Reward route</dt><dd>{rewardAsset.route}</dd></div><div><dt>Reward vault</dt><dd>{rewardAsset.vault}</dd></div></dl>
          </div>
        </section>

        <SafetyNotice>{launch.isExample ? "This is an example concept only. It has no deployed token, market, price, volume, holders, fees, reward position, or claim." : "This is a published SportPad launch record. No token mint, market activity, fees, reward position, or claim is shown without a verified data source."}</SafetyNotice>

        <section className="page-section">
          <SectionHeading eyebrow={launch.isExample ? "What this example demonstrates" : "Published configuration"} title="A community narrative can choose an official Fan Token reward." copy="The community token and the official Fan Token remain separate assets with separate identities and contracts." />
          <div className="four-checks">
            <article><span>01</span><Goal /><h3>Creator identity</h3><p>The creator supplies a name, ticker, image, links, and optional description for the community token.</p></article>
            <article><span>02</span><BadgeCheck /><h3>Official reward</h3><p>The reward selection points to the exact registry-listed {rewardAsset.symbol} Solana mint.</p></article>
            <article><span>03</span><Trophy /><h3>80% rewards</h3><p>The planned fee configuration assigns 80% to official Fan Token rewards after the reward system is deployed.</p></article>
            <article><span>04</span><Flame /><h3>20% SPORTPAD burn</h3><p>The planned configuration assigns 20% to SPORTPAD buyback + burn after the main token is deployed.</p></article>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Planned fee flow" title="No step is represented as live." copy="This architecture remains disabled until the required contracts, indexing, vaults, quotes, signers, and claims are ready." />
          <div className="token-flow"><div><Goal /><span><small>01</small><strong>${launch.ticker} trades</strong><p>Future community token market</p></span></div><ArrowRight /><div><BarChart3 /><span><small>02</small><strong>Eligible creator fees</strong><p>Finality and reconciliation</p></span></div><ArrowRight /><div className="split-flow"><span><Trophy /><b>80% · {rewardAsset.symbol} rewards</b></span><span><Flame /><b>20% · SPORTPAD buyback + burn</b></span></div></div>
        </section>

        <section className="page-section contract-grid">
          <div><p className="section-eyebrow">Community token</p><h3>${launch.ticker}{launch.isExample ? " example" : ""}</h3><dl><dt>Mint</dt><dd>{launch.isExample ? "Not deployed" : "Not available from this record"}</dd><dt>Creator</dt><dd>{launch.isExample ? "Not assigned" : "Not publicly exposed"}</dd><dt>Market</dt><dd>{launch.isExample ? "Not created" : "No verified source"}</dd><dt>Fees</dt><dd>{launch.isExample ? "No events" : "No verified events"}</dd><dt>Status</dt><dd>{launch.isExample ? "Example only" : "Published SportPad record"}</dd></dl></div>
          <div><p className="section-eyebrow">Official reward asset</p><h3>{rewardAsset.name}</h3><dl><dt>Symbol</dt><dd>{rewardAsset.symbol}</dd><dt>Network</dt><dd>Solana</dd><dt>Verification</dt><dd><BadgeCheck /> Official registry match</dd><dt>Route</dt><dd>{rewardAsset.route}</dd><dt>Vault</dt><dd>{rewardAsset.vault}</dd></dl></div>
          <div className="contract-risk"><ShieldCheck /><h3>Verified identity, disabled execution.</h3><p>The official Fan Token mint is known. SportPad has not enabled acquisition, custody, allocation, or claims for it.</p></div>
        </section>

        {related.length ? <section className="page-section"><SectionHeading eyebrow={launch.isExample ? "More product examples" : "More public launches"} title="Explore other community and reward combinations." /><div className="market-card-grid">{related.map((item) => <LaunchCard key={item.slug} launch={item} compact />)}</div></section> : null}
      </main>
    </SiteChrome>
  );
}
