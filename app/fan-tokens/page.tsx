import { SiteLink as Link } from "@/components/site-link";
import { ArrowRight, BadgeCheck, Boxes, ExternalLink, Goal, SearchCheck, ShieldAlert, Sparkles, Trophy, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SafetyNotice, SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { fanAssets, launches } from "@/lib/site-data";

export default function FanTokensPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Verified reward registry" title="Know the exact asset before it becomes a reward." copy="SportPad verifies chain-specific Fan Token mints from first-party sources, then evaluates liquidity, inventory, and payout readiness as separate operational checks.">
          <div className="verification-seal"><BadgeCheck /><span><strong>5</strong> verified Solana mints</span><small>Registry review · demo environment</small></div>
        </PageIntro>
        <SafetyNotice>Verified mint means the address matches an official registry. It does not mean SportPad or any community launch has a commercial partnership with the team or issuer.</SafetyNotice>

        <section className="page-section network-explainer">
          <div><p className="section-eyebrow">Fan Token primer</p><h2>A tradable digital asset built around supporter participation.</h2><p>Fan Tokens are issued for sports organizations and used across the Chiliz and Socios.com ecosystem for experiences such as polls, rewards, games, and community access. The exact utility is set by the issuer and can change; ownership is not club equity, a dividend, or a claim on revenue.</p><div className="source-links"><a href="https://www.fantokens.com/newsroom/fan-tokens-and-club-culture-strengthening-the-bond-between-fans-and-teams" target="_blank" rel="noreferrer">Official explainer <ExternalLink /></a><a href="https://www.socios.com/legal-hub/" target="_blank" rel="noreferrer">Token legal documents <ExternalLink /></a></div></div>
          <div className="network-compare"><div><span>CAN INCLUDE</span><strong>Issuer-defined utility</strong><ul><li>Club or team polls</li><li>Rewards and experiences</li><li>Games and digital access</li><li>Tradable on-chain ownership</li></ul></div><div><span>DOES NOT MEAN</span><strong>Ownership or guaranteed value</strong><ul><li>No club equity by default</li><li>No guaranteed financial return</li><li>No guaranteed liquidity</li><li>No automatic utility on every chain</li></ul></div></div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Ecosystem legacy" title="From a 2019 club token to a multi-chain sports asset class." copy="A short, source-linked history of the infrastructure SportPad is designed to complement—not replace." />
          <div className="process-timeline">
            <article><span className="process-number">2019</span><div className="process-icon"><Goal /></div><div><h2>Juventus launches $JUV</h2><p>FanTokens.com identifies November 28, 2019 as the first Fan Token launch, followed days later by a binding Juventus poll on Socios.com.</p><a className="text-link mt-3" href="https://www.fantokens.com/newsroom/5-years-of-evolution-the-story-of-fan-tokens" target="_blank" rel="noreferrer">Read the official five-year history <ExternalLink /></a></div><span className="process-line" /></article>
            <article><span className="process-number">2021</span><div className="process-icon"><Trophy /></div><div><h2>Major clubs and athletes bring the category global</h2><p>Barcelona, Atlético de Madrid, Paris Saint-Germain, Manchester City, Arsenal, combat-sport properties, esports teams, and others expanded the model across sports communities.</p></div><span className="process-line" /></article>
            <article><span className="process-number">2023</span><div className="process-icon"><Waves /></div><div><h2>Chiliz Chain becomes the core settlement network</h2><p>The EVM-compatible Chiliz Chain launched in May 2023 as dedicated infrastructure for sports and entertainment applications.</p><a className="text-link mt-3" href="https://docs.chiliz.com/learn/about-fan-tokens/2023-migration-of-fan-tokens-to-chiliz-chain" target="_blank" rel="noreferrer">Read the Chiliz migration history <ExternalLink /></a></div><span className="process-line" /></article>
            <article><span className="process-number">2026</span><div className="process-icon"><Sparkles /></div><div><h2>Selected Fan Tokens expand to Solana and Base</h2><p>Chiliz’s omnichain rollout uses LayerZero’s OFT architecture to make selected assets accessible on additional networks while maintaining a unified supply model.</p><a className="text-link mt-3" href="https://www.fantokens.com/newsroom/why-2026-is-the-year-fan-tokens-evolved-and-what-comes-next" target="_blank" rel="noreferrer">Read the official 2026 review <ExternalLink /></a></div></article>
          </div>
          <p className="section-footnote">Source review: September 18, 2026. SportPad summarizes public issuer materials in its own words; linked sources remain authoritative.</p>
        </section>

        <section className="content-section">
          <div className="registry-stats"><div><strong>{fanAssets.length}</strong><span>assets tracked</span></div><div><strong>{fanAssets.filter((item) => item.status === "Route available").length}</strong><span>routes available</span></div><div><strong>{fanAssets.filter((item) => item.status === "Inventory required").length}</strong><span>inventory-backed</span></div><div><strong>{launches.length}</strong><span>linked concepts</span></div></div>
          <div className="registry-table-wrap">
            <table className="registry-table"><thead><tr><th>Official reward asset</th><th>Sport</th><th>Solana mint</th><th>Route policy</th><th>Status</th><th>Linked coins</th></tr></thead><tbody>
              {fanAssets.map((asset) => {
                const linked = launches.filter((launch) => launch.rewardSymbol === asset.symbol).length;
                return <tr key={asset.symbol}><td><div className="registry-asset"><TokenMark token={asset.symbol} color={asset.color} /><span><strong>{asset.name}</strong><small>${asset.symbol} · reward asset</small></span></div></td><td>{asset.category}</td><td><code title={asset.mint}>{asset.mint.length > 24 ? `${asset.mint.slice(0, 8)}…${asset.mint.slice(-7)}` : asset.mint}</code></td><td>{asset.route}</td><td><span className={`asset-status status-${asset.status.toLowerCase().replaceAll(" ", "-")}`}>{asset.status}</span></td><td>{linked}</td></tr>;
              })}
            </tbody></table>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Four checks" title="Official does not automatically mean executable." copy="A reward is enabled only when identity, route quality, inventory, and claims all pass together." />
          <div className="four-checks">
            {[{icon:SearchCheck,title:"Identity",copy:"Exact chain and mint match a first-party registry; ticker and artwork alone never count."},{icon:Waves,title:"Liquidity",copy:"A live quote must stay inside configured price-impact and slippage limits at the intended batch size."},{icon:Boxes,title:"Inventory",copy:"The reward vault must hold enough unreserved supply, with replenishment thresholds and caps."},{icon:ShieldAlert,title:"Payout",copy:"Decimals, token accounts, claim program, finality, and failure recovery must be tested end to end."}].map((item,index)=><article key={item.title}><span>0{index+1}</span><item.icon /><h3>{item.title}</h3><p>{item.copy}</p></article>)}
          </div>
        </section>

        <section className="page-section network-explainer">
          <div><p className="section-eyebrow">Solana first</p><h2>No second wallet for the standard claim path.</h2><p>Current official Fan Tokens can have representations on Solana, Chiliz Chain, and Base. SportPad’s default product keeps users on Solana; Chiliz or LayerZero activity belongs in background inventory replenishment, not in every claim.</p><Button asChild variant="outline" className="mt-6 rounded-full border-white/10 bg-transparent text-white hover:bg-white/8 hover:text-white"><Link href="/how-it-works">See the complete route <ArrowRight /></Link></Button></div>
          <div className="network-compare"><div><span>SOLANA</span><strong>Standard user flow</strong><ul><li>Base58 wallet address</li><li>SPL reward token</li><li>SOL network fee</li><li>Launches and claims</li></ul></div><div><span>CHILIZ CHAIN</span><strong>Inventory source</strong><ul><li>0x wallet address</li><li>CAP-20 token</li><li>CHZ network fee</li><li>Optional replenishment</li></ul></div></div>
        </section>

        <section className="source-panel"><div><BadgeCheck /><span><strong>Primary verification source</strong><small>Official Chiliz token-contract registry · reviewed September 18, 2026</small></span></div><a href="https://docs.chiliz.com/quick-start/token-contract-addresses" target="_blank" rel="noreferrer">Open registry <ExternalLink /></a></section>
      </main>
    </SiteChrome>
  );
}
