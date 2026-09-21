import { notFound } from "next/navigation";

import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { SiteChrome } from "@/components/site-chrome";
import { isOperatorUserId } from "@/lib/server/publication-policy";
import { ModerationConsole } from "./moderation-console";

export const dynamic = "force-dynamic";

export default async function OperatorPage() {
  const user = await requireChatGPTUser("/operator");
  if (!isOperatorUserId(user.userId)) notFound();
  return (
    <SiteChrome>
      <main className="page-wrap inner-page operator-page">
        <div className="operator-intro">
          <p className="section-eyebrow">Operator controls</p>
          <h1>Moderation queue</h1>
          <p>Review stored content before IPFS preparation, then verify the finalized devnet receipts before public discovery. Every state change is versioned and written to the audit log.</p>
        </div>
        <ModerationConsole />
      </main>
    </SiteChrome>
  );
}
