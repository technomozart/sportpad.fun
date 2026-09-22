import { notFound } from "next/navigation";

import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { SiteChrome } from "@/components/site-chrome";
import { isOperatorUserId } from "@/lib/server/publication-policy";
import { ModerationConsole } from "./moderation-console";
import { OperationsConsole } from "./operations-console";

export const dynamic = "force-dynamic";

export default async function OperatorPage() {
  const user = await requireChatGPTUser("/operator");
  if (!isOperatorUserId(user.userId)) notFound();
  return (
    <SiteChrome>
      <main className="page-wrap inner-page operator-page">
        <div className="operator-intro">
          <p className="section-eyebrow">Operator controls</p>
          <h1>Protocol operations</h1>
          <p>Inspect infrastructure readiness, run read-only treasury observations, and review stored launch content. Every state change is versioned and written to the audit log.</p>
        </div>
        <OperationsConsole />
        <div className="operator-section-heading"><p className="section-eyebrow">Launch safety</p><h2>Moderation queue</h2></div>
        <ModerationConsole />
      </main>
    </SiteChrome>
  );
}
