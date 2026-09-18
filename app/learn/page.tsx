import { SiteLink as Link } from "@/components/site-link";
import { ArrowRight, BadgeCheck, BookOpen, Boxes, ExternalLink, Goal, Landmark, Layers3, ShieldAlert, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { faqItems } from "@/lib/site-data";

const glossary = [
  ["Community token", "An independently created Solana asset launched through SportPad. It is not issued by a club or athlete."],
  ["Verified reward asset", "A chain-specific Fan Token mint matched to a first-party registry. Verification applies to the reward asset only."],
  ["Linked reward", "A relationship where creator fees fund an asset; it is not necessarily a direct trading pair."],
  ["Epoch", "A fixed reward-accounting period with a start, end, formula version, funded amount, and distribution commitment."],
  ["Token-seconds", "Token quantity multiplied by the time held during an epoch; the basis of time-weighted allocation."],
  ["Claimable", "Finalized, funded, reserved for the wallet, and available through the claim program."],
  ["Inventory", "Fan Tokens held by reward vaults for claims or future allocations. Inventory is different from liquidity."],
  ["Price impact", "The change in execution price caused by trade size relative to available market liquidity."],
  ["BurnChecked", "The SPL Token instruction used to permanently reduce SPORT supply while checking mint decimals."],
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
          {[{icon:Goal,title:"Community coin vs Fan Token",copy:"The difference between what creators launch and what holders may receive.",anchor:"two-assets",n:"01"},{icon:WalletCards,title:"Solana, Chiliz, and wallets",copy:"Why one Solana wallet is enough for the standard claim path.",anchor:"networks",n:"02"},{icon:Layers3,title:"How rewards are calculated",copy:"Time-weighted balances, epochs, finality, dust, and exclusions.",anchor:"rewards",n:"03"},{icon:Boxes,title:"Inventory and liquidity",copy:"Why an official mint can still be unavailable for safe execution.",anchor:"inventory",n:"04"},{icon:BadgeCheck,title:"Proof of Rewards",copy:"What should be visible from fee receipt through final claim.",anchor:"proof",n:"05"},{icon:ShieldAlert,title:"Risk and wallet safety",copy:"Volatility, route, bridge, protocol, utility, and signing risks.",anchor:"risk",n:"06"}].map((guide)=><a href={`#${guide.anchor}`} key={guide.anchor}><span>{guide.n}</span><guide.icon /><h2>{guide.title}</h2><p>{guide.copy}</p><b>Read section <ArrowRight /></b></a>)}
        </section>

        <section id="two-assets" className="learn-article">
          <div className="article-index">01</div><div><p className="section-eyebrow">The two-asset model</p><h2>A community coin can reward an official asset without becoming official.</h2><p>Every SportPad market begins with an independently created Solana token. Its creator chooses one supported Fan Token as the reward asset. Qualifying creator fees can then acquire and fund that separate asset for eligible holders.</p><div className="article-callout"><strong>Use “rewards in BAR,” not “paired with BAR.”</strong><p>“Paired” is accurate only when a real TOKEN/BAR liquidity pool exists. SportPad’s initial product uses a reward association, while the community token keeps its normal SOL-based market.</p></div><p>The verified badge belongs to the exact reward mint. It never turns the community launch into an official club product or implies endorsement.</p></div>
        </section>

        <section id="networks" className="learn-article">
          <div className="article-index">02</div><div><p className="section-eyebrow">Wallets and networks</p><h2>Solana for users. Chiliz only when inventory needs it.</h2><p>Chiliz Chain is its own EVM-compatible network—not Ethereum mainnet. Current Fan Tokens can also have official representations on Solana and Base through an omnichain token architecture. Each network still has a different address, native gas token, and local token standard.</p><div className="network-facts"><div><strong>SOLANA</strong><span>Base58 address · SPL Token · SOL gas</span><small>SportPad launches, reward vaults, and standard claims</small></div><div><strong>CHILIZ</strong><span>0x address · CAP-20 · CHZ gas</span><small>Possible source liquidity and inventory replenishment</small></div></div><p>You do not need MetaMask or an EVM address for a normal SportPad claim. If MetaMask is used for Solana, its Solana address is different from its 0x address.</p></div>
        </section>

        <section id="rewards" className="learn-article"><div className="article-index">03</div><div><p className="section-eyebrow">Reward methodology</p><h2>Estimated is not earned. Funded is not yet claimable.</h2><p>Rewards move through explicit lifecycle states: accruing estimate, cutoff, reconciliation, acquisition, funded vault, allocation commitment, claimable, and claimed. Only a claimable balance is final for the wallet.</p><div className="formula-large"><span>YOUR REWARD</span><strong>Epoch Fan Tokens × your eligible points ÷ all eligible points</strong></div><p>Eligible points use a time-weighted balance rather than one end-of-epoch snapshot. Failed, unfinalized, excluded, and system-controlled activity does not count. Integer rounding dust is recorded and carried forward.</p></div></section>

        <section id="inventory" className="learn-article"><div className="article-index">04</div><div><p className="section-eyebrow">Liquidity and inventory</p><h2>Mint deployed does not mean market ready.</h2><p>An official Solana mint can have very little circulating supply or no safe executable route. SportPad checks quote depth, price impact, slippage, inventory coverage, token accounts, and claim readiness independently.</p><div className="state-definitions"><span><b className="healthy" /> <strong>Ready</strong><small>Verified, funded, and claims open</small></span><span><b className="warning" /> <strong>Limited</strong><small>Existing claims reserved; new capacity capped</small></span><span><b className="neutral" /> <strong>Replenishing</strong><small>Inventory moving; claims wait for destination funding</small></span><span><b className="danger" /> <strong>Paused</strong><small>Safety limit or infrastructure problem triggered</small></span></div></div></section>

        <section id="proof" className="learn-article"><div className="article-index">05</div><div><p className="section-eyebrow">Verify, don’t trust</p><h2>Every number needs an authoritative source.</h2><p>Token identity comes from the official registry. Balances and supply come from finalized blockchain state. Executable prices come from live quotes at the intended size. Rewards come from fee, swap, vault, epoch, and claim transactions.</p><div className="source-links"><a href="https://docs.chiliz.com/quick-start/token-contract-addresses" target="_blank" rel="noreferrer">Official token registry <ExternalLink /></a><a href="https://solscan.io" target="_blank" rel="noreferrer">Solana explorer <ExternalLink /></a><Link href="/transparency">SportPad transparency explorer <ArrowRight /></Link></div></div></section>

        <section id="risk" className="learn-article"><div className="article-index">06</div><div><p className="section-eyebrow">Risk disclosure</p><h2>Rewards do not protect a bad trade.</h2><p>Community coins and Fan Tokens are volatile and can lose all value. Quotes can disappear, liquidity can become shallow, swaps can fail, bridges can delay, smart contracts can contain bugs, and third-party utility can change.</p><ul className="risk-list"><li>Never trade solely because rewards are advertised.</li><li>Verify the coin, reward mint, route state, and exact transaction before signing.</li><li>A Solana-held Fan Token may not unlock Socios.com polls, staking, or experiences.</li><li>SportPad will never ask for a seed phrase or private key.</li><li>Transactions are irreversible; Solana and 0x addresses are not interchangeable.</li><li>Rewards are not interest, dividends, equity, APR, or guaranteed income.</li></ul></div></section>

        <section id="faq" className="page-section faq-section">
          <SectionHeading eyebrow="FAQ" title="Questions worth answering before launch." />
          <div className="faq-grid">{faqItems.map((item)=><details key={item.question}><summary>{item.question}<span>+</span></summary><p>{item.answer}</p></details>)}</div>
        </section>

        <section id="glossary" className="page-section">
          <SectionHeading eyebrow="Glossary" title="Shared language for a transparent protocol." />
          <div className="glossary-grid">{glossary.map(([term, definition])=><article key={term}><h3>{term}</h3><p>{definition}</p></article>)}</div>
        </section>

        <section className="final-cta compact-cta"><div><p className="section-eyebrow">Ready to explore?</p><h2>See the ideas applied to a complete launch page.</h2><p>Every card distinguishes the community coin from its verified reward asset.</p></div><div><Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 text-[#071008] hover:bg-[#adff7d]"><Link href="/discover">Explore launches <ArrowRight /></Link></Button><Link href="/how-it-works" className="text-link">Protocol mechanics <Landmark /></Link></div></section>
      </main>
    </SiteChrome>
  );
}
