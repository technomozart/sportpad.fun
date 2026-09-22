"use client";

import { Flame, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SportpadActivation() {
  const [mint, setMint] = useState("");
  const [savedMint, setSavedMint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/operator/protocol-settings", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("unavailable")))
      .then((body: { sportpadMint?: string | null }) => { setSavedMint(body.sportpadMint ?? null); setMint(body.sportpadMint ?? ""); })
      .catch(() => setNotice("SPORTPAD mint setting is unavailable."));
  }, []);
  async function save() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/operator/protocol-settings", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sportpadMint: mint.trim() }),
      });
      const body = await response.json() as { sportpadMint?: string; error?: string };
      if (!response.ok || !body.sportpadMint) throw new Error(body.error ?? "Mint could not be activated.");
      setSavedMint(body.sportpadMint); setMint(body.sportpadMint); setNotice("SPORTPAD mint activated. New community buyback jobs will use this address without a redeploy.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Mint could not be activated."); }
    finally { setBusy(false); }
  }
  return <section className="operator-console">
    <div className="operator-console-head"><span><Flame /></span><div><p className="section-eyebrow">Hot activation</p><h2>SPORTPAD mint</h2><p>Paste the main token CA here after launch. The automatic 20% buyback and burn queue reads this database setting immediately.</p></div></div>
    <div className="operator-setting-row"><Input value={mint} onChange={(event) => setMint(event.target.value)} placeholder="Solana mint address" /><Button onClick={() => void save()} disabled={busy || mint.trim() === savedMint}><Save /> {busy ? "Activating" : "Activate mint"}</Button></div>
    {notice ? <p className="operator-note" role="status">{notice}</p> : null}
  </section>;
}
