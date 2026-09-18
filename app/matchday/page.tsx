import Link from "next/link";
import { ArrowRight, CalendarDays, Clock3, Goal, Radio, ShieldAlert, Sparkles, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DemoBadge, PageIntro, SectionHeading, TokenMark } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { fixtures, launches } from "@/lib/site-data";

const finished = [
  { home: "Paris", away: "Lens", score: "2–0", reward: "PSG", volume: "$18.4K", funded: "42.8 PSG" },
  { home: "Milan", away: "Bologna", score: "1–1", reward: "ACM", volume: "$9.7K", funded: "18.2 ACM" },
];

export default function MatchdayPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Matchday hub" title="Where community markets meet the sporting calendar." copy="Follow upcoming fixtures, discover related community coins, and inspect reward activity around matchday—without turning results into promises of price or payout.">
          <div className="matchday-live-card"><span><Radio /> Live data preview</span><strong>3</strong><small>supported fixtures this week</small><DemoBadge /></div>
        </PageIntro>

        <section className="matchday-feature">
          <div className="matchday-feature-copy"><span className="competition-pill">LEAGUE · SUN 18:30 UTC</span><p className="section-eyebrow">Featured fixture</p><h2>Arsenal <small>vs</small> Man City</h2><p>Two reward communities meet on matchday. Activity below reflects linked SportPad concepts—not an official team campaign.</p><div className="matchday-token-row"><span><TokenMark token="AFC" color="#ffb84d" /> AFC reward communities <strong>1</strong></span><span><TokenMark token="CITY" color="#66e4ff" /> CITY reward communities <strong>1</strong></span></div><Button asChild className="mt-7 rounded-full bg-[#9cff57] text-[#071008] hover:bg-[#adff7d]"><Link href="/discover">Explore related launches <ArrowRight /></Link></Button></div>
          <div className="matchday-pitch" aria-hidden="true"><div className="pitch-center"><Goal /><span>03D</span><small>11H : 42M</small></div><span className="pitch-dot pitch-dot-one" /><span className="pitch-dot pitch-dot-two" /><span className="pitch-dot pitch-dot-three" /></div>
        </section>

        <section className="page-section">
          <SectionHeading eyebrow="Upcoming" title="Fixture-linked communities." copy="Match context is informational. Rewards remain funded only by qualifying creator fees and completed protocol settlements." />
          <div className="fixture-list">
            {fixtures.map((fixture) => {
              const reward = fixture.linked.split("→")[1]?.trim() ?? "BAR";
              const launch = launches.find((item) => item.rewardSymbol === reward);
              return <article key={`${fixture.home}-${fixture.away}`}><div className="fixture-list-date"><CalendarDays /><span><strong>{fixture.date}</strong><small>{fixture.competition}</small></span></div><div className="fixture-list-teams"><strong>{fixture.home}</strong><span>VS</span><strong>{fixture.away}</strong></div><div className="fixture-list-reward"><span>{fixture.linked}</span><small>{launch ? `${launch.rewardsFunded} ${reward} funded in demo` : "Route researching"}</small></div><div className="fixture-list-time"><Clock3 /><span>{fixture.countdown}</span></div></article>;
            })}
          </div>
        </section>

        <section className="page-section two-column-section">
          <div>
            <SectionHeading eyebrow="Recent match windows" title="Activity with the score stripped of hype." copy="The ledger shows community-market activity and rewards funded during a published time window. A win, draw, or loss does not guarantee token performance." />
            <div className="finished-list">{finished.map((item)=><div key={`${item.home}-${item.away}`}><span><strong>{item.home}</strong><b>{item.score}</b><strong>{item.away}</strong></span><span><small>Linked reward</small><strong>{item.reward}</strong></span><span><small>Community volume</small><strong>{item.volume}</strong></span><span><small>Rewards funded</small><strong>{item.funded}</strong></span></div>)}</div>
          </div>
          <aside className="matchday-rules"><ShieldAlert /><p className="section-eyebrow">Matchday rules</p><h3>Context, not a sportsbook.</h3><ul><li>Scores and fixtures are informational and can be delayed.</li><li>SportPad does not accept bets or predict outcomes.</li><li>Results do not change the 80/20 fee route.</li><li>Any future boost must be separately funded and disclosed.</li><li>No official affiliation is implied by displaying a fixture.</li></ul></aside>
        </section>

        <section className="final-cta compact-cta"><div><p className="section-eyebrow">Build around a moment</p><h2>Create a community coin for the next matchday.</h2><p>Choose a verified reward asset, review the immutable economics, and save a private draft.</p></div><div><Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 text-[#071008] hover:bg-[#adff7d]"><Link href="/launch"><Sparkles /> Start a draft</Link></Button><Link href="/policy#creator-rules" className="text-link">Read creator rules <Trophy /></Link></div></section>
      </main>
    </SiteChrome>
  );
}
