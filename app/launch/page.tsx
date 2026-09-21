import { PageIntro, SafetyNotice } from "@/components/sport-ui";
import { SiteChrome } from "@/components/site-chrome";
import { LaunchBuilder } from "./launch-builder";

export default function LaunchPage() {
  return (
    <SiteChrome>
      <main className="page-wrap inner-page">
        <PageIntro kicker="Create a launch draft" title="Build the complete reward route before you sign anything." copy="Define the community, choose an official Fan Token reward, acknowledge the economics and image rights, then save a private draft for technical review." />
        <SafetyNotice>The four draft steps do not sign or spend SOL. After content approval and a live reward-route check, your wallet separately signs the real Pump coin creation and one-time 80/20 creator-fee lock. SportPad never asks for a private key.</SafetyNotice>
        <section className="content-section"><LaunchBuilder /></section>
      </main>
    </SiteChrome>
  );
}
