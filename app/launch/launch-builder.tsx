"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, CheckCircle2, Flame, Goal, ImagePlus, Info, LockKeyhole, ShieldCheck, Sparkles, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TokenMark } from "@/components/sport-ui";
import { fanAssets } from "@/lib/site-data";

const steps = ["Community token", "Reward asset", "Economics", "Review"];

export function LaunchBuilder() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState("Football");
  const [website, setWebsite] = useState("");
  const [social, setSocial] = useState("");
  const [reward, setReward] = useState("PSG");
  const [terms, setTerms] = useState({ rights: false, unofficial: false, economics: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [rewardNotice, setRewardNotice] = useState("");
  const selected = useMemo(() => fanAssets.find((asset) => asset.symbol === reward) ?? fanAssets[0], [reward]);
  const canContinue = step === 0 ? name.trim().length >= 2 && symbol.length >= 2 && description.trim().length >= 20 : step === 1 ? selected.status !== "Researching" : step === 2 ? Object.values(terms).every(Boolean) : true;

  function nextStep() {
    setValidationMessage("");
    if (canContinue) {
      setStep((value) => value + 1);
      return;
    }
    if (step === 0) setValidationMessage("Add a name, a 2–10 character ticker, and a description of at least 20 characters.");
    if (step === 1) setValidationMessage("Choose a reward asset whose Solana mint and route state have been verified.");
    if (step === 2) setValidationMessage("Confirm all three creator attestations before continuing.");
  }

  function resetDraft() {
    setStep(0);
    setName("");
    setSymbol("");
    setDescription("");
    setSport("Football");
    setWebsite("");
    setSocial("");
    setReward("PSG");
    setTerms({ rights: false, unofficial: false, economics: false });
    setSaving(false);
    setSaved(false);
    setError("");
    setValidationMessage("");
    setRewardNotice("");
  }

  async function saveDraft() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/launch-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, symbol, description, sport, website, social, rewardSymbol: reward, attestations: terms }) });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Draft could not be saved.");
      setSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Draft could not be saved."); }
    finally { setSaving(false); }
  }

  if (saved) return <div className="launch-success"><div className="success-mark"><CheckCircle2 /></div><p className="section-eyebrow">Private draft saved</p><h2>${symbol} is ready for technical review.</h2><p>No token was created and no transaction was submitted. Mainnet stays locked until the fee-share configuration, reward route, contracts, compliance, and signer policies pass review.</p><div className="success-summary"><span><strong>{name}</strong><small>Community token</small></span><span><strong>{selected.symbol}</strong><small>Verified reward asset</small></span><span><strong>80 / 20</strong><small>Proposed routing</small></span><span><strong>Draft only</strong><small>Execution status</small></span></div><Button onClick={resetDraft} variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white">Create another draft</Button></div>;

  return (
    <div className="launch-builder">
      <aside className="launch-steps"><div><p className="section-eyebrow">Launch builder</p><h2>Build a community token.</h2><p>Nothing is signed from this private workflow.</p></div><ol>{steps.map((label,index)=><li key={label} className={index === step ? "active" : index < step ? "complete" : ""}><span>{index < step ? <Check /> : index + 1}</span><div><strong>{label}</strong><small>{["Identity and community", "Verified mint and route", "Immutable fee flow", "Confirm every detail"][index]}</small></div></li>)}</ol><div className="builder-safety"><ShieldCheck /><span><strong>Wallet safety</strong><small>SportPad never asks for private keys or seed phrases.</small></span></div></aside>

      <div className="launch-form-panel">
        <div className="form-panel-head"><span>STEP {step + 1} OF {steps.length}</span><strong>{steps[step]}</strong></div>
        {step === 0 ? <div className="form-step"><div className="form-title"><Sparkles /><span><h3>Name the community—not the club.</h3><p>Use original artwork and copy. Do not imply an official relationship.</p></span></div><div className="form-grid"><label className="span-2">Token name<Input value={name} onChange={(event)=>setName(event.target.value.slice(0,48))} placeholder="e.g. The 12th Player" /><small>{name.length}/48</small></label><label>Ticker<Input value={symbol} onChange={(event)=>setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10))} placeholder="PLAYER" /></label><label>Sport<select value={sport} onChange={(event)=>setSport(event.target.value)}><option>Football</option><option>Combat</option><option>Motorsport</option><option>Basketball</option></select></label><label className="span-2">Description<Textarea value={description} onChange={(event)=>setDescription(event.target.value.slice(0,280))} placeholder="Explain the community, narrative, and why supporters would care…" /><small>{description.length}/280 · minimum 20</small></label><label>Website<Input value={website} onChange={(event)=>setWebsite(event.target.value)} placeholder="https://" /></label><label>X / social URL<Input value={social} onChange={(event)=>setSocial(event.target.value)} placeholder="https://x.com/" /></label><div className="media-placeholder span-2"><ImagePlus /><span><strong>Community artwork</strong><small>Upload becomes available after IP-policy review. Use original media only.</small></span><span className="media-status">Locked for drafts</span></div></div></div> : null}

        {step === 1 ? <div className="form-step"><div className="form-title"><BadgeCheck /><span><h3>Choose what eligible holders may earn.</h3><p>Verification belongs to this reward asset, not to your community coin.</p></span></div><div className="reward-selector">{fanAssets.map((asset)=><button key={asset.symbol} type="button" aria-pressed={reward === asset.symbol} className={reward === asset.symbol ? "selected" : ""} onClick={()=>{ if (asset.status === "Researching") { setRewardNotice(`${asset.symbol} cannot be selected yet because its Solana mint verification is incomplete.`); return; } setReward(asset.symbol); setRewardNotice(""); }}><TokenMark token={asset.symbol} color={asset.color} size="lg" /><span><strong>{asset.name}</strong><small>${asset.symbol} · {asset.category}</small><code>{asset.mint.length > 20 ? `${asset.mint.slice(0,7)}…${asset.mint.slice(-6)}` : asset.mint}</code></span><span className={`asset-status status-${asset.status.toLowerCase().replaceAll(" ","-")}`}>{asset.status}</span>{reward === asset.symbol ? <CheckCircle2 className="selected-check" /> : null}</button>)}</div>{rewardNotice ? <div className="form-info" role="status"><Info /><p>{rewardNotice}</p></div> : null}<div className="form-info"><Info /><p><strong>Reward association, not a direct pair.</strong> Holders of ${symbol || "YOURCOIN"} can become eligible for {selected.symbol} allocations after an epoch is funded. This does not make the coin official or endorsed.</p></div></div> : null}

        {step === 2 ? <div className="form-step"><div className="form-title"><LockKeyhole /><span><h3>Review the proposed immutable route.</h3><p>The creator receives 0% of this creator-fee stream in the initial model.</p></span></div><div className="economics-cards"><div><Trophy /><span><small>80%</small><strong>Fan-token rewards</strong><p>Qualifying creator fees would fund {selected.symbol} acquisition and time-weighted holder epochs after execution is audited and enabled.</p></span></div><div><Flame /><span><small>20%</small><strong>Planned SPORT buy + burn</strong><p>After SPORT is deployed, the platform-token output would be destroyed with BurnChecked and its supply delta verified.</p></span></div></div><div className="rules-table"><div><span>Reward calculation</span><strong>Time-weighted token-seconds</strong></div><div><span>Distribution</span><strong>Periodic claim epochs</strong></div><div><span>System accounts</span><strong>Excluded</strong></div><div><span>Unsafe acquisition</span><strong>Pause, never force</strong></div><div><span>Pump holder rewards</span><strong>Disabled</strong></div><div><span>Mainnet execution</span><strong className="negative">Locked</strong></div></div><div className="terms-list">{[{key:"rights",label:"I have the right to use the submitted name, copy, and artwork."},{key:"unofficial",label:"I will not claim club, athlete, league, Chiliz, Socios.com, or FanTokens endorsement."},{key:"economics",label:"I understand the proposed 80/20 fee route and that final fee-share setup may be irreversible."}].map((item)=><label key={item.key}><input type="checkbox" checked={terms[item.key as keyof typeof terms]} onChange={(event)=>setTerms((current)=>({...current,[item.key]:event.target.checked}))}/><span>{terms[item.key as keyof typeof terms] ? <Check /> : null}</span>{item.label}</label>)}</div></div> : null}

        {step === 3 ? <div className="form-step"><div className="form-title"><Goal /><span><h3>One last check before saving.</h3><p>This creates a private project draft—not an on-chain token.</p></span></div><div className="review-card"><div className="review-identity"><TokenMark token={symbol || "SP"} color="#9cff57" size="lg" /><span><strong>{name}</strong><small>${symbol} · Unofficial community token</small></span></div><dl><div><dt>Description</dt><dd>{description}</dd></div><div><dt>Reward asset</dt><dd>{selected.name} (${selected.symbol})</dd></div><div><dt>Official Solana mint</dt><dd><code>{selected.mint}</code></dd></div><div><dt>Route state</dt><dd>{selected.status} · {selected.route}</dd></div><div><dt>Economics</dt><dd>80% rewards · 20% planned SPORT buy and burn</dd></div><div><dt>Execution</dt><dd className="negative">Private draft · mainnet locked</dd></div></dl></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div> : null}

        {validationMessage ? <p className="form-error" role="alert">{validationMessage}</p> : null}
        <div className="builder-actions"><Button variant="outline" disabled={step === 0 || saving} onClick={()=>{ setValidationMessage(""); setStep((value)=>value-1); }} className="border-white/10 bg-transparent text-white hover:bg-white/8 hover:text-white"><ArrowLeft /> Back</Button>{step < steps.length-1 ? <Button onClick={nextStep} className="bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]">Continue <ArrowRight /></Button> : <Button disabled={saving} onClick={saveDraft} className="bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]">{saving ? "Saving…" : "Save private draft"} <Check /></Button>}</div>
      </div>

      <aside className="launch-preview"><div className="preview-label"><span>LIVE PREVIEW</span><small>Community-created</small></div><div className="preview-token"><TokenMark token={symbol || "SP"} color="#9cff57" size="lg" /><span><strong>{name || "Your token"}</strong><small>${symbol || "TICKER"}</small></span></div><p>{description || "Your community story will appear here as you build the draft."}</p><div className="preview-reward"><TokenMark token={selected.symbol} color={selected.color} /><span><small>Eligible for</small><strong>{selected.symbol} rewards</strong></span><BadgeCheck /></div><div className="preview-split"><span><b style={{width:"80%"}} />80% rewards</span><span><b style={{width:"20%"}} />20% burn</span></div><div className="preview-disclaimer">Unofficial community launch. {selected.name} is the verified reward asset; no endorsement is implied.</div></aside>
    </div>
  );
}
