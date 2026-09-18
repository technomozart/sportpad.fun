import Link from "next/link";
import {
  ArrowRight,
  Ban,
  BadgeCheck,
  Clock3,
  ExternalLink,
  FileCheck2,
  Goal,
  KeyRound,
  Landmark,
  Layers3,
  LockKeyhole,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";

import { SiteChrome } from "@/components/site-chrome";
import { PageIntro, SafetyNotice, SectionHeading } from "@/components/sport-ui";
import { Button } from "@/components/ui/button";

const lifecycle = [
  { icon: Sparkles, title: "Private draft", copy: "A creator defines an original community identity, selects an allowlisted reward asset, and acknowledges the proposed economics." },
  { icon: FileCheck2, title: "Policy review", copy: "Names, media, links, claims, rights, and prohibited-content checks must pass before a public launch can be prepared." },
  { icon: Layers3, title: "Technical review", copy: "Mint configuration, Pump fee shares, reward route, exclusions, signers, and monitoring are simulated and verified." },
  { icon: ShieldCheck, title: "Capped canary", copy: "After audits, a limited-value launch tests indexing, settlement, inventory, claims, pauses, and incident response." },
  { icon: BadgeCheck, title: "Public readiness", copy: "Only a reviewed launch with complete disclosures, functioning evidence links, and supported operations can leave the mainnet lock." },
];

export default function PolicyPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro
          kicker="Creator and platform policy"
          title="Support the culture without impersonating the institution."
          copy="SportPad is for independent sports communities. Creators must own their work, describe affiliations honestly, avoid prohibited conduct, and accept that policy and technical review come before any public launch."
        >
          <div className="page-stat-card">
            <ShieldCheck className="text-[#9cff57]" />
            <strong>Private</strong>
            <span>prototype policy status</span>
            <small>Mainnet submissions closed</small>
          </div>
        </PageIntro>

        <SafetyNotice>
          This page is a plain-language prototype policy summary, not final legal terms. Binding terms, privacy disclosures, jurisdiction, entity details, and a staffed contact channel must be published before public mainnet access.
        </SafetyNotice>

        <nav className="content-section grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Policy sections">
          {[
            ["Creator rules", "#creator-rules"],
            ["Prohibited content", "#prohibited"],
            ["Launch lifecycle", "#lifecycle"],
            ["IP and takedowns", "#takedowns"],
            ["Terms summary", "#terms"],
            ["Privacy summary", "#privacy"],
            ["Mainnet readiness", "#readiness"],
            ["Current contact", "#contact"],
          ].map(([label, href], index) => (
            <a key={href} href={href} className="group flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.025] p-4 text-sm text-white/70 transition hover:border-[#9cff57]/30 hover:bg-white/[0.045] hover:text-white">
              <span><b className="mr-3 text-[#9cff57]">0{index + 1}</b>{label}</span><ArrowRight className="size-4 transition group-hover:translate-x-1" />
            </a>
          ))}
        </nav>

        <section id="creator-rules" className="page-section scroll-mt-28">
          <SectionHeading
            eyebrow="Creator rules"
            title="Make something original and describe it precisely."
            copy="Creators are responsible for every name, image, link, statement, and wallet they submit. Approval is never implied merely because a draft can be saved."
          />
          <div className="four-checks">
            <article><span>01</span><Goal /><h3>Independent identity</h3><p>Use an original community brand. Do not copy a club crest, league mark, athlete likeness, sponsor artwork, or confusingly similar trade dress without documented rights.</p></article>
            <article><span>02</span><BadgeCheck /><h3>Honest affiliation</h3><p>Clearly state that the community token is unofficial. A verified reward mint never makes the launch team-issued, sponsored, approved, or endorsed.</p></article>
            <article><span>03</span><Scale /><h3>Accurate claims</h3><p>Do not promise price performance, guaranteed rewards, APR, dividends, ownership, official utility, or a benefit the launch cannot independently substantiate.</p></article>
            <article><span>04</span><KeyRound /><h3>Controlled wallets</h3><p>Creators must use wallets they control, disclose relevant allocations and conflicts, and never request another person’s seed phrase or private key.</p></article>
          </div>
        </section>

        <section id="prohibited" className="page-section scroll-mt-28">
          <SectionHeading
            eyebrow="Prohibited content and conduct"
            title="Some launches do not belong on SportPad."
            copy="A draft can be rejected, paused, delisted, or referred to appropriate providers when its content, funding, operation, or promotion violates these boundaries."
          />
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Impersonation and false endorsement", "Pretending to be a club, athlete, league, issuer, charity, promoter, or verified representative."],
              ["Stolen intellectual property", "Unlicensed crests, photography, video, music, character art, athlete likenesses, domains, or social handles."],
              ["Fraud and market manipulation", "Wash trading, spoofed volume, deceptive wallets, undisclosed paid promotion, coordinated pump-and-dump activity, or false scarcity."],
              ["Illegal or harmful activity", "Sanctions evasion, money laundering, stolen funds, threats, harassment, hateful content, sexual exploitation, malware, or instructions to commit wrongdoing."],
              ["Misleading financial promises", "Guaranteed returns, risk-free language, fixed income, fabricated partnerships, false exchange listings, or claims that rewards protect principal."],
              ["Unsafe fundraising", "Unreviewed presales, custody of customer funds, hidden allocation changes, or routing value outside the disclosed launch configuration."],
            ].map(([title, copy]) => (
              <article key={title} className="flex gap-4 rounded-2xl border border-red-300/10 bg-red-400/[0.025] p-5">
                <Ban className="mt-0.5 size-5 shrink-0 text-red-300" />
                <div><h3 className="text-base font-semibold">{title}</h3><p className="mt-2 text-sm leading-7 text-white/55">{copy}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section id="lifecycle" className="page-section scroll-mt-28">
          <SectionHeading
            eyebrow="Launch lifecycle"
            title="Saving a draft is the beginning—not an approval."
            copy="The current builder creates a private concept record only. Token creation, trading, fee routing, and mainnet settlement remain disabled."
          />
          <div className="process-timeline">
            {lifecycle.map((stage, index) => (
              <article key={stage.title}>
                <span className="process-number">0{index + 1}</span>
                <div className="process-icon"><stage.icon /></div>
                <div><h2>{stage.title}</h2><p>{stage.copy}</p></div>
                {index < lifecycle.length - 1 ? <span className="process-line" /> : null}
              </article>
            ))}
          </div>
        </section>

        <section id="takedowns" className="page-section scroll-mt-28">
          <SectionHeading
            eyebrow="IP reports and takedowns"
            title="Preserve evidence, restrict exposure, and give both sides a fair process."
            copy="A public release needs a staffed, documented intake process. Until that exists, new mainnet submissions stay closed."
          />
          <div className="how-flow">
            {[
              { icon: FileCheck2, title: "Report", copy: "The claimant identifies the protected work, disputed launch, legal basis, relevant URLs, contact details, and a good-faith statement." },
              { icon: LockKeyhole, title: "Preserve", copy: "SportPad records the report, launch configuration, public claims, timestamps, and relevant transaction evidence without exposing private data unnecessarily." },
              { icon: ShieldAlert, title: "Restrict", copy: "Discovery, new launches, or protocol-controlled settlement can be paused where appropriate. A blockchain asset itself may not be technically removable." },
              { icon: Scale, title: "Review", copy: "The creator can provide rights evidence or a counter-notice. Repeat or bad-faith violations can result in permanent platform restrictions." },
            ].map((item, index) => (
              <article key={item.title} className="how-step"><span>0{index + 1}</span><item.icon /><h3>{item.title}</h3><p>{item.copy}</p></article>
            ))}
          </div>
          <div id="contact" className="source-panel scroll-mt-28">
            <div><Clock3 /><span><strong>Policy contact is not yet open</strong><small>A verified support address and response targets must be published before mainnet.</small></span></div>
            <Link href="/transparency">Current system status <ArrowRight /></Link>
          </div>
        </section>

        <section className="page-section grid gap-4 lg:grid-cols-2">
          <article id="terms" className="scroll-mt-28 rounded-3xl border border-white/8 bg-white/[0.025] p-7">
            <Landmark className="size-7 text-[#9cff57]" />
            <p className="section-eyebrow mt-8">Terms summary</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">Use does not remove risk or responsibility.</h2>
            <ul className="mt-6 grid gap-3 text-sm leading-7 text-white/55">
              <li>• Digital assets are volatile, irreversible, and can lose all value.</li>
              <li>• SportPad does not provide investment, legal, tax, or betting advice.</li>
              <li>• Creators remain responsible for rights, disclosures, legality, and their public statements.</li>
              <li>• Quotes, routes, rewards, claims, bridges, RPCs, wallets, and third-party services can fail or pause.</li>
              <li>• Displaying a launch does not constitute endorsement, diligence, or a guarantee of continued availability.</li>
            </ul>
          </article>
          <article id="privacy" className="scroll-mt-28 rounded-3xl border border-white/8 bg-white/[0.025] p-7">
            <WalletCards className="size-7 text-[#9cff57]" />
            <p className="section-eyebrow mt-8">Privacy summary</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">Wallet activity is public; account data should stay minimal.</h2>
            <ul className="mt-6 grid gap-3 text-sm leading-7 text-white/55">
              <li>• Solana addresses, balances, trades, claims, and transaction signatures are public blockchain data.</li>
              <li>• A private draft can contain account identifiers and creator-submitted project information.</li>
              <li>• SportPad should collect only data needed for authentication, security, policy review, and product operation.</li>
              <li>• Private keys and seed phrases must never be submitted, logged, stored, or requested.</li>
              <li>• Final retention, subprocessors, cookies, analytics, deletion rights, and jurisdiction disclosures are pending.</li>
            </ul>
          </article>
        </section>

        <section id="readiness" className="page-section scroll-mt-28">
          <SectionHeading
            eyebrow="Mainnet readiness"
            title="Public access stays locked until policy can be enforced."
            copy="Technical readiness alone is insufficient. A launchpad also needs accountable operations, user-facing disclosures, and a reliable path for urgent reports."
          />
          <div className="asset-directory">
            <div className="asset-directory-head"><span>Control</span><span>Current state</span><span>Required evidence</span><span>Gate</span></div>
            {[
              ["Binding legal terms", "Draft summary only", "Entity, jurisdiction, counsel review", "Blocked"],
              ["Privacy program", "Draft summary only", "Policy, retention, subprocessors, rights", "Blocked"],
              ["IP and abuse intake", "Process designed", "Staffed verified contact and response targets", "Blocked"],
              ["Creator moderation", "Rules designed", "Review tooling, audit log, appeals", "Blocked"],
              ["Protocol security", "Private prototype", "External review and capped canary", "Blocked"],
              ["Public disclosures", "Demo surfaces", "Live addresses, fees, risks, incidents", "Blocked"],
            ].map(([control, state, evidence, gate]) => (
              <div className="asset-row" key={control}>
                <div><ShieldCheck className="size-5 text-[#9cff57]" /><span><strong>{control}</strong><small>Launch requirement</small></span></div>
                <span>{state}</span><span>{evidence}</span><span className="asset-status status-researching">{gate}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="page-section rounded-3xl border border-amber-300/15 bg-amber-300/[0.035] p-7">
          <div className="flex items-start gap-4">
            <ShieldAlert className="mt-1 size-7 shrink-0 text-amber-200" />
            <div><p className="section-eyebrow text-amber-200!">Important limitation</p><h2 className="mt-2 text-2xl font-semibold">A platform can restrict its own interface and services; it cannot promise to erase an on-chain token.</h2><p className="mt-3 max-w-4xl text-sm leading-7 text-white/55">Takedown actions can remove discovery, disable protocol-controlled routes, preserve evidence, and restrict accounts. Independent blockchain transactions or third-party markets may remain outside SportPad’s control.</p></div>
          </div>
        </section>

        <section className="final-cta compact-cta">
          <div>
            <p className="section-eyebrow">Build within the boundaries</p>
            <h2>Start with a private draft and honest disclosures.</h2>
            <p>No mint is created and no transaction is signed from the current builder.</p>
          </div>
          <div>
            <Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 text-[#071008] hover:bg-[#adff7d]">
              <Link href="/launch"><Sparkles /> Open launch builder</Link>
            </Button>
            <a href="https://docs.chiliz.com/quick-start/token-contract-addresses" target="_blank" rel="noreferrer" className="text-link">Reward registry source <ExternalLink /></a>
          </div>
        </section>
      </main>
    </SiteChrome>
  );
}
