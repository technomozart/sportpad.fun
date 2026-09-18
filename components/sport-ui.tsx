import { SiteLink as Link } from "@/components/site-link";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight, BadgeCheck, ShieldCheck } from "lucide-react";

import { fanAssets, type Launch } from "@/lib/site-data";

export function TokenMark({ token, color, imagePath, size = "md" }: { token: string; color: string; imagePath?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`token-mark token-mark-${size}`} style={{ "--token-color": color } as CSSProperties} aria-hidden="true">
      {imagePath ? <Image src={imagePath} alt="" width={64} height={64} /> : <span>{token.slice(0, 3)}</span>}
    </div>
  );
}

export function ExampleBadge() {
  return <span className="demo-badge"><span /> Example, not live</span>;
}

export function SectionHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <p className="section-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {copy ? <p>{copy}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

export function LaunchCard({ launch, compact = false }: { launch: Launch; compact?: boolean }) {
  const reward = fanAssets.find((asset) => asset.symbol === launch.rewardSymbol);
  return (
    <Link href={`/launches/${launch.slug}`} className={`launch-card-v2 group ${compact ? "launch-card-compact" : ""}`}>
      <div className="launch-card-topline">
        <span>{launch.isExample ? "Example concept" : "Public devnet receipt"}</span>
        <span className={launch.isExample ? "route-research" : "route-ready"}>{launch.isExample ? "Not live" : "Verified devnet"}</span>
      </div>
      <div className="launch-card-identity">
        <TokenMark token={launch.ticker} color={launch.tone} imagePath={launch.imagePath} size="lg" />
        <div className="min-w-0 flex-1">
          <h3>{launch.name}</h3>
          <p>${launch.ticker} · {launch.narrative}</p>
        </div>
        <ArrowUpRight className="launch-arrow" />
      </div>
      <p className="launch-example-copy">{launch.description}</p>
      <div className="launch-reward-band reward-under-review">
        <div><BadgeCheck /><span>{launch.isExample ? "Official Fan Token reward example" : "Selected official Fan Token"}</span><strong>{launch.rewardSymbol}</strong></div>
        <TokenMark token={launch.rewardSymbol} color={reward?.color ?? launch.tone} imagePath={reward?.imagePath} />
      </div>
      <div className="launch-card-footer">{launch.isExample ? "No token, market, holders, fees, or rewards exist for this example." : "Verified Solana devnet mint and fee receipts. This is not a mainnet launch, market, reward, or claim."}</div>
    </Link>
  );
}

export function PageIntro({ kicker, title, copy, children }: { kicker: string; title: string; copy: string; children?: ReactNode }) {
  return (
    <section className="page-intro">
      <div>
        <p className="section-eyebrow">{kicker}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {children ? <div className="page-intro-aside">{children}</div> : null}
    </section>
  );
}

export function SafetyNotice({ children }: { children: ReactNode }) {
  return <div className="safety-notice"><ShieldCheck /> <p>{children}</p></div>;
}
