"use client";

import { CheckCircle2, ExternalLink, Flame, LockKeyhole, Rocket, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useSolanaWalletSession } from "@/components/solana-wallet-session";
import { Button } from "@/components/ui/button";

type Evidence = {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  finalized: boolean;
};

type PendingMainnetEvidence = {
  version: 1;
  creatorWallet?: string;
  metadataUri?: string;
  rewardTreasury?: string;
  buybackTreasury?: string;
  mint?: string;
  create?: Evidence;
  fee?: Evidence;
};

type MainnetState = {
  draftId: string;
  chain: "solana:mainnet";
  enabled: boolean;
  ready: boolean;
  missing: string[];
  rewardTreasury: string | null;
  buybackTreasury: string | null;
  sportpadMintConfigured: boolean;
  creatorWallet: string | null;
  metadataUri: string | null;
  mint: string | null;
  createSignature: string | null;
  feeSignature: string | null;
  verifiedAt: string | null;
  publicPath: string | null;
  status: "not_started" | "prepared" | "published";
};

function storageKey(draftId: string) {
  return `sportpad:mainnet:${draftId}`;
}

function explorer(value: string, type: "address" | "tx") {
  return `https://explorer.solana.com/${type}/${encodeURIComponent(value)}`;
}

async function responseBody(response: Response) {
  const body = await response.json() as { mainnet?: MainnetState; error?: string };
  if (!response.ok || !body.mainnet) throw new Error(body.error ?? "Mainnet launch request failed.");
  return body.mainnet;
}

function readPending(draftId: string): PendingMainnetEvidence {
  if (typeof window === "undefined") return { version: 1 };
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(draftId)) ?? "null") as PendingMainnetEvidence | null;
    return value?.version === 1 ? value : { version: 1 };
  } catch {
    return { version: 1 };
  }
}

function finalizedEvidence(evidence: Evidence | undefined) {
  return evidence ? { ...evidence, finalized: true } : undefined;
}

