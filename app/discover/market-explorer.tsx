"use client";

import { SiteLink as Link } from "@/components/site-link";
import { useEffect, useMemo, useState } from "react";
import { Grid2X2, List, Search, SlidersHorizontal, X } from "lucide-react";

import { LaunchCard, TokenMark } from "@/components/sport-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exampleLaunches, fanAssets, type Launch } from "@/lib/site-data";

const sports = ["All sports", "Football", "Combat", "Motorsport", "Basketball"];

export function MarketExplorer({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [sport, setSport] = useState("All sports");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [publicLaunches, setPublicLaunches] = useState<Launch[] | null>(null);
  const [feedUnavailable, setFeedUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public-launches", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Public launch feed unavailable");
        return response.json() as Promise<{ launches: Launch[] }>;
      })
      .then((body) => {
        setPublicLaunches(body.launches);
        setFeedUnavailable(false);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setPublicLaunches([]);
          setFeedUnavailable(true);
        }
      });
    return () => controller.abort();
  }, []);

  const feedLoading = publicLaunches === null;
  const showingExamples = !feedLoading && !feedUnavailable && publicLaunches.length === 0;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const source = showingExamples ? exampleLaunches : publicLaunches ?? [];
    return source
      .filter((launch) => !normalized || `${launch.name} ${launch.ticker} ${launch.rewardSymbol} ${launch.narrative}`.toLowerCase().includes(normalized))
      .filter((launch) => sport === "All sports" || launch.sport === sport);
  }, [publicLaunches, query, showingExamples, sport]);

  const hasFilters = Boolean(query) || sport !== "All sports";
  const clearFilters = () => { setQuery(""); setSport("All sports"); };

  return (
    <div>
      {feedLoading ? <div className="example-data-banner"><strong>Loading public launches.</strong><span>Examples stay hidden until the public feed has been checked.</span></div> : null}
      {feedUnavailable ? <div className="example-data-banner"><strong>Public launch feed unavailable.</strong><span>Examples are withheld because the current public launch state could not be confirmed.</span></div> : null}
      {showingExamples ? <div className="example-data-banner"><strong>Examples only. Nothing below is launched or trading.</strong><span>These concepts contain no market data and are hidden automatically when the first public launch is published.</span></div> : null}
      <div className="market-toolbar">
        <label className="market-search"><Search /><span className="sr-only">Search launches</span><Input aria-label="Search launches" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker, sport, or official Fan Token" /></label>
        <select value={sport} onChange={(event) => setSport(event.target.value)} aria-label="Filter by sport">{sports.map((item) => <option key={item}>{item}</option>)}</select>
        <div className="view-toggle"><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Card view" aria-pressed={view === "cards"}><Grid2X2 /></button><button className={view === "table" ? "active" : ""} onClick={() => setView("table")} aria-label="Table view" aria-pressed={view === "table"}><List /></button></div>
      </div>

      <div className="results-summary"><span><SlidersHorizontal /> {filtered.length} {showingExamples ? "example concepts" : "public launches"}</span>{hasFilters ? <button onClick={clearFilters}><X /> Clear filters</button> : <span>{feedLoading ? "Checking the public feed" : feedUnavailable ? "Feed unavailable" : showingExamples ? "No public launches yet" : "Published public records"}</span>}</div>

      {!feedLoading && !feedUnavailable && filtered.length === 0 ? (
        <div className="empty-state"><Search /><h2>No result matches these filters.</h2><p>Try another ticker, sport, or Fan Token symbol.</p><Button onClick={clearFilters} className="rounded-full bg-white text-black hover:bg-white/90">Reset filters</Button></div>
      ) : !feedLoading && !feedUnavailable && view === "cards" ? (
        <div className="market-card-grid">{filtered.map((launch) => <LaunchCard key={launch.slug} launch={launch} />)}</div>
      ) : !feedLoading && !feedUnavailable ? (
        <div className="market-table-wrap">
          <table className="market-table">
            <thead><tr><th>Community token</th><th>Official Fan Token reward</th><th>Sport</th><th>State</th><th>Description</th></tr></thead>
            <tbody>{filtered.map((launch) => {
              const reward = fanAssets.find((asset) => asset.symbol === launch.rewardSymbol);
              return <tr key={launch.slug}><td><Link href={`/launches/${launch.slug}`}><TokenMark token={launch.ticker} color={launch.tone} imagePath={launch.imagePath} /><span><strong>{launch.name}</strong><small>${launch.ticker} · {launch.isExample ? "example concept" : "public launch"}</small></span></Link></td><td><span className="reward-cell"><TokenMark token={launch.rewardSymbol} color={reward?.color ?? launch.tone} imagePath={reward?.imagePath} size="sm" /><strong>{launch.rewardSymbol}</strong></span></td><td>{launch.sport}</td><td><span className={launch.isExample ? "route-research" : "route-ready"}>{launch.isExample ? "Not live" : "Published"}</span></td><td>{launch.narrative}</td></tr>;
            })}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
