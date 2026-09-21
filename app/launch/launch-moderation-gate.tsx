"use client";

import { Clock3, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { DevnetLaunchPanel } from "./devnet-launch-panel";

type ModerationState = {
  state: string;
  version: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  reasonCode: string | null;
  ownerMessage: string | null;
  publicationMode: "closed" | "operator_only" | "moderated";
};

function reviewBody(response: Response) {
  return response.json() as Promise<{ moderation?: ModerationState; error?: string }>;
}

export function LaunchModerationGate({ draftId, name, symbol }: { draftId: string; name: string; symbol: string }) {
  const [moderation, setModeration] = useState<ModerationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/launch-drafts/${encodeURIComponent(draftId)}/moderation`, { cache: "no-store" });
      const body = await reviewBody(response);
      if (!response.ok || !body.moderation) throw new Error(body.error ?? "Review status unavailable.");
      setModeration(body.moderation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review status unavailable.");
    } finally {
      setBusy(false);
    }
  }, [draftId]);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  async function transition(action: "submit_content_review" | "withdraw_review") {
    if (!moderation) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/launch-drafts/${encodeURIComponent(draftId)}/moderation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedVersion: moderation.version }),
      });
      const body = await reviewBody(response);
      if (!response.ok || !body.moderation) throw new Error(body.error ?? "Review status could not be changed.");
      setModeration(body.moderation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review status could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  if (!moderation) {
    return <section className="launch-review-gate"><Clock3 /><span><strong>{busy ? "Loading review status" : "Review status unavailable"}</strong><small>No image or metadata will be published until this check completes.</small></span>{!busy ? <Button variant="outline" onClick={() => void load()}><RefreshCw /> Retry</Button> : null}{error ? <p className="form-error">{error}</p> : null}</section>;
  }

  if (moderation.state === "suspended") {
    return <section className="launch-review-gate rejected"><XCircle /><span><strong>Public receipt suspended</strong><small>{moderation.ownerMessage || "The public devnet receipt is hidden while an operator reviews it."}</small></span><Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw /> Refresh</Button>{error ? <p className="form-error">{error}</p> : null}</section>;
  }

  if (moderation.state === "content_rejected" || moderation.state === "receipt_rejected") {
    return <section className="launch-review-gate rejected"><XCircle /><span><strong>{moderation.state === "content_rejected" ? "Content review rejected" : "Receipt review rejected"}</strong><small>{moderation.ownerMessage || "This submission cannot proceed. Create a new draft after addressing the review decision."}</small></span>{error ? <p className="form-error">{error}</p> : null}</section>;
  }

  const canLaunch = ["content_approved", "devnet_verified", "receipt_review", "devnet_published"].includes(moderation.state);
  if (canLaunch) {
    return (
      <>
        <section className="launch-review-gate approved"><ShieldCheck /><span><strong>{moderation.state === "content_approved" ? "Content approved for devnet preparation" : "Content review complete"}</strong><small>The stored name, image, links, sport, and reward selection passed the publication gate.</small></span></section>
        <DevnetLaunchPanel draftId={draftId} name={name} symbol={symbol} moderationVersion={moderation.version} onReviewSubmitted={() => void load()} />
      </>
    );
  }

  if (moderation.state === "content_review") {
    return (
      <section className="launch-review-gate pending"><Clock3 /><span><strong>Content review pending</strong><small>Nothing has been uploaded to Pump IPFS. Refresh after an operator decision, or withdraw this submission.</small></span><div><Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw /> Refresh</Button><Button variant="outline" disabled={busy} onClick={() => void transition("withdraw_review")}><XCircle /> Withdraw</Button></div>{error ? <p className="form-error">{error}</p> : null}</section>
    );
  }

  return (
    <section className="launch-review-gate rejected">
      <XCircle />
      <span><strong>{moderation.publicationMode === "closed" ? "Publication review is paused" : "Submit content before devnet"}</strong><small>{moderation.ownerMessage || (moderation.publicationMode === "closed" ? "Drafts remain private while the operator gate is closed." : "An operator must approve the stored content before SportPad publishes it to IPFS or prepares a Pump transaction.")}</small></span>
      {moderation.publicationMode !== "closed" ? <Button disabled={busy} onClick={() => void transition("submit_content_review")}><ShieldCheck /> {busy ? "Submitting" : "Submit for content review"}</Button> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
