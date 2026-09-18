import { SiteLink as Link } from "@/components/site-link";
import { ArrowRight, CalendarDays, Radio, ShieldAlert, Sparkles, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntro, SectionHeading } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";

export default function MatchdayPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro
          kicker="Matchday hub"
          title="Match context will appear only when a live source is connected."
          copy="SportPad does not currently have a sports fixture provider. No schedules, scores, countdowns, market activity, or reward totals are shown without an authoritative source."
        >
          <div className="matchday-live-card">
            <span><Radio /> Fixture feed</span>
            <strong>Not connected</strong>
            <small>No live sports provider is configured</small>
          </div>
        </PageIntro>

        <section className="matchday-feature">
          <div className="matchday-feature-copy">
            <span className="competition-pill">DATA SOURCE REQUIRED</span>
            <p className="section-eyebrow">Matchday data</p>
            <h2>No live fixture feed is connected.</h2>
            <p>Fixtures will appear here only after SportPad connects a reliable provider and records the source and update time. Community associations will come only from real public launches.</p>
            <Button asChild variant="outline" className="mt-7 rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white">
              <Link href="/transparency">View system status <ArrowRight /></Link>
            </Button>
          </div>
          <div className="matchday-pitch" aria-label="Fixture feed unavailable">
            <div className="pitch-center"><CalendarDays /><span>OFFLINE</span><small>Awaiting provider</small></div>
          </div>
        </section>

        <section className="page-section">
          <SectionHeading
            eyebrow="Upcoming"
            title="No verified fixtures yet."
            copy="SportPad will not publish a fixture, countdown, or linked community until it can be read from a live source."
          />
          <div className="source-panel">
            <div><CalendarDays /><span><strong>No events yet</strong><small>Fixture ingestion is not deployed</small></span></div>
            <span className="asset-status status-researching">Not connected</span>
          </div>
        </section>

        <section className="page-section two-column-section">
          <div>
            <SectionHeading
              eyebrow="Recent match windows"
              title="No sourced match activity yet."
              copy="Scores, community volume, and rewards will stay empty until each value can be tied to a real sports source and real SportPad protocol records."
            />
            <div className="source-panel">
              <div><Radio /><span><strong>No events yet</strong><small>No sourced match-linked reward settlement is available</small></span></div>
              <span className="asset-status status-researching">Not deployed</span>
            </div>
          </div>
          <aside className="matchday-rules">
            <ShieldAlert />
            <p className="section-eyebrow">Matchday rules</p>
            <h3>Context, not a sportsbook.</h3>
            <ul>
              <li>Scores and fixtures must come from an identified live provider.</li>
              <li>SportPad does not accept bets or predict outcomes.</li>
              <li>Results do not change the planned 80 / 20 fee route.</li>
              <li>Any future boost must be separately funded and disclosed.</li>
              <li>Official Fan Token reward identity is shown separately from the fixture source.</li>
            </ul>
          </aside>
        </section>

        <section className="final-cta compact-cta">
          <div>
            <p className="section-eyebrow">Build around a moment</p>
            <h2>Prepare a private community draft.</h2>
            <p>Choose a registry-listed official Fan Token reward asset and review the planned 80% reward and 20% SPORTPAD buyback and burn route.</p>
          </div>
          <div>
            <Button asChild className="h-12 rounded-full bg-[#9cff57] px-6 text-[#071008] hover:bg-[#adff7d]">
              <Link href="/launch"><Sparkles /> Start a draft</Link>
            </Button>
            <Link href="/policy#creator-rules" className="text-link">Read creator rules <Trophy /></Link>
          </div>
        </section>
      </main>
    </SiteChrome>
  );
}
