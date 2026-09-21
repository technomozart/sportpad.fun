import { PageIntro, SafetyNotice } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { MarketExplorer } from "./market-explorer";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Discover launches" title="Sports community coins with official Fan Token rewards." copy="Verified mainnet launches appear with their mint, reward selection, and immutable creator-fee split. If the public feed is empty, clearly marked product examples explain how a launch works.">
          <div className="page-stat-card"><strong>Public feed</strong><span>Verified launch receipts</span><small>Examples appear only when empty</small></div>
        </PageIntro>
        <SafetyNotice>The named reward assets are official Fan Tokens rooted in the Chiliz ecosystem, with Solana token addresses published in the official registry. Market and reward figures are withheld unless a verifiable source is available.</SafetyNotice>
        <section className="content-section"><MarketExplorer initialQuery={params.q ?? ""} /></section>
      </main>
    </SiteChrome>
  );
}
