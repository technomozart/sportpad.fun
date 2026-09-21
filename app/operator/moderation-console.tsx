"use client";

/* eslint-disable @next/next/no-img-element */

import { ExternalLink, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type ModerationItem = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  sport: string;
  website: string | null;
  social: string | null;
  rewardSymbol: string;
  rewardMint: string | null;
  state: string;
  version: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  reasonCode: string | null;
  ownerMessage: string | null;
  creatorWallet: string | null;
  devnetMint: string | null;
  createSignature: string | null;
  feeSignature: string | null;
  rewardWallet: string | null;
  burnWallet: string | null;
  imageUrl: string | null;
};

const reasons = ["rights_risk", "impersonation", "unsafe_link", "prohibited_content", "receipt_mismatch", "other"];

function explorer(value: string, type: "address" | "tx") {
  return `https://explorer.solana.com/${type}/${encodeURIComponent(value)}?cluster=devnet`;
}

export function ModerationConsole() {
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("other");
  const [ownerMessage, setOwnerMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operator/moderation", { cache: "no-store" });
      const body = await response.json() as { items?: ModerationItem[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Moderation queue unavailable.");
      setItems(body.items ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Moderation queue unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  async function decide(item: ModerationItem, action: string) {
    const confirmation = action === "approve_receipt"
      ? `Publish the verified devnet receipt for $${item.symbol}?`
      : action === "suspend"
        ? `Immediately hide the public receipt for $${item.symbol}?`
        : null;
    if (confirmation && !window.confirm(confirmation)) return;
    setBusyId(item.id);
    setError("");
    try {
      const approval = action.startsWith("approve") || action === "restore";
      const response = await fetch(`/api/operator/moderation/${encodeURIComponent(item.id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          expectedVersion: item.version,
          reasonCode: approval ? "approved" : reason,
          ownerMessage: approval ? "" : ownerMessage,
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Decision failed.");
      setOwnerMessage("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Decision failed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="operator-console">
      <div className="operator-toolbar">
        <span><ShieldCheck /> {loading ? "Loading queue" : `${items.length} queue items`}</span>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw /> Refresh</Button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!loading && !items.length ? <div className="operator-empty"><ShieldCheck /><h2>The queue is clear.</h2><p>New content and receipt submissions will appear here.</p></div> : null}
      <div className="operator-grid">
        {items.map((item) => {
          const contentReview = item.state === "content_review";
          const receiptReview = item.state === "receipt_review";
          const published = item.state === "devnet_published";
          const suspended = item.state === "suspended";
          return (
            <article key={item.id} className="operator-card">
              <div className="operator-card-head">
                {item.imageUrl ? <img src={item.imageUrl} alt={`${item.name} submitted token image`} /> : null}
                <span><small>{item.state.replaceAll("_", " ")}</small><strong>{item.name}</strong><code>${item.symbol} · {item.sport}</code></span>
                <b>v{item.version}</b>
              </div>
              <p>{item.description || "No description provided."}</p>
              <dl>
                <div><dt>Reward</dt><dd>${item.rewardSymbol}</dd></div>
                <div><dt>Reward address</dt><dd><code>{item.rewardMint}</code></dd></div>
                <div><dt>Website</dt><dd>{item.website ? <a href={item.website} target="_blank" rel="noopener noreferrer">Open <ExternalLink /></a> : "None"}</dd></div>
                <div><dt>Social</dt><dd>{item.social ? <a href={item.social} target="_blank" rel="noopener noreferrer">Open <ExternalLink /></a> : "None"}</dd></div>
                {item.devnetMint ? <div><dt>Devnet mint</dt><dd><a href={explorer(item.devnetMint, "address")} target="_blank" rel="noopener noreferrer">Inspect <ExternalLink /></a></dd></div> : null}
                {item.createSignature ? <div><dt>Create receipt</dt><dd><a href={explorer(item.createSignature, "tx")} target="_blank" rel="noopener noreferrer">Inspect <ExternalLink /></a></dd></div> : null}
                {item.feeSignature ? <div><dt>Fee receipt</dt><dd><a href={explorer(item.feeSignature, "tx")} target="_blank" rel="noopener noreferrer">Inspect <ExternalLink /></a></dd></div> : null}
                {item.rewardWallet ? <div><dt>80% recipient</dt><dd><code>{item.rewardWallet}</code></dd></div> : null}
                {item.burnWallet ? <div><dt>20% recipient</dt><dd><code>{item.burnWallet}</code></dd></div> : null}
              </dl>
              {contentReview || receiptReview || published ? (
                <div className="operator-reason">
                  <select value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Decision reason">{reasons.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
                  <textarea value={ownerMessage} onChange={(event) => setOwnerMessage(event.target.value.slice(0, 500))} placeholder="Optional creator-facing note" />
                </div>
              ) : null}
              <div className="operator-actions">
                {contentReview ? <Button disabled={busyId === item.id} onClick={() => void decide(item, "approve_content")}><ShieldCheck /> Approve content</Button> : null}
                {contentReview ? <Button disabled={busyId === item.id} variant="outline" onClick={() => void decide(item, "reject_content")}><XCircle /> Reject</Button> : null}
                {receiptReview ? <Button disabled={busyId === item.id} onClick={() => void decide(item, "approve_receipt")}><ShieldCheck /> Publish receipt</Button> : null}
                {receiptReview ? <Button disabled={busyId === item.id} variant="outline" onClick={() => void decide(item, "reject_receipt")}><XCircle /> Reject</Button> : null}
                {published ? <Button disabled={busyId === item.id} variant="outline" onClick={() => void decide(item, "suspend")}><XCircle /> Suspend</Button> : null}
                {suspended ? <Button disabled={busyId === item.id} onClick={() => void decide(item, "restore")}><ShieldCheck /> Restore</Button> : null}
              </div>
              {item.ownerMessage ? <small className="operator-last-note">Last note: {item.ownerMessage}</small> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
