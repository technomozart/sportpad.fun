"use client";

import { CheckCircle2, ExternalLink, FlaskConical, LockKeyhole, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { useSolanaWalletSession } from "@/components/solana-wallet-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DevnetState = {
  draftId: string;
  chain: "solana:devnet";
  creatorWallet: string | null;
  metadataUri: string | null;
  mint: string | null;
  createSignature: string | null;
  feeSignature: string | null;
  rewardWallet: string | null;
  burnWallet: string | null;
  verifiedAt: string | null;
  pendingMint: string | null;
  pendingCreateSignature: string | null;
  pendingCreateBlockhash: string | null;
  pendingCreateLastValidBlockHeight: number | null;
  pendingFeeSignature: string | null;
  pendingFeeBlockhash: string | null;
  pendingFeeLastValidBlockHeight: number | null;
  status: "not_started" | "prepared" | "coin_created" | "verified";
};

type PendingDevnetEvidence = {
  version: 2;
  creatorWallet?: string;
  metadataUri?: string;
  rewardWallet?: string;
  burnWallet?: string;
  mint?: string;
  createSignature?: string;
  createBlockhash?: string;
  createLastValidBlockHeight?: number;
  feeSignature?: string;
  feeBlockhash?: string;
  feeLastValidBlockHeight?: number;
};

type TransactionState = "pending" | "failed" | "expired";

class DevnetActionError extends Error {
  constructor(message: string, public readonly txState?: TransactionState) {
    super(message);
    this.name = "DevnetActionError";
  }
}

function evidenceMatches(
  evidence: PendingDevnetEvidence,
  expected: Required<Pick<PendingDevnetEvidence, "creatorWallet" | "metadataUri" | "rewardWallet" | "burnWallet">>,
) {
  return evidence.version === 2 &&
    evidence.creatorWallet === expected.creatorWallet &&
    evidence.metadataUri === expected.metadataUri &&
    evidence.rewardWallet === expected.rewardWallet &&
    evidence.burnWallet === expected.burnWallet;
}

async function responseBody(response: Response) {
  const body = await response.json() as { error?: string; devnet?: DevnetState; txState?: TransactionState };
  if (!response.ok) throw new DevnetActionError(body.error ?? "The devnet action failed.", body.txState);
  if (!body.devnet) throw new Error("The devnet response was incomplete.");
  return body.devnet;
}

function explorerUrl(value: string, type: "address" | "tx") {
  return `https://explorer.solana.com/${type}/${encodeURIComponent(value)}?cluster=devnet`;
}