export function MainnetLaunchPanel({ draftId, name, symbol }: { draftId: string; name: string; symbol: string }) {
  const walletSession = useSolanaWalletSession();
  const [mainnet, setMainnet] = useState<MainnetState | null>(null);
  const [pending, setPending] = useState<PendingMainnetEvidence>(() => readPending(draftId));
  const [publicationAccepted, setPublicationAccepted] = useState(false);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [balanceLamports, setBalanceLamports] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/launch-drafts/${encodeURIComponent(draftId)}/mainnet`, { cache: "no-store" })
      .then(responseBody)
      .then(setMainnet)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Mainnet launch state is unavailable."));
  }, [draftId]);

  useEffect(() => {
    if (!walletSession.wallet) return;
    let active = true;
    import("@/lib/client/pump-mainnet")
      .then(({ getMainnetBalanceLamports }) => getMainnetBalanceLamports(walletSession.wallet!))
      .then((balance) => { if (active) setBalanceLamports(balance); })
      .catch(() => { if (active) setBalanceLamports(null); });
    return () => { active = false; };
  }, [walletSession.wallet]);

  const exactContext = useMemo(() => Boolean(
    walletSession.wallet &&
    mainnet?.metadataUri &&
    mainnet.rewardTreasury &&
    mainnet.buybackTreasury &&
    pending.creatorWallet === walletSession.wallet &&
    pending.metadataUri === mainnet.metadataUri &&
    pending.rewardTreasury === mainnet.rewardTreasury &&
    pending.buybackTreasury === mainnet.buybackTreasury
  ), [mainnet, pending, walletSession.wallet]);

  function persist(next: PendingMainnetEvidence) {
    setPending(next);
    localStorage.setItem(storageKey(draftId), JSON.stringify(next));
  }

  async function post(body: unknown) {
    const response = await fetch(`/api/launch-drafts/${encodeURIComponent(draftId)}/mainnet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const next = await responseBody(response);
    setMainnet(next);
    return next;
  }

  async function reconcileEvidence(evidence: Evidence | undefined) {
    if (!evidence || evidence.finalized) return evidence;
    const { getMainnetSubmissionState } = await import("@/lib/client/pump-mainnet");
    const state = await getMainnetSubmissionState(evidence.signature, evidence.lastValidBlockHeight);
    if (state === "pending") throw new Error("The previously signed mainnet transaction is still pending. Wait for finality before retrying.");
    if (state === "failed" || state === "expired") return undefined;
    return { ...evidence, finalized: true };
  }

  async function runLaunch() {
    setBusy(true);
    setError("");
    try {
      if (!walletSession.wallet) throw new Error("Connect and verify the Solana wallet that will create the coin.");
      if (!mainnet?.ready || !mainnet.rewardTreasury || !mainnet.buybackTreasury) {
        throw new Error(`Mainnet is waiting for ${mainnet?.missing.join(", ") || "protocol configuration"}.`);
      }
      if (!mainnet.metadataUri && !publicationAccepted) {
        throw new Error("Confirm the permanent public metadata upload before starting.");
      }
      if (!riskAccepted) throw new Error("Confirm that this uses real SOL and an irreversible fee split.");
      let state = mainnet;
      setStatus(state.metadataUri ? "Rechecking the live Fan Token route before signing..." : "Checking the route and publishing approved metadata to Pump IPFS...");
      state = await post({ action: "prepare", publicationAccepted: true });
      if (!state.metadataUri || !state.rewardTreasury || !state.buybackTreasury) {
        throw new Error("The prepared mainnet configuration is incomplete.");
      }
      const context: PendingMainnetEvidence = {
        version: 1,
        creatorWallet: walletSession.wallet,
        metadataUri: state.metadataUri,
        rewardTreasury: state.rewardTreasury,
        buybackTreasury: state.buybackTreasury,
      };
      let work = exactContext ? pending : context;
      const reconciledCreate = await reconcileEvidence(work.create);
      const reconciledFee = await reconcileEvidence(work.fee);
      work = { ...work, create: reconciledCreate, fee: reconciledFee };
      persist(work);

      if (!work.create) {
        setStatus("Approve the real Pump coin creation in your wallet. No initial buy is added.");
        const { createPumpMainnetCoin } = await import("@/lib/client/pump-mainnet");
        const result = await createPumpMainnetCoin({
          walletAddress: walletSession.wallet,
          name,
          symbol,
          metadataUri: state.metadataUri,
          signTransaction: walletSession.signTransaction,
          onSubmitted: (submission) => {
            work = { ...work, mint: submission.mint, create: { ...submission, finalized: false } };
            persist(work);
          },
        });
        work = { ...work, mint: result.mint, create: finalizedEvidence(work.create) };
        persist(work);
      }
      if (!work.mint || !work.create?.finalized) throw new Error("The coin creation evidence is incomplete.");

      if (!work.fee) {
        setStatus("Coin finalized. Approve the one-time 80/20 creator-fee lock.");
        const { configurePumpMainnetFeeSplit } = await import("@/lib/client/pump-mainnet");
        await configurePumpMainnetFeeSplit({
          walletAddress: walletSession.wallet,
          mintAddress: work.mint,
          rewardTreasury: state.rewardTreasury,
          buybackTreasury: state.buybackTreasury,
          signTransaction: walletSession.signTransaction,
          onSubmitted: (submission) => {
            work = { ...work, fee: { ...submission, finalized: false } };
            persist(work);
          },
        });
        work = { ...work, fee: finalizedEvidence(work.fee) };
        persist(work);
      }
      if (!work.fee?.finalized) throw new Error("The fee-lock evidence is incomplete.");

      setStatus("Both transactions finalized. SportPad is independently verifying the mint and 80/20 split...");
      state = await post({ action: "verify", mint: work.mint, create: work.create, fee: work.fee });
      localStorage.removeItem(storageKey(draftId));
      setPending({ version: 1 });
      setStatus("Mainnet launch verified and published.");
      setMainnet(state);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The mainnet launch stopped.");
    } finally {
      setBusy(false);
    }
  }

  if (!mainnet) {
    return <section className="devnet-launch-panel"><div className="devnet-launch-head"><span><Rocket /></span><div><p className="section-eyebrow">Solana mainnet</p><h3>Loading mainnet launch state.</h3></div></div>{error ? <p className="form-error">{error}</p> : null}</section>;
  }

  if (mainnet.status === "published" && mainnet.mint) {
    return <section className="devnet-launch-panel"><div className="devnet-complete"><CheckCircle2 /><span><strong>Mainnet launch verified</strong><small>The Pump mint and immutable 80/20 creator-fee split were independently checked on Solana mainnet.</small></span><a href={explorer(mainnet.mint, "address")} target="_blank" rel="noopener noreferrer">Open mint <ExternalLink /></a></div></section>;
  }

  return (
    <section className="devnet-launch-panel" aria-labelledby="mainnet-launch-title">
      <div className="devnet-launch-head">
        <span><Rocket /></span>
        <div><p className="section-eyebrow">Solana mainnet community launch</p><h3 id="mainnet-launch-title">Launch the real Pump coin and lock its reward route.</h3><p>This community coin trades against SOL. Its creator fees are locked 80% to official Fan Token rewards and 20% to buying and burning SPORTPAD. SPORTPAD&apos;s own creator fees remain with the project for development.</p></div>
        <strong className="devnet-badge">REAL SOL</strong>
      </div>

      {!mainnet.ready ? <div className="devnet-lock-notice"><LockKeyhole /><p><strong>Mainnet is not enabled yet.</strong> Required operator configuration: {mainnet.missing.join(", ")}.</p></div> : null}

      <div className="devnet-wallet-state">
        <Wallet />
        <span><small>Verified creator wallet</small><strong>{walletSession.wallet || "Not verified"}</strong>{walletSession.wallet ? <small>{balanceLamports === null ? "Checking mainnet balance" : `${(balanceLamports / 1_000_000_000).toFixed(4)} SOL`}</small> : null}</span>
        {!walletSession.wallet ? <Button onClick={walletSession.connectAndVerify} disabled={walletSession.busy}>{walletSession.busy ? "Waiting..." : "Connect and verify"}</Button> : null}
      </div>

      <div className="devnet-recipient-grid">
        <label>80% reward treasury<code>{mainnet.rewardTreasury || "Not configured"}</code><small>Creator fees allocated for official Fan Token acquisition and holder epochs.</small></label>
        <label>20% community-funded SPORTPAD burn<code>{mainnet.buybackTreasury || "Not configured"}</code><small>Uses this launch&apos;s fees to buy SPORTPAD, then burns the purchased tokens.</small></label>
      </div>

      {!mainnet.metadataUri ? <label className="devnet-consent"><input type="checkbox" checked={publicationAccepted} onChange={(event) => setPublicationAccepted(event.target.checked)} /><span><strong>Publish the approved image and metadata to IPFS</strong><small>This content becomes public and may be permanent.</small></span></label> : null}
      <label className="devnet-consent"><input type="checkbox" checked={riskAccepted} onChange={(event) => setRiskAccepted(event.target.checked)} /><span><strong>I understand this is mainnet and uses real SOL</strong><small>The wallet signs two transactions. The 80/20 fee-share update is designed to be irreversible.</small></span></label>

      <div className="devnet-lock-notice"><ShieldCheck /><p><strong>SportPad never asks for your private key.</strong> Your wallet signs the coin creation and fee lock. The server independently verifies both finalized transactions before publishing the launch.</p></div>

      <Button onClick={runLaunch} disabled={busy || !mainnet.ready || !walletSession.wallet || !riskAccepted || (!mainnet.metadataUri && !publicationAccepted)} className="devnet-launch-button"><Flame /> {busy ? "Working on mainnet..." : pending.create ? "Continue mainnet launch" : "Launch on Pump mainnet"}</Button>
      {status ? <p className="devnet-status" role="status">{status}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
