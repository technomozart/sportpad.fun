import { PageIntro, SafetyNotice } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { LaunchBuilder } from "./launch-builder";

export default function LaunchPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Launch a community token" title="Build the complete reward route before you sign anything." copy="Define the community, choose a verified reward asset, acknowledge the economics and IP rules, then save a private draft for technical review." />
        <SafetyNotice>This private builder does not create a mint, spend SOL, or configure Pump fee sharing. Mainnet launch remains locked.</SafetyNotice>
        <section className="content-section"><LaunchBuilder /></section>
      </main>
    </SiteChrome>
  );
}
