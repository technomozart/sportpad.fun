import { DemoBadge, PageIntro, SafetyNotice } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { MarketExplorer } from "./market-explorer";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Discover launches" title="Every community coin, reward route, and market state." copy="Compare independently created sports coins without confusing them for official club assets. Filter by sport, verified reward token, and route availability.">
          <div className="page-stat-card"><DemoBadge /><strong>6</strong><span>indexed launch concepts</span><small>Execution disabled</small></div>
        </PageIntro>
        <SafetyNotice>Community tokens are speculative and unaffiliated. “Verified” applies only to the linked reward mint. All market values on this private build are demo fixtures.</SafetyNotice>
        <section className="content-section"><MarketExplorer initialQuery={params.q ?? ""} /></section>
      </main>
    </SiteChrome>
  );
}
