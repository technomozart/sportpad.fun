"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, CheckCircle2, Clock3, Flame, Goal, ImagePlus, Info, LockKeyhole, LogIn, Search, ShieldCheck, Sparkles, Trash2, Trophy, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TokenMark } from "@/components/sport-ui";
import { useSolanaWalletSession } from "@/components/solana-wallet-session";
import { LAUNCH_IMAGE_MIME_TYPES, MAX_LAUNCH_IMAGE_BYTES, MAX_LAUNCH_IMAGE_DIMENSION, MAX_LAUNCH_IMAGE_PIXELS } from "@/lib/protocol/launch-image";
import { fanAssets } from "@/lib/site-data";
import { LaunchModerationGate } from "./launch-moderation-gate";

const steps = ["Community token", "Reward asset", "Economics", "Review"];

type SavedLaunchDraft = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  sport: string;
  website: string | null;
  social: string | null;
  rewardSymbol: string;
  rewardChain: "chiliz" | "solana";
  rightsAttested: boolean;
  unofficialAttested: boolean;
  economicsAttested: boolean;
  imageUrl: string | null;
  status: string;
  moderationVersion: number;
  createdAt: string;
};

function savedDate(value: string) {
  const timestamp = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(timestamp)) return "Saved draft";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(timestamp);
}

function savedStatus(value: string) {
  if (value === "devnet_published") return "Published devnet receipt";
  if (value === "devnet_review") return "Awaiting review";
  if (value === "devnet_verified") return "Devnet verified";
  return "Private draft";
}

