"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { SiteLink as Link } from "@/components/site-link";
import { ExampleBadge, LaunchCard, SectionHeading } from "@/components/sport-ui";
import { exampleLaunches, type Launch } from "@/lib/site-data";

export function LaunchShowcase() {
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
  const examplesOnly = !feedLoading && !feedUnavailable && publicLaunches.length === 0;
  const visibleLaunches = examplesOnly ? exampleLaunches : publicLaunches ?? [];

  return (
    <section className="page-section page-wrap">
      <SectionHeading
        eyebrow={examplesOnly ? "Product examples" : "Verified devnet receipts"}
        title={examplesOnly ? "See how a community launch could select an official reward." : "Verified devnet launch receipts with official Fan Token selections."}
        copy={examplesOnly ? "These examples explain the product. They are not tokens, markets, holders, fees, or funded rewards." : "Creator-submitted, operator-approved Solana devnet receipts appear here with their verified mint and transaction evidence. They are not mainnet launches."}
        action={<Link href="/discover" className="text-link">View all <ArrowRight /></Link>}
      />
      {feedLoading ? <div className="examples-notice"><span>Loading public devnet receipts.</span></div> : null}
      {feedUnavailable ? <div className="examples-notice"><span>The public launch feed is temporarily unavailable. Examples are withheld until the feed can be checked.</span></div> : null}
      {examplesOnly ? <div className="examples-notice"><ExampleBadge /><span>Examples are hidden automatically when the first public launch is published.</span></div> : null}
      <div className="featured-launch-grid">{visibleLaunches.slice(0, 3).map((launch) => <LaunchCard key={launch.slug} launch={launch} />)}</div>
    </section>
  );
}
