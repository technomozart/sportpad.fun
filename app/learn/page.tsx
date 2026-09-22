import { SiteLink as Link } from "@/components/site-link";
import { ArrowRight, BadgeCheck, BookOpen, Boxes, ExternalLink, Goal, Landmark, Layers3, ShieldAlert, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { faqItems } from "@/lib/site-data";

const glossary = [
  ["Community token", "A creator-made Solana asset with its own name, image, mint, and market."],
  ["Verified reward asset", "A chain-specific Fan Token address matched to a first-party registry. Verification applies to the reward asset only."],
  ["Linked reward", "A relationship where creator fees fund an asset; it is not necessarily a direct trading pair."],
  ["Epoch", "A fixed reward-accounting period with a start, end, formula version, funded amount, and distribution commitment."],
  ["Token-seconds", "Token quantity multiplied by the time held during an epoch; the basis of time-weighted allocation."],
  ["Claimable", "Finalized, funded, reserved for the wallet, and available through the claim program."],
  ["Inventory", "Fan Tokens held by reward vaults for claims or future allocations. Inventory is different from liquidity."],
  ["Price impact", "The change in execution price caused by trade size relative to available market liquidity."],
  ["BurnChecked", "The SPL Token instruction planned to permanently reduce SPORTPAD supply while checking mint decimals."],
  ["Associated Token Account", "The Solana account that holds one specific token for a wallet; a first claim may need to create it."],
  ["Finality", "The confirmation threshold after which a blockchain event is eligible for protocol accounting."],
  ["Proof of Rewards", "The public chain of receipts linking fees, splits, swaps, vaults, epochs, claims, buybacks, and burns."],
];

export default function LearnPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Learn SportPad" title="The product makes more sense when the language is precise." copy="Start with the two-asset model, then go deeper into wallets, epochs, liquidity, transparency, and the risks that sit behind every reward claim.">
          <div className="learn-index"><BookOpen /><span><strong>6 guides</strong><small>8 FAQs · 12 glossary terms</small></span></div>
        </PageIntro>

        <section className="content-section guide-grid">
          {[{icon:Goal,title:"Community coin vs Fan Token",copy:"The difference between what creators launch and what holders may receive.",anchor:"two-assets",n:"01"},{icon:WalletCards,title:"Solana, Chiliz, and wallets",copy:"Why one Solana wallet is enough for the standard claim path.",anchor:"networks",n:"02"},{icon:Layers3,title:"How rewards are calculated",copy:"Time-weighted balances, epochs, finality, dust, and exclusions.",anchor:"rewards",n:"03"},{icon:Boxes,title:"Inventory and liquidity",copy:"Why a published token address can still be unavailable for safe execution.",anchor:"inventory",n:"04"},{icon:BadgeCheck,title:"Proof of Rewards",copy:"What should be visible from fee receipt through final claim.",anchor:"proof",n:"05"},{icon:ShieldAlert,title:"Risk and wallet safety",copy:"Volatility, route, bridge, protocol, utility, and signing risks.",anchor:"risk",n:"06"}].map((guide)=><a href={`#${guide.anchor}`} key={guide.anchor}><span>{guide.n}</span><guide.icon /><h2>{guide.title}</h2><p>{guide.copy}</p><b>Read section <ArrowRight /></b></a>)}
        </section>

        <section id="two-assets" className="learn-article">
          <div className="article-index">01</div><div><p className="section-eyebrow">The two-asset model</p><h2>A community coin could reward holders in an official Fan Token.</h2><p>In the planned product, a SportPad market would begin with a creator-made Solana token. Its creator would choose one supported official Fan Token as the reward asset. Qualifying creator fees could then acquire and fund that separate asset for eligible holders after execution is deployed.</p><div className="article-callout"><strong>Use “rewards in BAR,” not “paired with BAR.”</strong><p>“Paired” is accurate only when a real TOKEN/BAR liquidity pool exists. SportPad’s planned initial product would use a reward association, while the community token would keep its normal SOL-based market.</p></div><p>The official badge identifies the exact Fan Token address for the selected chain. The community launch keeps its own creator, name, image, mint, and market.</p></div>
        </section>

        <section id="networks" className="learn-article">
          <div className="article-index">02</div><div><p className="section-eyebrow">Wallets and networks</p><h2>Solana for users. Chiliz only when inventory needs it.</h2><p>Chiliz Chain is its own EVM-compatible network, not Ethereum mainnet. Current Fan Tokens can also have official representations on Solana and Base through an omnichain token architecture. Each network still has a different address, native gas token, and local token standard.</p><div className="network-facts"><div><strong>SOLANA</strong><span>Base58 address · SPL Token · SOL gas</span><small>Mainnet launches use Pump SOL markets; reward vaults and claims are separate deployment stages</small></div><div><strong>CHILIZ</strong><span>0x address · CAP-20 · CHZ gas</span><small>Possible source liquidity and inventory replenishment</small></div></div><p>The planned standard claim path uses a Solana wallet and does not require an EVM address. If MetaMask is used for Solana, its Solana address is different from its 0x address.</p></div>
        </section>

        <section id="rewards" className="learn-article"><div className="article-index">03</div><div><p className="section-eyebrow">Reward methodology</p><h2>Estimated is not earned. Funded is not yet paid.</h2><p>Rewards move through explicit lifecycle states: accruing, cutoff, acquisition, funded vault, allocation commitment, ready for payout, and paid. Only a committed allocation is final for the wallet.</p><div className="formula-large"><span>YOUR REWARD</span><strong>Epoch Fan Tokens × your eligible points ÷ all eligible points</strong></div><p>Eligible points use balances measured across finalized holder snapshots. The launch creator, protocol-controlled accounts, off-curve program owners, and unobserved intervals do not count. Integer rounding dust is recorded rather than invented.</p></div></section>

        <section id="inventory" className="learn-article"><div className="article-index">04</div><div><p className="section-eyebrow">Liquidity and inventory</p><h2>A published token address does not mean market ready.</h2><p>An official Fan Token can have a published Solana address but very little local supply or no safe executable route. Before any reward route is enabled, SportPad would need to check quote depth, price impact, slippage, inventory coverage, token accounts, and claim readiness independently.</p><div className="state-definitions"><span><b className="healthy" /> <strong>Ready</strong><small>Would require verification, funding, and open claims</small></span><span><b className="warning" /> <strong>Limited</strong><small>Would reserve existing claims and cap new capacity</small></span><span><b className="neutral" /> <strong>Replenishing</strong><small>Would wait for destination funding</small></span><span><b className="danger" /> <strong>Paused</strong><small>Would indicate a safety or infrastructure stop</small></span></div></div></section>

        <section id="proof" className="learn-article"><div className="article-index">05</div><div><p className="section-eyebrow">Verify, don’t trust</p><h2>Every number needs an authoritative source.</h2><p>Token identity must come from the official registry. Balances and supply must come from finalized blockchain state. Executable prices must come from live quotes at the intended size. Future rewards must be traceable through fee, swap, vault, epoch, and claim transactions.</p><div className="source-links"><a href="https://docs.chiliz.com/quick-start/token-contract-addresses" target="_blank" rel="noreferrer">Official token registry <ExternalLink /></a><a href="https://solscan.io" target="_blank" rel="noreferrer">Solana explorer <ExternalLink /></a><Link href="/transparency">SportPad transparency explorer <ArrowRight /></Link></div></div></section>

        <section id="risk" className="learn-article"><div className="article-index">06</div><div><p className="section-eyebrow">Risk disclosure</p><h2>Rewards do not protect a bad trade.</h2><p>Community coins and Fan Tokens are volatile and can lose all value. Quotes can disappear, liquidity can become shallow, swaps can fail, bridges can delay, smart contracts can contain bugs, and third-party utility can change.</p><ul className="risk-list"><li>Never trade solely because rewards are advertised.</li><li>Verify the coin, reward token address, route state, and exact transaction before signing.</li><li>A Solana-held Fan Token may not unlock Socios.com polls, staking, or experiences.</li><li>SportPad will never ask for a seed phrase or private key.</li><li>Transactions are irreversible; Solana and 0x addresses are not interchangeable.</li><li>Rewards are not interest, dividends, equity, APR, or guaranteed income.</li></ul></div></section>

        <section id="faq" className="page-section faq-section">
          <SectionHeading eyebrow="FAQ" title="Questions worth answering before launch." />
          <div className="faq-grid">{faqItems.map((item)=><details key={item.question}><summary>{item.question}<span>+</span></summary><p>{item.answer}</p></details>)}</div>
        </section>

        <section id="glossary" className="page-section">
          <SectionHeading eyebrow="Glossary" title="Shared language for a transparent protocol." />
          <div className="glossary-grid">{glossary.map(([term, definition])=><article key={term}><h3>{term}</h3><p>{definition}</p></article>)}</div>
        </section>

        <section className="final-cta compact-cta"><div><p className="section-eyebrow">Ready to explore?</p><h2>See the ideas applied to complete product examples.</h2><p>Every example distinguishes the community coin from its verified reward asset.</p></div><div><Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 text-[#071008] hover:bg-[#adff7d]"><Link href="/discover">Explore examples <ArrowRight /></Link></Button><Link href="/how-it-works" className="text-link">Planned protocol mechanics <Landmark /></Link></div></section>
      </main>
    </SiteChrome>
  );
}