function formatV2Quote(value: string | null) {
  if (!value || !/^[0-9]+$/.test(value)) return null;
  const atomic = BigInt(value).toString().padStart(19, "0");
  const whole = atomic.slice(0, -18);
  const fraction = atomic.slice(-18, -12).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function LaunchBuilder() {
  const walletSession = useSolanaWalletSession();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState("Football");
  const [website, setWebsite] = useState("");
  const [social, setSocial] = useState("");
  const [reward, setReward] = useState("");
  const [rewardQuery, setRewardQuery] = useState("");
  const [rewardChainFilter, setRewardChainFilter] = useState<"chiliz" | "solana">("chiliz");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [imageError, setImageError] = useState("");
  const [imageValidating, setImageValidating] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [terms, setTerms] = useState({ rights: false, unofficial: false, economics: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [savedDraftId, setSavedDraftId] = useState("");
  const [savedDrafts, setSavedDrafts] = useState<SavedLaunchDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [draftsWallet, setDraftsWallet] = useState<string | null>(null);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [draftsError, setDraftsError] = useState("");
  const [deletingDraftId, setDeletingDraftId] = useState("");
  const [error, setError] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [rewardRoute, setRewardRoute] = useState<{
    state: "idle" | "checking" | "available" | "unavailable" | "error";
    checkedAt?: string;
    reason?: string;
    market?: {
      quoteAvailable: boolean;
      oneChzOutputAtomic: string | null;
      hundredChzOutputAtomic: string | null;
      depthImpactBps: number | null;
      reason: string;
    };
  }>({ state: "idle" });
  const [rewardRouteRequest, setRewardRouteRequest] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageSelection = useRef(0);
  const selected = useMemo(() => fanAssets.find((asset) => asset.id === reward), [reward]);
  const oneChzQuote = selected?.chain === "chiliz" && rewardRoute.market?.quoteAvailable
    ? formatV2Quote(rewardRoute.market.oneChzOutputAtomic) : null;
  const hundredChzQuote = selected?.chain === "chiliz" && rewardRoute.market?.quoteAvailable
    ? formatV2Quote(rewardRoute.market.hundredChzOutputAtomic) : null;
  const chilizMarketSummary = selected?.chain === "chiliz" && oneChzQuote && hundredChzQuote
    ? `Read-only Kayen snapshot: 1 CHZ estimated at ${oneChzQuote} ${selected.symbol}; 100 CHZ estimated at ${hundredChzQuote} ${selected.symbol}.${typeof rewardRoute.market?.depthImpactBps === "number" ? ` Estimated depth impact ${(rewardRoute.market.depthImpactBps / 100).toFixed(2)}%.` : ""}${rewardRoute.market?.reason === "shallow_depth" ? " Liquidity is shallow at the larger probe size." : ""}`
    : null;
  const quoteObserved = selected?.chain === "chiliz"
    ? Boolean(chilizMarketSummary)
    : rewardRoute.state === "available";
  const marketSnapshotLabel = quoteObserved
    ? `Point-in-time ${selected?.route} quote observed`
    : "No current quote verified";
  const marketStatus = selected?.chain === "chiliz"
    ? chilizMarketSummary ?? (rewardRoute.state === "checking"
      ? "Checking a read-only Chiliz V2 market snapshot. This does not delay saving the draft."
      : "No verified Chiliz V2 market quote is available for this snapshot. The private draft can still be saved.")
    : rewardRoute.state === "available"
      ? "A point-in-time Jupiter quote was observed. It will be checked again before any mainnet signing."
      : rewardRoute.state === "checking"
        ? "Checking a point-in-time Jupiter quote. This does not delay saving the draft."
        : "No current Jupiter quote was verified. The private draft can still be saved.";
  const filteredAssets = useMemo(() => {
    const query = rewardQuery.trim().toLowerCase();
    return fanAssets.filter((asset) =>
      asset.chain === rewardChainFilter
      && (!query || `${asset.name} ${asset.symbol} ${asset.category}`.toLowerCase().includes(query))
    );
  }, [rewardQuery, rewardChainFilter]);
  // A private draft records an intended reward, not an executable market route.
  const canContinue = step === 0 ? name.trim().length >= 2 && symbol.length >= 2 && symbol !== "SPORTPAD" && Boolean(imageFile) && !imageValidating : step === 1 ? Boolean(selected) : step === 2 ? Object.values(terms).every(Boolean) : true;
  const visibleDrafts = draftsWallet === walletSession.wallet ? savedDrafts : [];
  const visibleAuthenticationRequired = draftsWallet === walletSession.wallet && authenticationRequired;
  const visibleDraftsLoading = draftsWallet !== walletSession.wallet || draftsLoading;

  useEffect(() => () => {
    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  useEffect(() => {
    if (!reward) return;
    const controller = new AbortController();
    if (!selected) return;
    fetch(`/api/reward-routes/${encodeURIComponent(selected.symbol)}?chain=${encodeURIComponent(selected.chain)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as {
          route?: { available?: boolean; checkedAt?: string; reason?: string };
          market?: { quoteAvailable: boolean; oneChzOutputAtomic: string | null;
            hundredChzOutputAtomic: string | null; depthImpactBps: number | null; reason: string };
        };
        if (!response.ok || !body.route) throw new Error("Route check failed");
        setValidationMessage("");
        setRewardRoute({
          state: body.route.available ? "available" : "unavailable",
          checkedAt: body.route.checkedAt,
          reason: body.route.reason,
          market: body.market,
        });
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setValidationMessage("");
        setRewardRoute({ state: "error" });
      });
    return () => controller.abort();
  }, [reward, rewardRouteRequest, selected]);

  useEffect(() => {
    const controller = new AbortController();
    const requestedWallet = walletSession.wallet;
    fetch("/api/launch-drafts", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { drafts?: SavedLaunchDraft[]; error?: string };
        if (response.status === 401) {
          setAuthenticationRequired(true);
          setSavedDrafts([]);
          setDraftsWallet(requestedWallet);
          setDraftsError("");
          return;
        }
        if (!response.ok) throw new Error(body.error ?? "Saved drafts could not be loaded.");
        setAuthenticationRequired(false);
        setSavedDrafts(Array.isArray(body.drafts) ? body.drafts : []);
        setDraftsWallet(requestedWallet);
        setDraftsError("");
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setDraftsError(caught instanceof Error ? caught.message : "Saved drafts could not be loaded.");
        setDraftsWallet(requestedWallet);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDraftsLoading(false);
      });
    return () => controller.abort();
  }, [walletSession.wallet]);

  async function chooseImage(file: File | null) {
    const selection = ++imageSelection.current;
    setImageError("");
    if (!file) {
      setImageValidating(false);
      return;
    }
    if (!(LAUNCH_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setImageError("Choose a PNG, JPEG, or WebP image.");
      setImageValidating(false);
      if (imageInput.current) imageInput.current.value = "";
      return;
    }
    if (file.size === 0) {
      setImageError("Choose a non-empty image.");
      setImageValidating(false);
      if (imageInput.current) imageInput.current.value = "";
      return;
    }
    if (file.size > MAX_LAUNCH_IMAGE_BYTES) {
      setImageError("Choose an image that is 5 MB or smaller.");
      setImageValidating(false);
      if (imageInput.current) imageInput.current.value = "";
      return;
    }
    setImageValidating(true);
    try {
      const decoded = await createImageBitmap(file);
      const { width, height } = decoded;
      decoded.close();
      if (selection !== imageSelection.current) return;
      if (
        width > MAX_LAUNCH_IMAGE_DIMENSION ||
        height > MAX_LAUNCH_IMAGE_DIMENSION ||
        width * height > MAX_LAUNCH_IMAGE_PIXELS
      ) {
        setImageError(`Choose an image no larger than ${MAX_LAUNCH_IMAGE_DIMENSION} x ${MAX_LAUNCH_IMAGE_DIMENSION} pixels.`);
        if (imageInput.current) imageInput.current.value = "";
        return;
      }
      const preview = URL.createObjectURL(file);
      setImageFile(file);
      setImagePreview(preview);
    } catch {
      if (selection !== imageSelection.current) return;
      setImageError("That image could not be decoded. Choose a valid PNG, JPEG, or WebP image.");
      if (imageInput.current) imageInput.current.value = "";
    } finally {
      if (selection === imageSelection.current) setImageValidating(false);
    }
  }

  function removeImage() {
    imageSelection.current += 1;
    setImageFile(null);
    setImagePreview("");
    setImageError("");
    setImageValidating(false);
    if (imageInput.current) imageInput.current.value = "";
  }

  function nextStep() {
    setValidationMessage("");
    if (canContinue) {
      setStep((value) => value + 1);
      return;
    }
    if (step === 0) setValidationMessage(symbol === "SPORTPAD" ? "SPORTPAD is reserved for the platform token." : "Add a name, a 2-10 character ticker, and a token image.");
    if (step === 1) setValidationMessage("Choose an official Fan Token for this private reward plan.");
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
    setReward("");
    setRewardQuery("");
    setRewardChainFilter("chiliz");
    removeImage();
    setTerms({ rights: false, unofficial: false, economics: false });
    setSaving(false);
    setSaved(false);
    setResumed(false);
    setSavedDraftId("");
    setError("");
    setValidationMessage("");
    setRewardRoute({ state: "idle" });
  }

  function resumeDraft(draft: SavedLaunchDraft) {
    const rewardAsset = fanAssets.find((asset) => asset.symbol === draft.rewardSymbol && asset.chain === draft.rewardChain);
    if (!rewardAsset) {
      setDraftsError("That draft uses a Fan Token that is no longer in the supported registry.");
      return;
    }
    setName(draft.name);
    setSymbol(draft.symbol);
    setDescription(draft.description);
    setSport(draft.sport);
    setWebsite(draft.website ?? "");
    setSocial(draft.social ?? "");
    setReward(rewardAsset.id);
    setRewardChainFilter(rewardAsset.chain);
    setRewardRoute({ state: "checking" });
    setRewardRouteRequest((value) => value + 1);
    setImageFile(null);
    setImagePreview(draft.imageUrl ?? "");
    setTerms({
      rights: draft.rightsAttested,
      unofficial: draft.unofficialAttested,
      economics: draft.economicsAttested,
    });
    setSavedDraftId(draft.id);
    setError("");
    setDraftsError("");
    setResumed(true);
    setSaved(true);
  }

  async function saveDraft() {
    setSaving(true); setError("");
    try {
      if (!selected) throw new Error("Choose an official Fan Token reward before saving.");
      if (!imageFile) throw new Error("Choose a token image before saving.");
      const form = new FormData();
      form.set("payload", JSON.stringify({ name, symbol, description, sport, website, social, rewardSymbol: selected.symbol, rewardChain: selected.chain, attestations: terms }));
      form.set("image", imageFile, imageFile.name);
      const response = await fetch("/api/launch-drafts", { method: "POST", body: form });
      const body = (await response.json()) as { error?: string; imageStored?: boolean; draft?: SavedLaunchDraft };
      if (response.status === 401) {
        setAuthenticationRequired(true);
        throw new Error("Connect and verify a Solana wallet before saving this private draft.");
      }
      if (!response.ok) throw new Error(body.error ?? "Draft could not be saved.");
      if (body.imageStored !== true) throw new Error("The image was not stored. Please retry.");
      if (!body.draft?.id) throw new Error("The saved draft identifier was missing. Please retry.");
      setSavedDraftId(body.draft.id);
      setSavedDrafts((current) => [body.draft as SavedLaunchDraft, ...current.filter((draft) => draft.id !== body.draft?.id)]);
      setResumed(false);
      setSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Draft could not be saved."); }
    finally { setSaving(false); }
  }

  async function deleteDraft(draft: SavedLaunchDraft) {
    if (!window.confirm(`Delete the untouched private draft ${draft.name}? This cannot be undone.`)) return;
    setDeletingDraftId(draft.id);
    setDraftsError("");
    try {
      const response = await fetch(`/api/launch-drafts/${encodeURIComponent(draft.id)}`, { method: "DELETE" });
      const body = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !body.deleted) throw new Error(body.error ?? "Draft could not be deleted.");
      setSavedDrafts((current) => current.filter((item) => item.id !== draft.id));
    } catch (caught) {
      setDraftsError(caught instanceof Error ? caught.message : "Draft could not be deleted.");
    } finally {
      setDeletingDraftId("");
    }
  }

  if (saved && selected) return <div className="launch-success"><div className="success-mark"><CheckCircle2 /></div>{imagePreview ? <img className="saved-artwork-preview" src={imagePreview} alt={`${name} token image`} /> : null}<p className="section-eyebrow">{resumed ? "Private draft resumed" : "Private draft saved"}</p><h2>${symbol} is saved privately.</h2><p>{selected.chain === "chiliz" ? "This official Chiliz V2 Fan Token is a planned reward only. SportPad has not verified automatic purchase or claims for it, and its mainnet launch is blocked. Content review does not change that." : resumed ? "This private draft was restored from your account. Continue through content review before any IPFS upload or mainnet transaction." : "Your image and draft details were stored privately. Submit the content for review before anything is uploaded to IPFS or sent to Pump."}</p><div className="success-summary"><span><strong>{name}</strong><small>Community token</small></span><span><strong>{selected.symbol}</strong><small>Planned Fan Token reward</small></span><span><strong>80 / 20</strong><small>Proposed fee routing</small></span><span><strong>Not live</strong><small>Execution status</small></span></div>{savedDraftId ? <LaunchModerationGate draftId={savedDraftId} name={name} symbol={symbol} /> : null}<Button onClick={resetDraft} variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white">Create another draft</Button></div>;

  return (
    <>
      <section className={`saved-drafts-panel ${visibleAuthenticationRequired ? "sign-in-required" : ""}`} aria-labelledby="saved-drafts-title">
        <div className="saved-drafts-heading">
          <span className="saved-drafts-icon">{visibleAuthenticationRequired ? <LogIn /> : <Clock3 />}</span>
          <span><strong id="saved-drafts-title">{visibleAuthenticationRequired ? "Connect a wallet to save drafts" : "Your saved drafts"}</strong><small>{visibleAuthenticationRequired ? "Verify your Solana wallet with a message signature. Only that wallet can reopen its private drafts. This does not spend SOL." : visibleDraftsLoading ? "Checking this account for private drafts." : visibleDrafts.length ? "Resume a private draft and continue its launch review." : "Private drafts will appear here after you save one."}</small></span>
          {visibleAuthenticationRequired ? <button type="button" disabled={walletSession.busy} onClick={() => void walletSession.connectAndVerify()}>{walletSession.busy ? "Connecting..." : "Connect Solana wallet"} <ArrowRight /></button> : null}
        </div>
        {visibleDrafts.length ? <div className="saved-draft-list">{visibleDrafts.map((draft) => <div className="saved-draft-item" key={draft.id}><button className="saved-draft-resume" type="button" onClick={() => resumeDraft(draft)}><span className="saved-draft-art">{draft.imageUrl ? <img src={draft.imageUrl} alt="" /> : <TokenMark token={draft.symbol} color="#9cff57" />}</span><span><strong>{draft.name}</strong><small>${draft.symbol} · {draft.rewardSymbol} rewards</small><small>{savedDate(draft.createdAt)} · {savedStatus(draft.status)}</small></span><b>Resume <ArrowRight /></b></button>{draft.status === "draft" && draft.moderationVersion === 0 ? <button className="saved-draft-delete" type="button" disabled={deletingDraftId === draft.id} onClick={() => void deleteDraft(draft)} aria-label={`Delete ${draft.name}`}><Trash2 /></button> : null}</div>)}</div> : null}
        {draftsWallet === walletSession.wallet && draftsError ? <p className="saved-drafts-error" role="status">{draftsError}</p> : null}
      </section>
      <div className="launch-builder">
      <aside className="launch-steps"><div><p className="section-eyebrow">Launch builder</p><h2>Build a community token.</h2><p>The draft steps do not request a signature. Mainnet wallet approvals appear only after review.</p></div><ol>{steps.map((label,index)=><li key={label} className={index === step ? "active" : index < step ? "complete" : ""}><span>{index < step ? <Check /> : index + 1}</span><div><strong>{label}</strong><small>{["Identity and community", "Official reward selection", "Immutable fee flow", "Confirm every detail"][index]}</small></div></li>)}</ol><div className="builder-safety"><ShieldCheck /><span><strong>Wallet safety</strong><small>SportPad never asks for private keys or seed phrases.</small></span></div></aside>

      <div className="launch-form-panel">
        <div className="form-panel-head"><span>STEP {step + 1} OF {steps.length}</span><strong>{steps[step]}</strong></div>
        {step === 0 ? <div className="form-step"><div className="form-title"><Sparkles /><span><h3>Create your token.</h3><p>Add the core details and upload the image people will recognize.</p></span></div><div className="form-grid"><label className="span-2">Token name<Input value={name} onChange={(event)=>setName(event.target.value.slice(0,32))} placeholder="e.g. The 12th Player" /><small>{name.length}/32</small></label><label>Ticker<Input value={symbol} onChange={(event)=>setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10))} placeholder="PLAYER" /></label><label>Sport<select value={sport} onChange={(event)=>setSport(event.target.value)}><option>Football</option><option>Combat</option><option>Motorsport</option><option>Basketball</option></select></label><label className="span-2">Description (optional)<Textarea value={description} onChange={(event)=>setDescription(event.target.value.slice(0,280))} placeholder="Tell people what the token is about." /><small>{description.length}/280</small></label><label>Website<Input value={website} onChange={(event)=>setWebsite(event.target.value)} placeholder="https://" /></label><label>X / social URL<Input value={social} onChange={(event)=>setSocial(event.target.value)} placeholder="https://x.com/" /></label><div className={`image-uploader span-2 ${dragActive ? "drag-active" : ""} ${imagePreview ? "has-image" : ""}`} onDragEnter={(event)=>{ event.preventDefault(); setDragActive(true); }} onDragOver={(event)=>event.preventDefault()} onDragLeave={(event)=>{ event.preventDefault(); setDragActive(false); }} onDrop={(event)=>{ event.preventDefault(); setDragActive(false); void chooseImage(event.dataTransfer.files[0] ?? null); }}>{imagePreview ? <><img src={imagePreview} alt="Token image preview" /><div className="image-upload-copy"><strong>{imageFile?.name}</strong><small>{imageFile ? `${(imageFile.size / 1_000_000).toFixed(2)} MB` : "Image selected"}</small><span><button type="button" onClick={()=>imageInput.current?.click()}><Upload /> Replace</button><button type="button" onClick={removeImage}><Trash2 /> Remove</button></span></div></> : <><ImagePlus /><span className="image-upload-copy"><strong>Drop image here or choose file</strong><small>{imageValidating ? "Checking image..." : `PNG, JPEG, or WebP. Maximum 5 MB and ${MAX_LAUNCH_IMAGE_DIMENSION} x ${MAX_LAUNCH_IMAGE_DIMENSION} px.`}</small><button type="button" disabled={imageValidating} onClick={()=>imageInput.current?.click()}><Upload /> {imageValidating ? "Checking" : "Choose image"}</button></span></>}<input ref={imageInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event)=>void chooseImage(event.target.files?.[0] ?? null)} /></div>{imageError ? <p className="form-error span-2" role="alert">{imageError}</p> : null}</div></div> : null}

        {step === 1 ? <div className="form-step">
          <div className="form-title"><BadgeCheck /><span><h3>Choose an official Fan Token reward.</h3><p>Select an official Solana or Chiliz V2 Fan Token for this private draft. Your community coin would still trade against SOL on Pump. The Fan Token is a planned holder reward, not its market pair. Automated purchase and claims are not live.</p></span></div>
          <div className="flex flex-wrap gap-2" aria-label="Reward chain">
            {(["chiliz", "solana"] as const).map((chain) => <button key={chain} type="button" aria-pressed={rewardChainFilter === chain} className={`rounded-full border px-4 py-2 text-sm font-medium ${rewardChainFilter === chain ? "border-[#9cff57] bg-[#9cff57]/15 text-[#9cff57]" : "border-white/15 text-white/70 hover:border-white/35 hover:text-white"}`} onClick={() => { setRewardChainFilter(chain); setReward(""); setRewardQuery(""); setRewardRoute({ state: "idle" }); setValidationMessage(""); }}>{chain === "chiliz" ? "Chiliz Chain rewards" : "Solana rewards"} ({fanAssets.filter((asset) => asset.chain === chain).length})</button>)}
          </div>
          <label className="reward-search"><Search /><span className="sr-only">Search official Fan Tokens</span><Input value={rewardQuery} onChange={(event)=>setRewardQuery(event.target.value)} placeholder={`Search ${rewardChainFilter === "chiliz" ? "Chiliz V2" : "Solana"} Fan Tokens`} /></label>
          <div className="reward-selector">{filteredAssets.map((asset)=><button key={asset.id} type="button" aria-pressed={reward === asset.id} className={reward === asset.id ? "selected" : ""} onClick={()=>{ setValidationMessage(""); setRewardRoute({ state: "checking" }); setReward(asset.id); setRewardRouteRequest((value)=>value+1); }}><TokenMark token={asset.symbol} color={asset.color} imagePath={asset.imagePath} size="lg" /><span><strong>{asset.name}</strong><small>${asset.symbol} · {asset.category}</small><code>{asset.mint.slice(0,7)}...{asset.mint.slice(-6)}</code></span><span className="asset-status status-registry-listed">{asset.chain === "chiliz" ? "Chiliz V2 reward plan" : "Solana via Jupiter"}</span>{reward === asset.id ? <CheckCircle2 className="selected-check" /> : null}</button>)}</div>
          {filteredAssets.length === 0 ? <div className="form-info"><Info /><p>No official Fan Token matches that search.</p></div> : null}
          {selected ? <div className={`form-info reward-route-${rewardRoute.state}`} role="status"><Info /><p><strong>{selected.name} is an official Fan Token on {selected.chain === "chiliz" ? "Chiliz Chain" : "Solana"}.</strong> {marketStatus} {selected.chain === "chiliz" ? "SportPad's automatic V2 purchase and claim execution is unverified. A private draft can be saved, but mainnet launch with this reward is blocked." : "Automatic rewards and claims remain paused pending verification."}</p></div> : <div className="form-info"><Info /><p>Select one official Fan Token deliberately. SportPad will not choose a default reward for you.</p></div>}
        </div> : null}

        {step === 2 && selected ? <div className="form-step"><div className="form-title"><LockKeyhole /><span><h3>Review the proposed community fee route.</h3><p>The community coin remains SOL-paired on Pump. {selected.symbol} is the intended reward denomination, not a cross-chain liquidity pair. SPORTPAD&apos;s own fees are a separate development fund.</p></span></div><div className="economics-cards"><div><Trophy /><span><small>80%</small><strong>Fan Token reward treasury</strong><p>A future launch would send this 80% share to the reward treasury. Token purchases and holder allocations are separate, paused steps.</p></span></div><div><Flame /><span><small>20%</small><strong>SPORTPAD buyback treasury</strong><p>A future launch would send this 20% share to the buyback treasury. SPORTPAD purchases and burns are separate, paused steps.</p></span></div></div><div className="rules-table"><div><span>Pump market pair</span><strong>SOL</strong></div><div><span>Planned reward only</span><strong>{selected.symbol} on {selected.chain === "chiliz" ? "Chiliz Chain" : "Solana"}</strong></div><div><span>Market snapshot</span><strong className={quoteObserved ? "positive" : undefined}>{marketSnapshotLabel}</strong></div><div><span>Automated acquisition and claims</span><strong>Not verified</strong></div><div><span>SPORTPAD fees</span><strong>100% project development</strong></div><div><span>Community fee split</span><strong>Proposed one-time 80 / 20 lock</strong></div></div><div className="terms-list">{[{key:"rights",label:"I have the right to use the submitted name, copy, and image."},{key:"unofficial",label:"I understand the community token and official Fan Token reward are separate assets."},{key:"economics",label:"I understand this community launch's 80/20 creator-fee route is designed to be irreversible."}].map((item)=><label key={item.key}><input type="checkbox" checked={terms[item.key as keyof typeof terms]} onChange={(event)=>setTerms((current)=>({...current,[item.key]:event.target.checked}))}/><span>{terms[item.key as keyof typeof terms] ? <Check /> : null}</span>{item.label}</label>)}</div></div> : null}

        {step === 3 && selected ? <div className="form-step"><div className="form-title"><Goal /><span><h3>One last check before saving.</h3><p>This saves a private project draft. A quote or content approval does not enable mainnet or holder claims.</p></span></div><div className="review-card"><div className="review-identity">{imagePreview ? <img className="review-artwork" src={imagePreview} alt={`${name} token image`} /> : <TokenMark token={symbol || "SP"} color="#9cff57" size="lg" />}<span><strong>{name}</strong><small>${symbol} · Community token draft</small></span></div><dl><div><dt>Description</dt><dd>{description || "No description provided"}</dd></div><div><dt>Reward asset</dt><dd>{selected.name} (${selected.symbol}) official Fan Token</dd></div><div><dt>{selected.chain === "chiliz" ? "Chiliz V2 contract" : "Solana token address"}</dt><dd><code>{selected.mint}</code></dd></div><div><dt>Market snapshot</dt><dd className={quoteObserved ? "positive" : undefined}>{marketSnapshotLabel}</dd></div><div><dt>Community economics</dt><dd>Proposed 80% reward treasury · 20% SPORTPAD buyback treasury</dd></div><div><dt>Execution</dt><dd>{selected.chain === "chiliz" ? "Chiliz V2 purchase, claims, and mainnet launch blocked pending verification" : "Mainnet and claims paused pending financial verification"}</dd></div></dl></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div> : null}

        {validationMessage ? <p className="form-error" role="alert">{validationMessage}</p> : null}
        <div className="builder-actions"><Button variant="outline" disabled={step === 0 || saving} onClick={()=>{ setValidationMessage(""); setStep((value)=>value-1); }} className="border-white/10 bg-transparent text-white hover:bg-white/8 hover:text-white"><ArrowLeft /> Back</Button>{step < steps.length-1 ? <Button onClick={nextStep} className="bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]">Continue <ArrowRight /></Button> : <Button disabled={saving} onClick={saveDraft} className="bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]">{saving ? "Saving…" : "Save private draft"} <Check /></Button>}</div>
      </div>

      <aside className="launch-preview"><div className="preview-label"><span>DRAFT PREVIEW</span><small>Private draft</small></div><div className="preview-token">{imagePreview ? <img className="preview-artwork" src={imagePreview} alt="Token image preview" /> : <TokenMark token={symbol || "SP"} color="#9cff57" size="lg" />}<span><strong>{name || "Your token"}</strong><small>${symbol || "TICKER"}</small></span></div><p>{description || "Description is optional."}</p>{selected ? <div className="preview-reward"><TokenMark token={selected.symbol} color={selected.color} imagePath={selected.imagePath} /><span><small>Planned Fan Token reward on {selected.chain === "chiliz" ? "Chiliz" : "Solana"}</small><strong>{selected.symbol}</strong></span><BadgeCheck /></div> : <div className="preview-reward preview-reward-empty"><BadgeCheck /><span><small>Official Fan Token reward</small><strong>Choose one</strong></span></div>}<div className="preview-split"><span><b style={{width:"80%"}} />80% to Fan Token reward treasury</span><span><b style={{width:"20%"}} />20% to SPORTPAD buyback treasury</span></div><div className="preview-disclaimer">{selected ? `${marketSnapshotLabel}. This is a private reward plan, not a live purchase or claim route. The community coin remains SOL-paired on Pump.` : "Choose an official Fan Token reward."}</div></aside>
      </div>
    </>
  );
}