export function DevnetLaunchPanel({ draftId, name, symbol }: { draftId: string; name: string; symbol: string }) {
  const walletSession = useSolanaWalletSession();
  const [devnet, setDevnet] = useState<DevnetState | null>(null);
  const [rewardWallet, setRewardWallet] = useState("");
  const [burnWallet, setBurnWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [publicationAccepted, setPublicationAccepted] = useState(false);
  const [pendingEvidence, setPendingEvidence] = useState<PendingDevnetEvidence>({ version: 2 });

  useEffect(() => {
    fetch(`/api/launch-drafts/${encodeURIComponent(draftId)}/devnet`, { cache: "no-store" })
      .then(responseBody)
      .then((state) => {
        setDevnet(state);
        setRewardWallet(state.rewardWallet ?? "");
        setBurnWallet(state.burnWallet ?? "");
        if (state.status === "verified") {
          setPendingEvidence({ version: 2 });
        } else {
          const serverEvidence: PendingDevnetEvidence = {
            version: 2,
            creatorWallet: state.creatorWallet ?? undefined,
            metadataUri: state.metadataUri ?? undefined,
            rewardWallet: state.rewardWallet ?? undefined,
            burnWallet: state.burnWallet ?? undefined,
            mint: state.pendingMint ?? undefined,
            createSignature: state.pendingCreateSignature ?? undefined,
            createBlockhash: state.pendingCreateBlockhash ?? undefined,
            createLastValidBlockHeight: state.pendingCreateLastValidBlockHeight ?? undefined,
            feeSignature: state.pendingFeeSignature ?? undefined,
            feeBlockhash: state.pendingFeeBlockhash ?? undefined,
            feeLastValidBlockHeight: state.pendingFeeLastValidBlockHeight ?? undefined,
          };
          setPendingEvidence(serverEvidence);
        }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Devnet state could not be loaded."));
  }, [draftId]);

  async function post(action: Record<string, unknown>) {
    const response = await fetch(`/api/launch-drafts/${encodeURIComponent(draftId)}/devnet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    const state = await responseBody(response);
    setDevnet(state);
    return state;
  }

  async function runLaunch() {
    setBusy(true);
    setError("");
    try {
      if (!walletSession.wallet) throw new Error("Connect and verify a Solana wallet first.");
      let state = devnet;
      if (!state?.metadataUri && !publicationAccepted) {
        throw new Error("Confirm the public IPFS upload before starting the devnet launch.");
      }
      if (state?.creatorWallet && state.creatorWallet !== walletSession.wallet) {
        throw new Error("Reconnect the wallet that prepared and signed this devnet launch.");
      }
      if (
        !state?.metadataUri ||
        (!state.mint && (
          state.creatorWallet !== walletSession.wallet ||
          state.rewardWallet !== rewardWallet ||
          state.burnWallet !== burnWallet
        ))
      ) {
        setStatus("Preparing the Pump metadata and devnet recipients...");
        state = await post({ action: "prepare", rewardWallet, burnWallet, publicationAccepted });
      }
      if (!state?.metadataUri || !state.rewardWallet || !state.burnWallet) {
        throw new Error("The devnet launch configuration is incomplete.");
      }
      const evidenceContext = {
        creatorWallet: walletSession.wallet,
        metadataUri: state.metadataUri,
        rewardWallet: state.rewardWallet,
        burnWallet: state.burnWallet,
      };
      let pending = evidenceMatches(pendingEvidence, evidenceContext)
        ? pendingEvidence
        : { version: 2 as const, ...evidenceContext };
      const persistPending = (next: PendingDevnetEvidence) => {
        pending = next;
        setPendingEvidence(pending);
      };
      if (!state.mint || !state.createSignature) {
        if (!pending.mint || !pending.createSignature) {
          setStatus("Simulating the Pump devnet coin. Your wallet will ask for approval next.");
          const { createPumpDevnetCoin } = await import("@/lib/client/pump-devnet");
          await createPumpDevnetCoin({
            walletAddress: walletSession.wallet,
            name,
            symbol,
            metadataUri: state.metadataUri!,
            signTransaction: walletSession.signTransaction,
            onSubmitted: async ({ mint, signature, blockhash, lastValidBlockHeight }) => {
              state = await post({
                action: "record_create_submission",
                mint,
                signature,
                blockhash,
                lastValidBlockHeight,
              });
              persistPending({
                ...evidenceContext,
                ...pending,
                mint,
                createSignature: signature,
                createBlockhash: blockhash,
                createLastValidBlockHeight: lastValidBlockHeight,
              });
            },
          });
        }
        if (
          !pending.mint ||
          !pending.createSignature ||
          !pending.createBlockhash ||
          pending.createLastValidBlockHeight === undefined
        ) {
          throw new Error("The submitted coin transaction evidence is incomplete. Try again.");
        }
        setStatus("The Pump coin finalized. Verifying it independently...");
        try {
          state = await post({
            action: "confirm_create",
            mint: pending.mint,
            signature: pending.createSignature,
            blockhash: pending.createBlockhash,
            lastValidBlockHeight: pending.createLastValidBlockHeight,
          });
          persistPending({
            ...pending,
            mint: undefined,
            createSignature: undefined,
            createBlockhash: undefined,
            createLastValidBlockHeight: undefined,
          });
        } catch (caught) {
          if (caught instanceof DevnetActionError && (caught.txState === "failed" || caught.txState === "expired")) {
            persistPending({
              ...pending,
              mint: undefined,
              createSignature: undefined,
              createBlockhash: undefined,
              createLastValidBlockHeight: undefined,
            });
            throw new Error(`${caught.message} No draft record was changed. Click launch to build a fresh transaction.`);
          }
          throw caught;
        }
      }
      if (!state.feeSignature) {
        if (!pending.feeSignature) {
          setStatus("The coin exists on devnet. Approve the final immutable 80/20 fee split.");
          const { configurePumpDevnetFeeSplit } = await import("@/lib/client/pump-devnet");
          await configurePumpDevnetFeeSplit({
            walletAddress: walletSession.wallet,
            mintAddress: state.mint!,
            rewardWallet: state.rewardWallet!,
            burnWallet: state.burnWallet!,
            signTransaction: walletSession.signTransaction,
            onSubmitted: async ({ signature, blockhash, lastValidBlockHeight }) => {
              state = await post({
                action: "record_fee_submission",
                signature,
                blockhash,
                lastValidBlockHeight,
              });
              persistPending({
                ...evidenceContext,
                ...pending,
                feeSignature: signature,
                feeBlockhash: blockhash,
                feeLastValidBlockHeight: lastValidBlockHeight,
              });
            },
          });
        }
        if (!pending.feeSignature || !pending.feeBlockhash || pending.feeLastValidBlockHeight === undefined) {
          throw new Error("The submitted fee-lock transaction evidence is incomplete. Try again.");
        }
        setStatus("The fee split finalized. Verifying both recipients onchain...");
        try {
          state = await post({
            action: "confirm_fees",
            signature: pending.feeSignature,
            blockhash: pending.feeBlockhash,
            lastValidBlockHeight: pending.feeLastValidBlockHeight,
          });
          persistPending({ version: 2 });
        } catch (caught) {
          if (caught instanceof DevnetActionError && (caught.txState === "failed" || caught.txState === "expired")) {
            persistPending({
              ...pending,
              feeSignature: undefined,
              feeBlockhash: undefined,
              feeLastValidBlockHeight: undefined,
            });
            throw new Error(`${caught.message} No draft record was changed. Click again to build a fresh fee-lock transaction.`);
          }
          throw caught;
        }
      }
      setDevnet(state);
      setStatus("Pump devnet launch and immutable 80/20 creator-fee split verified.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The devnet launch stopped.");
    } finally {
      setBusy(false);
    }
  }

  const complete = devnet?.status === "verified";
  const started = Boolean(devnet?.mint);

  return (
    <section className="devnet-launch-panel" aria-labelledby="devnet-launch-title">
      <div className="devnet-launch-head">
        <span><FlaskConical /></span>
        <div>
          <p className="section-eyebrow">Solana devnet</p>
          <h3 id="devnet-launch-title">Test the real Pump launch path.</h3>
          <p>This creates a valueless devnet coin, then locks Pump creator fees to the two addresses below. It does not use Jupiter, buy Fan Tokens, or touch mainnet.</p>
        </div>
        <strong className="devnet-badge">DEVNET ONLY</strong>
      </div>

      <div className="devnet-wallet-state">
        <Wallet />
        <span>
          <small>Verified creator wallet</small>
          <strong>{walletSession.wallet || "Not verified"}</strong>
        </span>
        {!walletSession.wallet ? <Button onClick={walletSession.connectAndVerify} disabled={walletSession.busy}>{walletSession.busy ? "Waiting..." : "Connect and verify"}</Button> : null}
      </div>

      {!complete ? (
        <div className="devnet-recipient-grid">
          <label>
            80% reward treasury address
            <Input value={rewardWallet} disabled={started || busy} onChange={(event) => setRewardWallet(event.target.value.trim())} placeholder="Solana devnet public address" />
            <small>Receives 80% of Pump creator fees for the future Fan Token reward pipeline.</small>
          </label>
          <label>
            20% SPORTPAD treasury address
            <Input value={burnWallet} disabled={started || busy} onChange={(event) => setBurnWallet(event.target.value.trim())} placeholder="Different Solana devnet public address" />
            <small>Receives 20% for the future SPORTPAD buyback and burn executor.</small>
          </label>
        </div>
      ) : null}

      {!devnet?.metadataUri ? (
        <label className="devnet-consent">
          <input type="checkbox" checked={publicationAccepted} onChange={(event) => setPublicationAccepted(event.target.checked)} />
          <span><strong>Publish this token image and metadata to IPFS</strong><small>Pump metadata is public and may be permanent. Saving the private draft did not publish it; starting the devnet launch will.</small></span>
        </label>
      ) : null}

      <div className="devnet-lock-notice">
        <LockKeyhole />
        <p><strong>Check both public addresses carefully.</strong> Pump fee sharing can be configured once. SportPad never asks for either wallet&apos;s secret key.</p>
      </div>

      {devnet?.mint ? (
        <div className="devnet-evidence">
          <div><small>Pump devnet mint</small><code>{devnet.mint}</code><a href={explorerUrl(devnet.mint, "address")} target="_blank" rel="noopener noreferrer">Open mint <ExternalLink /></a></div>
          {devnet.createSignature ? <div><small>Coin creation</small><code>{devnet.createSignature}</code><a href={explorerUrl(devnet.createSignature, "tx")} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink /></a></div> : null}
          {devnet.feeSignature ? <div><small>80/20 fee lock</small><code>{devnet.feeSignature}</code><a href={explorerUrl(devnet.feeSignature, "tx")} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink /></a></div> : null}
        </div>
      ) : null}

      {complete ? <div className="devnet-complete"><CheckCircle2 /><span><strong>Onchain devnet verification complete</strong><small>Coin creation and the immutable 80/20 Pump creator-fee split are finalized and recorded.</small></span></div> : (
        <Button onClick={runLaunch} disabled={busy || !devnet || !walletSession.wallet || !rewardWallet || !burnWallet || (!devnet.metadataUri && !publicationAccepted)} className="devnet-launch-button">
          <ShieldCheck /> {busy ? "Working on devnet..." : started ? "Finish devnet fee split" : "Launch on Pump devnet"}
        </Button>
      )}
      {status ? <p className="devnet-status" role="status">{status}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
