import { SiteLink as Link } from "@/components/site-link";
import { ArrowRight, BadgeCheck, Boxes, ExternalLink, Goal, SearchCheck, ShieldAlert, Sparkles, Trophy, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SafetyNotice, SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { fanAssets } from "@/lib/site-data";

const withoutSolana = [
  ["ALPINE", "Alpine F1 Team"], ["BJK", "Besiktas"], ["BFT", "Brazil National Team"],
  ["VATRENI", "Croatia Football Federation"], ["PORTO", "FC Porto"], ["FB", "Fenerbahce"],
  ["KARATE", "Karate Combat"], ["NOV", "Novara Calcio"], ["LAZIO", "S.S. Lazio"],
  ["SANTOS", "Santos FC"], ["VIT", "Team Vitality"], ["UDI", "Udinese Calcio"],
  ["GUILD", "Blockchain Space"], ["chzinu", "ChilizInu"],
] as const;

export default function FanTokensPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Official Fan Token registry" title="Choose an official Fan Token available on Solana." copy={`Fan Tokens are rooted in the Chiliz ecosystem and use an omnichain supply model across Chiliz Chain, Solana, and Base. This snapshot lists the ${fanAssets.length} Fan Tokens with official Solana token addresses in the Chiliz registry. A separate section identifies 14 additional FanTokens.com assets without a published Solana address in that registry.`}>
          <div className="verification-seal"><BadgeCheck /><span><strong>{fanAssets.length}</strong> Chiliz-registry Solana addresses</span><small>Static snapshot reviewed September 18, 2026</small></div>
        </PageIntro>
        <SafetyNotice>These are official Fan Tokens issued for the named sports organizations, not new SportPad copies. SportPad matches each Solana token address against the official Chiliz registry.</SafetyNotice>

        <section className="page-section network-explainer">
          <div><p className="section-eyebrow">Fan Token primer</p><h2>A tradable digital asset built around supporter participation.</h2><p>Fan Tokens are issued for sports organizations and used across the Chiliz and Socios.com ecosystem for experiences such as polls, rewards, games, and community access. The exact utility is set by the issuer and can change; ownership is not club equity, a dividend, or a claim on revenue.</p><div className="source-links"><a href="https://www.fantokens.com/newsroom/fan-tokens-and-club-culture-strengthening-the-bond-between-fans-and-teams" target="_blank" rel="noreferrer">Official explainer <ExternalLink /></a><a href="https://www.socios.com/legal-hub/" target="_blank" rel="noreferrer">Token legal documents <ExternalLink /></a></div></div>
          <div className="network-compare"><div><span>CAN INCLUDE</span><strong>Issuer-defined utility</strong><ul><li>Club or team polls</li><li>Rewards and experiences</li><li>Games and digital access</li><li>Tradable on-chain ownership</li></ul></div><div><span>DOES NOT MEAN</span><strong>Ownership or guaranteed value</strong><ul><li>No club equity by default</li><li>No guaranteed financial return</li><li>No guaranteed liquidity</li><li>No automatic utility on every chain</li></ul></div></div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Ecosystem legacy" title="From a 2019 club token to a multi-chain sports asset class." copy="A short, source-linked history of the infrastructure SportPad is designed to complement, not replace." />
          <div className="process-timeline">
            <article><span className="process-number">2019</span><div className="process-icon"><Goal /></div><div><h2>Juventus launches $JUV</h2><p>FanTokens.com identifies November 28, 2019 as the first Fan Token launch, followed days later by a binding Juventus poll on Socios.com.</p><a className="text-link mt-3" href="https://www.fantokens.com/newsroom/5-years-of-evolution-the-story-of-fan-tokens" target="_blank" rel="noreferrer">Read the official five-year history <ExternalLink /></a></div><span className="process-line" /></article>
            <article><span className="process-number">2021</span><div className="process-icon"><Trophy /></div><div><h2>Major clubs and athletes bring the category global</h2><p>Barcelona, Atlético de Madrid, Paris Saint-Germain, Manchester City, Arsenal, combat-sport properties, esports teams, and others expanded the model across sports communities.</p></div><span className="process-line" /></article>
            <article><span className="process-number">2023</span><div className="process-icon"><Waves /></div><div><h2>Chiliz Chain becomes the core settlement network</h2><p>The EVM-compatible Chiliz Chain launched in May 2023 as dedicated infrastructure for sports and entertainment applications.</p><a className="text-link mt-3" href="https://docs.chiliz.com/learn/about-fan-tokens/2023-migration-of-fan-tokens-to-chiliz-chain" target="_blank" rel="noreferrer">Read the Chiliz migration history <ExternalLink /></a></div><span className="process-line" /></article>
            <article><span className="process-number">2026</span><div className="process-icon"><Sparkles /></div><div><h2>Selected Fan Tokens expand to Solana and Base</h2><p>Chiliz’s omnichain rollout uses LayerZero’s OFT architecture to make selected assets accessible on additional networks while maintaining a unified supply model.</p><a className="text-link mt-3" href="https://www.fantokens.com/newsroom/why-2026-is-the-year-fan-tokens-evolved-and-what-comes-next" target="_blank" rel="noreferrer">Read the official 2026 review <ExternalLink /></a></div></article>
          </div>
          <p className="section-footnote">Source review: September 18, 2026. SportPad summarizes public issuer materials in its own words; linked sources remain authoritative.</p>
        </section>

        <section className="content-section">
          <div className="registry-stats"><div><strong>96</strong><span>assets across both source sets</span></div><div><strong>{fanAssets.length}</strong><span>Chiliz-registry Solana addresses</span></div><div><strong>{withoutSolana.length}</strong><span>FanTokens catalog only</span></div><div><strong>Not deployed</strong><span>SportPad reward execution</span></div></div>
          <div className="registry-table-wrap">
            <table className="registry-table"><thead><tr><th>Official Fan Token</th><th>Sport</th><th>Solana token address</th><th>Identity</th><th>Route</th><th>Vault</th></tr></thead><tbody>
              {fanAssets.map((asset) => <tr key={asset.symbol}><td><div className="registry-asset"><TokenMark token={asset.symbol} color={asset.color} imagePath={asset.imagePath} /><span><strong>{asset.name}</strong><small>${asset.symbol} · official Fan Token</small></span></div></td><td>{asset.category}</td><td><code title={asset.mint}>{asset.mint.slice(0, 8)}...{asset.mint.slice(-7)}</code></td><td><span className="asset-status status-registry-listed">Registry listed</span></td><td>{asset.route}</td><td>{asset.vault}</td></tr>)}
            </tbody></table>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Additional FanTokens catalog" title="14 catalog assets are not in the Chiliz Solana-address registry." copy="These assets appear in the FanTokens.com catalog, but the official Chiliz contract registry does not currently publish a Solana address for them. They cannot be selected for SportPad's planned Solana reward flow unless that registry publishes one." />
          <div className="unsupported-token-grid">{withoutSolana.map(([symbol, name]) => <article key={`${symbol}-${name}`}><strong>{name}</strong><span>${symbol}</span><small>FanTokens.com catalog · no Chiliz-registry Solana address</small></article>)}</div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Four checks" title="Official does not automatically mean executable." copy="SportPad would enable a reward only after identity, route quality, inventory, and claims all pass together." />
          <div className="four-checks">
            {[{icon:SearchCheck,title:"Identity",copy:"Exact network and token address match a first-party registry; ticker and image alone never count."},{icon:Waves,title:"Liquidity",copy:"A live quote must stay inside configured price-impact and slippage limits at the intended batch size."},{icon:Boxes,title:"Inventory",copy:"The reward vault must hold enough unreserved supply, with replenishment thresholds and caps."},{icon:ShieldAlert,title:"Payout",copy:"Decimals, token accounts, claim program, finality, and failure recovery must be tested end to end."}].map((item,index)=><article key={item.title}><span>0{index+1}</span><item.icon /><h3>{item.title}</h3><p>{item.copy}</p></article>)}
          </div>
        </section>

        <section className="page-section network-explainer">
          <div><p className="section-eyebrow">Solana first</p><h2>The planned standard claim path would not need a second wallet.</h2><p>Current official Fan Tokens can exist across Solana, Chiliz Chain, and Base with one unified omnichain supply. SportPad’s planned default product would keep users on Solana; Chiliz or LayerZero activity would belong in background inventory replenishment, not in every claim.</p><Button asChild variant="outline" className="mt-6 rounded-full border-white/10 bg-transparent text-white hover:bg-white/8 hover:text-white"><Link href="/how-it-works">See the planned route <ArrowRight /></Link></Button></div>
          <div className="network-compare"><div><span>SOLANA</span><strong>Planned standard flow</strong><ul><li>Base58 wallet address</li><li>SPL reward token</li><li>SOL network fee</li><li>Future launches and claims</li></ul></div><div><span>CHILIZ CHAIN</span><strong>Possible inventory source</strong><ul><li>0x wallet address</li><li>CAP-20 token</li><li>CHZ network fee</li><li>Optional replenishment</li></ul></div></div>
        </section>

        <section className="source-panel"><div><BadgeCheck /><span><strong>Solana-address verification source</strong><small>Official Chiliz token-contract registry · static snapshot reviewed September 18, 2026</small></span></div><a href="https://docs.chiliz.com/quick-start/token-contract-addresses" target="_blank" rel="noreferrer">Open Chiliz registry <ExternalLink /></a></section>
        <section className="source-panel"><div><BadgeCheck /><span><strong>Additional catalog source</strong><small>FanTokens.com catalog · used only for the 14-item catalog-only section</small></span></div><a href="https://www.fantokens.com/" target="_blank" rel="noreferrer">Open FanTokens.com <ExternalLink /></a></section>
      </main>
    </SiteChrome>
  );
}
