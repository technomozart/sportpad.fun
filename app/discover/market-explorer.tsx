"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Grid2X2, List, Search, SlidersHorizontal, X } from "lucide-react";

import { LaunchCard, TokenMark } from "@/components/sport-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { launches, compactNumber, formatUsd } from "@/lib/site-data";

const sports = ["All sports", "Football", "Combat", "Motorsport"];
const rewardStates = ["All routes", "Direct route", "Inventory-backed"];

export function MarketExplorer({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [sport, setSport] = useState("All sports");
  const [route, setRoute] = useState("All routes");
  const [sort, setSort] = useState("Trending");
  const [view, setView] = useState<"cards" | "table">("cards");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return launches
      .filter((launch) => !normalized || `${launch.name} ${launch.ticker} ${launch.rewardSymbol} ${launch.narrative}`.toLowerCase().includes(normalized))
      .filter((launch) => sport === "All sports" || launch.sport === sport)
      .filter((launch) => route === "All routes" || (route === "Direct route" ? launch.availability === "routed" : launch.availability === "inventory"))
      .sort((a, b) => {
        if (sort === "Market cap") return b.marketCap - a.marketCap;
        if (sort === "24h volume") return b.volume24h - a.volume24h;
        if (sort === "Most rewards") return b.rewardUsd - a.rewardUsd;
        return b.change24h - a.change24h;
      });
  }, [query, sport, route, sort]);

  const hasFilters = Boolean(query) || sport !== "All sports" || route !== "All routes";
  const clearFilters = () => { setQuery(""); setSport("All sports"); setRoute("All routes"); };

  return (
    <div>
      <div className="market-toolbar">
        <label className="market-search"><Search /><span className="sr-only">Search launches</span><Input aria-label="Search launches" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search coin, ticker, narrative, or reward" /></label>
        <select value={sport} onChange={(event) => setSport(event.target.value)} aria-label="Filter by sport">{sports.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={route} onChange={(event) => setRoute(event.target.value)} aria-label="Filter by reward route">{rewardStates.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort launches">{["Trending", "Market cap", "24h volume", "Most rewards"].map((item) => <option key={item}>{item}</option>)}</select>
        <div className="view-toggle"><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Card view" aria-pressed={view === "cards"}><Grid2X2 /></button><button className={view === "table" ? "active" : ""} onClick={() => setView("table")} aria-label="Table view" aria-pressed={view === "table"}><List /></button></div>
      </div>

      <div className="results-summary"><span><SlidersHorizontal /> {filtered.length} community launches</span>{hasFilters ? <button onClick={clearFilters}><X /> Clear filters</button> : <span>Static demo index · September 2026 fixture</span>}</div>

      {filtered.length === 0 ? (
        <div className="empty-state"><Search /><h2>No launch matches these filters.</h2><p>Try another ticker, reward symbol, or route state.</p><Button onClick={clearFilters} className="rounded-full bg-white text-black hover:bg-white/90">Reset filters</Button></div>
      ) : view === "cards" ? (
        <div className="market-card-grid">{filtered.map((launch) => <LaunchCard key={launch.slug} launch={launch} />)}</div>
      ) : (
        <div className="market-table-wrap">
          <table className="market-table">
            <thead><tr><th>Community token</th><th>Rewarded in</th><th>Route</th><th>Market cap</th><th>24h volume</th><th>24h</th><th>Holders</th><th>Curve</th></tr></thead>
            <tbody>{filtered.map((launch) => <tr key={launch.slug}><td><Link href={`/launches/${launch.slug}`}><TokenMark token={launch.ticker} color={launch.tone} /><span><strong>{launch.name}</strong><small>${launch.ticker} · {launch.age}</small></span></Link></td><td><span className="reward-cell">{launch.rewardSymbol}<small>{launch.rewardsFunded} funded</small></span></td><td><span className={launch.availability === "routed" ? "route-ready" : "route-inventory"}>{launch.availability === "routed" ? "Direct" : "Inventory"}</span></td><td>{formatUsd(launch.marketCap)}</td><td>{formatUsd(launch.volume24h)}</td><td className={launch.change24h >= 0 ? "positive" : "negative"}>{launch.change24h >= 0 ? "+" : ""}{launch.change24h}%</td><td>{compactNumber(launch.holders)}</td><td>{launch.curve}%</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
