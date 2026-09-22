import { SiteLink as Link } from "@/components/site-link";
import { ArrowRight, BadgeCheck, Boxes, ExternalLink, Goal, SearchCheck, ShieldAlert, Sparkles, Trophy, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SafetyNotice, SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { fanAssets } from "@/lib/site-data";
import { TokenAddressCell } from "./token-address-cell";

const chilizAssets = fanAssets.filter((asset) => asset.chain === "chiliz");
const solanaAssets = fanAssets.filter((asset) => asset.chain === "solana");

export default function FanTokensPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Official Fan Token routes" title="Choose from 78 live Chiliz markets and two Solana routes." copy="SportPad checks the actual acquisition network instead of treating a published address as proof of liquidity. Most rewards use Kayen on Chiliz Chain. AFC and ARG are also available through live Solana routes.">
          <div className="verification-seal"><BadgeCheck /><span><strong>{chilizAssets.length} + {solanaAssets.length}</strong> routed reward options</span><small>Kayen and Jupiter checked at selection</small></div>
        </PageIntro>
        <SafetyNotice>These are official Fan Tokens issued for the named sports organizations, not new SportPad copies. A Chiliz route pays the original Fan Token to the user&apos;s verified Chiliz wallet after Kayen&apos;s wrapped trading token is unwrapped.</SafetyNotice>

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
          <div className="registry-stats"><div><strong>{chilizAssets.length}</strong><span>live Kayen routes</span></div><div><strong>{solanaAssets.length}</strong><span>live Solana options</span></div><div><strong>88888</strong><span>Chiliz Chain ID</span></div><div><strong>Worker</strong><span>verified wallet claim queue</span></div></div>
          <div className="registry-table-wrap">
            <table className="registry-table"><thead><tr><th>Official Fan Token</th><th>Sport</th><th>Token address</th><th>Network</th><th>Route</th><th>Check</th></tr></thead><tbody>
              {fanAssets.map((asset) => <tr key={asset.id}><td><div className="registry-asset"><TokenMark token={asset.symbol} color={asset.color} imagePath={asset.imagePath} /><span><strong>{asset.name}</strong><small>${asset.symbol} · official Fan Token</small></span></div></td><td>{asset.category}</td><td><TokenAddressCell mint={asset.mint} symbol={asset.symbol} chain={asset.chain} /></td><td><span className="asset-status status-registry-listed">{asset.chain === "chiliz" ? "Chiliz" : "Solana"}</span></td><td>{asset.route}</td><td>At launch</td></tr>)}
            </tbody></table>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Four checks" title="Official does not automatically mean executable." copy="SportPad enables a reward only when identity, route quality, inventory, and claims pass together." />
          <div className="four-checks">
            {[{icon:SearchCheck,title:"Identity",copy:"Exact network and token address match a first-party registry; ticker and image alone never count."},{icon:Waves,title:"Liquidity",copy:"A live quote must stay inside configured price-impact and slippage limits at the intended batch size."},{icon:Boxes,title:"Inventory",copy:"The reward vault must hold enough unreserved supply, with replenishment thresholds and caps."},{icon:ShieldAlert,title:"Payout",copy:"Decimals, token accounts, claim program, finality, and failure recovery must be tested end to end."}].map((item,index)=><article key={item.title}><span>0{index+1}</span><item.icon /><h3>{item.title}</h3><p>{item.copy}</p></article>)}
          </div>
        </section>

        <section className="page-section network-explainer">
          <div><p className="section-eyebrow">Two claim networks</p><h2>The dashboard sends each reward to the network where its route works.</h2><p>Solana rewards go to the verified Solana wallet. Chiliz rewards require a verified 0x address. The dashboard asks MetaMask to add or switch to Chiliz Chain, then the protocol pays the claim gas and unwraps the Kayen inventory into the original Fan Token.</p><Button asChild variant="outline" className="mt-6 rounded-full border-white/10 bg-transparent text-white hover:bg-white/8 hover:text-white"><Link href="/how-it-works">See the full route <ArrowRight /></Link></Button></div>
          <div className="network-compare"><div><span>SOLANA</span><strong>Two routed options</strong><ul><li>Verified Base58 wallet</li><li>SPL Fan Token</li><li>Jupiter acquisition</li><li>Solana receipt</li></ul></div><div><span>CHILIZ CHAIN</span><strong>78 routed markets</strong><ul><li>Verified 0x wallet</li><li>Official Fan Token</li><li>Kayen acquisition</li><li>Sponsored CHZ gas</li></ul></div></div>
        </section>

        <section className="source-panel"><div><BadgeCheck /><span><strong>Chiliz reward source</strong><small>Kayen Fan Token contracts and live market routes</small></span></div><a href="https://kayen-protocol.gitbook.io/documentation/contract/tokens-in-kayen" target="_blank" rel="noreferrer">Open Kayen registry <ExternalLink /></a></section>
        <section className="source-panel"><div><BadgeCheck /><span><strong>Official token background</strong><small>FanTokens.com issuer and ecosystem information</small></span></div><a href="https://www.fantokens.com/" target="_blank" rel="noreferrer">Open FanTokens.com <ExternalLink /></a></section>
      </main>
    </SiteChrome>
  );
}
