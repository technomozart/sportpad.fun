import { PageIntro, SafetyNotice } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { MarketExplorer } from "./market-explorer";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Discover launches" title="Sports community coins with official Fan Token rewards." copy="Published SportPad records appear here without invented market figures. If the public feed is confirmed empty, clearly marked product examples explain how a launch could work.">
          <div className="page-stat-card"><strong>Public feed</strong><span>Published records only</span><small>Examples appear only when empty</small></div>
        </PageIntro>
        <SafetyNotice>The named reward assets are official Fan Tokens with registry-listed Solana mints. Market and reward figures are withheld unless a verifiable source is available.</SafetyNotice>
        <section className="content-section"><MarketExplorer initialQuery={params.q ?? ""} /></section>
      </main>
    </SiteChrome>
  );
}
