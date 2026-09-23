import { and, eq, isNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { getDb } from "@/db";
import { devnetSubmissions, launchDrafts } from "@/db/schema";
import { isUuidV4 } from "@/lib/protocol/identifiers";
import {
  normalizeTransactionSignature,
  validateDevnetRecipients,
} from "@/lib/protocol/devnet-launch";
import { normalizeSolanaAddress } from "@/lib/protocol/wallet-auth";
import { canPrepareDevnet } from "@/lib/protocol/moderation";
import { uploadPumpMetadata } from "@/lib/server/pump-metadata";
import {
  isDevnetTransactionStateError,
  validateDevnetSubmissionWindow,
  verifyPumpDevnetCreate,
  verifyPumpDevnetFeeSplit,
} from "@/lib/server/solana/devnet";
import { getAuthenticatedDraftOwner, getVerifiedWalletSession } from "@/lib/server/wallet-session";
import { commitModerationTransition } from "@/lib/server/moderation-transition";
import { getPublicationMode, isOperatorUserId } from "@/lib/server/publication-policy";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";

type DevnetRouteContext = { params: Promise<{ id: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare"),
    rewardWallet: z.string().max(44),
    burnWallet: z.string().max(44),
    publicationAccepted: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("record_create_submission"),
    mint: z.string().max(44),
    signature: z.string().max(96),
    blockhash: z.string().max(44),
    lastValidBlockHeight: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    action: z.literal("record_fee_submission"),
    signature: z.string().max(96),
    blockhash: z.string().max(44),
    lastValidBlockHeight: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    action: z.literal("confirm_create"),
    mint: z.string().max(44),
    signature: z.string().max(96),
    blockhash: z.string().max(44),
    lastValidBlockHeight: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    action: z.literal("confirm_fees"),
    signature: z.string().max(96),
    blockhash: z.string().max(44),
    lastValidBlockHeight: z.number().int().nonnegative(),
  }).strict(),
]);

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

type DevnetSubmission = typeof devnetSubmissions.$inferSelect;

function serializeDevnetState(
  draft: typeof launchDrafts.$inferSelect,
  submissions: DevnetSubmission[] = [],
) {
  const pendingCreate = submissions.find((submission) => submission.kind === "create" && ["recorded", "verified"].includes(submission.status));
  const pendingFee = submissions.find((submission) => submission.kind === "fee" && ["recorded", "verified"].includes(submission.status));
  const frozenSubmission = pendingFee ?? pendingCreate;
  const isPublished = draft.status === "devnet_published" && Boolean(draft.devnetPublishedAt);
  return {
    draftId: draft.id,
    chain: "solana:devnet",
    creatorWallet: frozenSubmission?.creatorWallet ?? draft.creatorWallet,
    metadataUri: frozenSubmission?.metadataUri ?? draft.devnetMetadataUri,
    mint: draft.devnetMint,
    createSignature: draft.devnetCreateSignature,
    feeSignature: draft.devnetFeeSignature,
    rewardWallet: frozenSubmission?.rewardWallet ?? draft.devnetRewardWallet,
    burnWallet: frozenSubmission?.burnWallet ?? draft.devnetBurnWallet,
    verifiedAt: draft.devnetVerifiedAt,
    publishedAt: draft.devnetPublishedAt,
    moderationVersion: draft.moderationVersion,
    publicPath: isPublished ? `/launches/${encodeURIComponent(draft.id)}` : null,
    pendingMint: pendingCreate?.mint ?? null,
    pendingCreateSignature: pendingCreate?.signature ?? null,
    pendingCreateBlockhash: pendingCreate?.blockhash ?? null,
    pendingCreateLastValidBlockHeight: pendingCreate?.lastValidBlockHeight ?? null,
    pendingFeeSignature: pendingFee?.signature ?? null,
    pendingFeeBlockhash: pendingFee?.blockhash ?? null,
    pendingFeeLastValidBlockHeight: pendingFee?.lastValidBlockHeight ?? null,
    status: isPublished ? "published" : draft.status === "receipt_review" ? "review_pending" : draft.devnetVerifiedAt ? "verified" : draft.devnetCreateSignature ? "coin_created" : draft.devnetMetadataUri ? "prepared" : "not_started",
  };
}

async function ownerDraft(id: string, ownerUserId: string) {
  const [draft] = await getDb().select().from(launchDrafts).where(and(
    eq(launchDrafts.id, id),
    eq(launchDrafts.ownerUserId, ownerUserId),
  )).limit(1);
  return draft ?? null;
}

async function draftSubmissions(id: string, ownerUserId: string) {
  return getDb().select().from(devnetSubmissions).where(and(
    eq(devnetSubmissions.draftId, id),
    eq(devnetSubmissions.ownerUserId, ownerUserId),
  ));
}

class DevnetConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevnetConflictError";
  }
}

type SubmissionValues = {
  draftId: string;
  ownerUserId: string;
  kind: "create" | "fee";
  mint: string;
  creatorWallet: string;
  metadataUri: string;
  rewardWallet: string;
  burnWallet: string;
  tokenName: string;
  tokenSymbol: string;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

function sameSubmission(submission: DevnetSubmission, values: SubmissionValues) {
  return submission.draftId === values.draftId &&
    submission.ownerUserId === values.ownerUserId &&
    submission.kind === values.kind &&
    submission.mint === values.mint &&
    submission.creatorWallet === values.creatorWallet &&
    submission.metadataUri === values.metadataUri &&
    submission.rewardWallet === values.rewardWallet &&
    submission.burnWallet === values.burnWallet &&
    submission.tokenName === values.tokenName &&
    submission.tokenSymbol === values.tokenSymbol &&
    submission.signature === values.signature &&
    submission.blockhash === values.blockhash &&
    submission.lastValidBlockHeight === values.lastValidBlockHeight;
}

function exactSubmissionWhere(submission: DevnetSubmission, status: string) {
  return and(
    eq(devnetSubmissions.id, submission.id),
    eq(devnetSubmissions.status, status),
    eq(devnetSubmissions.mint, submission.mint),
    eq(devnetSubmissions.creatorWallet, submission.creatorWallet),
    eq(devnetSubmissions.metadataUri, submission.metadataUri),
    eq(devnetSubmissions.rewardWallet, submission.rewardWallet),
    eq(devnetSubmissions.burnWallet, submission.burnWallet),
    eq(devnetSubmissions.tokenName, submission.tokenName),
    eq(devnetSubmissions.tokenSymbol, submission.tokenSymbol),
    eq(devnetSubmissions.signature, submission.signature),
    eq(devnetSubmissions.blockhash, submission.blockhash),
    eq(devnetSubmissions.lastValidBlockHeight, submission.lastValidBlockHeight),
    submission.invalidBlockhashObservedAt === null
      ? isNull(devnetSubmissions.invalidBlockhashObservedAt)
      : eq(devnetSubmissions.invalidBlockhashObservedAt, submission.invalidBlockhashObservedAt),
  );
}

async function recordSubmission(values: SubmissionValues) {
  const db = getDb();
  const [existing] = await db.select().from(devnetSubmissions).where(and(
    eq(devnetSubmissions.draftId, values.draftId),
    eq(devnetSubmissions.kind, values.kind),
  )).limit(1);
  if (existing && sameSubmission(existing, values) && ["recorded", "verified"].includes(existing.status)) return existing;
  if (existing && !["failed", "expired"].includes(existing.status)) {
    throw new DevnetConflictError(`Another ${values.kind} transaction is already recorded for this draft.`);
  }

  const now = Date.now();
  if (existing) {
    try {
      const [updated] = await db.update(devnetSubmissions).set({
        mint: values.mint,
        creatorWallet: values.creatorWallet,
        metadataUri: values.metadataUri,
        rewardWallet: values.rewardWallet,
        burnWallet: values.burnWallet,
        tokenName: values.tokenName,
        tokenSymbol: values.tokenSymbol,
        signature: values.signature,
        blockhash: values.blockhash,
        lastValidBlockHeight: values.lastValidBlockHeight,
        status: "recorded",
        verifiedSlot: null,
        invalidBlockhashObservedAt: null,
        updatedAt: now,
      }).where(exactSubmissionWhere(existing, existing.status)).returning();
      if (updated) return updated;
    } catch {
      throw new DevnetConflictError(`That ${values.kind} mint or signature is already attached to another launch.`);
    }
    throw new DevnetConflictError(`Another ${values.kind} transaction was recorded first.`);
  }

  try {
    const [inserted] = await db.insert(devnetSubmissions).values({
      id: crypto.randomUUID(),
      ...values,
      status: "recorded",
      verifiedSlot: null,
      invalidBlockhashObservedAt: null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return inserted;
  } catch {
    const [raced] = await db.select().from(devnetSubmissions).where(and(
      eq(devnetSubmissions.draftId, values.draftId),
      eq(devnetSubmissions.kind, values.kind),
    )).limit(1);
    if (raced && sameSubmission(raced, values) && ["recorded", "verified"].includes(raced.status)) return raced;
    throw new DevnetConflictError(`That ${values.kind} mint or signature is already attached to another launch.`);
  }
}

function logFailure(event: string, error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  console.error(event, message.replace(/api-key=[^&\s]+/gi, "api-key=[redacted]"));
}

export async function GET(request: Request, context: DevnetRouteContext) {
  const ownerUserId = await getAuthenticatedDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Connect and verify a Solana wallet to access this draft." }, 401);
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);
  try {
    const draft = await ownerDraft(id, ownerUserId);
    if (!draft) return privateJson({ error: "Draft not found." }, 404);
    return privateJson({ devnet: serializeDevnetState(draft, await draftSubmissions(id, ownerUserId)) });
  } catch (error) {
    logFailure("devnet_state_get_failed", error);
    return privateJson({ error: "Devnet launch state is temporarily unavailable." }, 503);
  }
}

export async function POST(request: Request, context: DevnetRouteContext) {
  const ownerUserId = await getAuthenticatedDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Connect and verify a Solana wallet to access this draft." }, 401);
  const session = await getVerifiedWalletSession(request).catch(() => null);
  if (!session || session.ownerUserId !== ownerUserId) {
    return privateJson({ error: "Verify a Solana wallet before using the devnet launcher." }, 401);
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== url.origin) return privateJson({ error: "Cross-origin launch requests are not allowed." }, 403);
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);

  let input: z.infer<typeof actionSchema>;
  try {
    input = actionSchema.parse(await request.json());
  } catch {
    return privateJson({ error: "Invalid devnet launch request." }, 400);
  }

  try {
    const draft = await ownerDraft(id, ownerUserId);
    if (!draft) return privateJson({ error: "Draft not found." }, 404);

    if (input.action === "prepare") {
      const publicationMode = getPublicationMode();
      if (!canPrepareDevnet(draft.status, publicationMode, isOperatorUserId(ownerUserId))) {
        return privateJson({
          error: publicationMode === "closed"
            ? "Devnet preparation is paused. No image or metadata was published."
            : "Content review must be approved before anything is uploaded to IPFS or sent to Pump.",
        }, 409);
      }
      const activeCreate = (await draftSubmissions(id, ownerUserId)).find(
        (submission) => submission.kind === "create" && ["recorded", "verified"].includes(submission.status),
      );
      if (activeCreate) {
        throw new DevnetConflictError("The signed coin transaction has already frozen this launch configuration.");
      }
      if (!env.BUCKET || !draft.imageKey || !draft.imageMime) {
        return privateJson({ error: "The draft image is unavailable." }, 409);
      }
      const recipients = validateDevnetRecipients(input.rewardWallet, input.burnWallet, session.walletAddress);
      if (!recipients.ok) return privateJson({ error: recipients.error }, 400);
      if (draft.devnetMint && draft.creatorWallet !== session.walletAddress) {
        return privateJson({ error: "This devnet mint belongs to the wallet that created it. Reconnect that wallet to continue." }, 409);
      }
      if (draft.devnetMint && (
        draft.devnetRewardWallet !== recipients.rewardWallet ||
        draft.devnetBurnWallet !== recipients.burnWallet
      )) {
        return privateJson({ error: "Recipients cannot change after the Pump coin is created." }, 409);
      }
      if (
        draft.devnetMetadataUri &&
        draft.creatorWallet === session.walletAddress &&
        draft.devnetRewardWallet === recipients.rewardWallet &&
        draft.devnetBurnWallet === recipients.burnWallet
      ) {
        return privateJson({ devnet: serializeDevnetState(draft, await draftSubmissions(id, ownerUserId)) });
      }
      let metadataUri = draft.devnetMetadataUri;
      if (!metadataUri) {
        if (!input.publicationAccepted) {
          return privateJson({ error: "Confirm the public IPFS upload before preparing this launch." }, 409);
        }
        const limitSubject = `${ownerUserId}:${session.walletAddress}`;
        const hourly = await consumeFixedWindow({ scope: "ipfs_prepare_hour", subject: limitSubject, limit: 5, windowSeconds: 3_600 });
        if (!hourly.allowed) return rateLimitedJson("Devnet preparation limit reached. Try again later.", hourly);
        const daily = await consumeFixedWindow({ scope: "ipfs_prepare_day", subject: limitSubject, limit: 3, windowSeconds: 86_400 });
        if (!daily.allowed) return rateLimitedJson("Daily devnet preparation limit reached. Try again tomorrow.", daily);
        const image = await env.BUCKET.get(draft.imageKey);
        if (!image) return privateJson({ error: "The draft image is unavailable." }, 409);
        metadataUri = await uploadPumpMetadata({
          image: await image.arrayBuffer(),
          imageMime: draft.imageMime,
          name: draft.name,
          symbol: draft.symbol,
          description: draft.description,
          website: draft.website,
          social: draft.social,
        });
      }
      const [updated] = await getDb().update(launchDrafts).set({
        creatorWallet: session.walletAddress,
        devnetMetadataUri: metadataUri,
        devnetRewardWallet: recipients.rewardWallet,
        devnetBurnWallet: recipients.burnWallet,
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(launchDrafts.id, id),
        eq(launchDrafts.ownerUserId, ownerUserId),
        isNull(launchDrafts.devnetMint),
        isNull(launchDrafts.devnetCreateSignature),
        draft.creatorWallet === null
          ? isNull(launchDrafts.creatorWallet)
          : eq(launchDrafts.creatorWallet, draft.creatorWallet),
        draft.devnetMetadataUri === null
          ? isNull(launchDrafts.devnetMetadataUri)
          : eq(launchDrafts.devnetMetadataUri, draft.devnetMetadataUri),
        draft.devnetRewardWallet === null
          ? isNull(launchDrafts.devnetRewardWallet)
          : eq(launchDrafts.devnetRewardWallet, draft.devnetRewardWallet),
        draft.devnetBurnWallet === null
          ? isNull(launchDrafts.devnetBurnWallet)
          : eq(launchDrafts.devnetBurnWallet, draft.devnetBurnWallet),
      )).returning();
      if (!updated) {
        const current = await ownerDraft(id, ownerUserId);
        if (
          current &&
          !current.devnetMint &&
          !current.devnetCreateSignature &&
          current.devnetMetadataUri &&
          current.creatorWallet === session.walletAddress &&
          current.devnetRewardWallet === recipients.rewardWallet &&
          current.devnetBurnWallet === recipients.burnWallet
        ) {
          return privateJson({ devnet: serializeDevnetState(current, await draftSubmissions(id, ownerUserId)) });
        }
        throw new DevnetConflictError("The launch configuration changed in another tab. Reload before signing.");
      }
      return privateJson({ devnet: serializeDevnetState(updated, await draftSubmissions(id, ownerUserId)) });
    }

    if (input.action === "record_create_submission") {
      if (
        draft.creatorWallet !== session.walletAddress ||
        !draft.devnetMetadataUri ||
        !draft.devnetRewardWallet ||
        !draft.devnetBurnWallet
      ) {
        return privateJson({ error: "Prepare this draft with the verified wallet first." }, 409);
      }
      const mint = normalizeSolanaAddress(input.mint);
      const signature = normalizeTransactionSignature(input.signature);
      const blockhash = normalizeSolanaAddress(input.blockhash);
      if (!mint || !signature || !blockhash) {
        return privateJson({ error: "Invalid devnet mint, signature, or blockhash." }, 400);
      }
      if (draft.devnetMint || draft.devnetCreateSignature) {
        if (draft.devnetMint === mint && draft.devnetCreateSignature === signature) {
          return privateJson({ devnet: serializeDevnetState(draft, await draftSubmissions(id, ownerUserId)) });
        }
        throw new DevnetConflictError("This draft is already linked to another finalized devnet coin.");
      }
      if (!await validateDevnetSubmissionWindow({ blockhash, lastValidBlockHeight: input.lastValidBlockHeight })) {
        return privateJson({ error: "The signed devnet transaction uses an invalid or expired blockhash." }, 409);
      }
      await recordSubmission({
        draftId: id,
        ownerUserId,
        kind: "create",
        mint,
        creatorWallet: draft.creatorWallet,
        metadataUri: draft.devnetMetadataUri,
        rewardWallet: draft.devnetRewardWallet,
        burnWallet: draft.devnetBurnWallet,
        tokenName: draft.name,
        tokenSymbol: draft.symbol,
        signature,
        blockhash,
        lastValidBlockHeight: input.lastValidBlockHeight,
      });
      return privateJson({ devnet: serializeDevnetState(draft, await draftSubmissions(id, ownerUserId)) }, 201);
    }

    if (input.action === "record_fee_submission") {
      if (
        draft.creatorWallet !== session.walletAddress ||
        !draft.devnetMetadataUri ||
        !draft.devnetMint ||
        !draft.devnetCreateSignature ||
        !draft.devnetRewardWallet ||
        !draft.devnetBurnWallet
      ) {
        return privateJson({ error: "Confirm the Pump devnet coin before signing its fee split." }, 409);
      }
      const signature = normalizeTransactionSignature(input.signature);
      const blockhash = normalizeSolanaAddress(input.blockhash);
      if (!signature || !blockhash) {
        return privateJson({ error: "Invalid devnet fee-sharing signature or blockhash." }, 400);
      }
      if (draft.devnetFeeSignature) {
        if (draft.devnetFeeSignature === signature) {
          return privateJson({ devnet: serializeDevnetState(draft, await draftSubmissions(id, ownerUserId)) });
        }
        throw new DevnetConflictError("This draft already has another finalized fee-sharing transaction.");
      }
      if (!await validateDevnetSubmissionWindow({ blockhash, lastValidBlockHeight: input.lastValidBlockHeight })) {
        return privateJson({ error: "The signed fee transaction uses an invalid or expired blockhash." }, 409);
      }
      await recordSubmission({
        draftId: id,
        ownerUserId,
        kind: "fee",
        mint: draft.devnetMint,
        creatorWallet: draft.creatorWallet,
        metadataUri: draft.devnetMetadataUri,
        rewardWallet: draft.devnetRewardWallet,
        burnWallet: draft.devnetBurnWallet,
        tokenName: draft.name,
        tokenSymbol: draft.symbol,
        signature,
        blockhash,
        lastValidBlockHeight: input.lastValidBlockHeight,
      });
      return privateJson({ devnet: serializeDevnetState(draft, await draftSubmissions(id, ownerUserId)) }, 201);
    }

    if (input.action === "confirm_create") {
      const mint = normalizeSolanaAddress(input.mint);
      const signature = normalizeTransactionSignature(input.signature);
      const blockhash = normalizeSolanaAddress(input.blockhash);
      if (!mint || !signature || !blockhash) return privateJson({ error: "Invalid devnet mint, signature, or blockhash." }, 400);
      if (draft.devnetMint || draft.devnetCreateSignature) {
        if (draft.devnetMint === mint && draft.devnetCreateSignature === signature) {
          if (draft.creatorWallet !== session.walletAddress) {
            throw new DevnetConflictError("Reconnect the wallet that created this devnet coin.");
          }
          return privateJson({ devnet: serializeDevnetState(draft, await draftSubmissions(id, ownerUserId)) });
        }
        throw new DevnetConflictError("This draft is already linked to another devnet coin.");
      }
      const submissions = await draftSubmissions(id, ownerUserId);
      const recorded = submissions.find(
        (submission) => submission.kind === "create" && ["recorded", "verified"].includes(submission.status),
      );
      if (!recorded || recorded.creatorWallet !== session.walletAddress) {
        throw new DevnetConflictError("Reconnect the wallet that signed this recorded coin transaction.");
      }
      const values: SubmissionValues = {
        draftId: id,
        ownerUserId,
        kind: "create",
        mint,
        creatorWallet: recorded.creatorWallet,
        metadataUri: recorded.metadataUri,
        rewardWallet: recorded.rewardWallet,
        burnWallet: recorded.burnWallet,
        tokenName: recorded.tokenName,
        tokenSymbol: recorded.tokenSymbol,
        signature,
        blockhash,
        lastValidBlockHeight: input.lastValidBlockHeight,
      };
      if (!sameSubmission(recorded, values)) {
        throw new DevnetConflictError("Record this signed coin transaction before asking SportPad to verify it.");
      }
      let verifiedSlot = recorded.verifiedSlot;
      if (recorded.status === "recorded") {
        let verified: Awaited<ReturnType<typeof verifyPumpDevnetCreate>>;
        try {
          verified = await verifyPumpDevnetCreate({
            signature,
            mintAddress: mint,
            creatorWallet: recorded.creatorWallet,
            name: recorded.tokenName,
            symbol: recorded.tokenSymbol,
            metadataUri: recorded.metadataUri,
            blockhash,
            lastValidBlockHeight: input.lastValidBlockHeight,
            invalidBlockhashObservedAt: recorded.invalidBlockhashObservedAt,
          });
        } catch (error) {
          if (
            isDevnetTransactionStateError(error) &&
            error.blockhashInvalid &&
            recorded.invalidBlockhashObservedAt === null
          ) {
            await getDb().update(devnetSubmissions).set({
              invalidBlockhashObservedAt: Date.now(),
              updatedAt: Date.now(),
            }).where(exactSubmissionWhere(recorded, "recorded"));
          }
          if (isDevnetTransactionStateError(error) && (error.txState === "failed" || error.txState === "expired")) {
            await getDb().update(devnetSubmissions).set({
              status: error.txState,
              updatedAt: Date.now(),
            }).where(exactSubmissionWhere(recorded, "recorded"));
          }
          throw error;
        }
        const [claimed] = await getDb().update(devnetSubmissions).set({
          status: "verified",
          verifiedSlot: verified.slot,
          updatedAt: Date.now(),
        }).where(exactSubmissionWhere(recorded, "recorded")).returning();
        if (claimed) {
          verifiedSlot = claimed.verifiedSlot;
        } else {
          const [current] = await getDb().select().from(devnetSubmissions)
            .where(eq(devnetSubmissions.id, recorded.id)).limit(1);
          if (!current || current.status !== "verified" || !sameSubmission(current, values)) {
            throw new DevnetConflictError("A newer coin transaction replaced this verification attempt.");
          }
          verifiedSlot = current.verifiedSlot;
        }
      }
      if (verifiedSlot === null) throw new DevnetConflictError("The verified coin submission is missing its finalized slot.");
      const [updated] = await getDb().update(launchDrafts).set({
        creatorWallet: recorded.creatorWallet,
        devnetMetadataUri: recorded.metadataUri,
        devnetMint: mint,
        devnetCreateSignature: signature,
        devnetRewardWallet: recorded.rewardWallet,
        devnetBurnWallet: recorded.burnWallet,
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(launchDrafts.id, id),
        eq(launchDrafts.ownerUserId, ownerUserId),
        isNull(launchDrafts.devnetMint),
        isNull(launchDrafts.devnetCreateSignature),
      )).returning();
      if (!updated) {
        const current = await ownerDraft(id, ownerUserId);
        if (!current || current.devnetMint !== mint || current.devnetCreateSignature !== signature) {
          throw new DevnetConflictError("Another devnet coin was finalized for this draft first.");
        }
      }
      const finalDraft = updated ?? await ownerDraft(id, ownerUserId);
      if (!finalDraft) throw new DevnetConflictError("The devnet draft disappeared during verification.");
      return privateJson({
        devnet: serializeDevnetState(finalDraft, await draftSubmissions(id, ownerUserId)),
        slot: verifiedSlot,
      });
    }

    if (!draft.devnetMint || !draft.devnetCreateSignature || !draft.devnetRewardWallet || !draft.devnetBurnWallet) {
      return privateJson({ error: "Confirm the Pump devnet coin before locking fee sharing." }, 409);
    }
    const signature = normalizeTransactionSignature(input.signature);
    const blockhash = normalizeSolanaAddress(input.blockhash);
    if (!signature || !blockhash) return privateJson({ error: "Invalid devnet fee-sharing signature or blockhash." }, 400);
    if (draft.devnetFeeSignature) {
      if (draft.devnetFeeSignature === signature) {
        if (draft.creatorWallet !== session.walletAddress) {
          throw new DevnetConflictError("Reconnect the wallet that finalized this devnet fee split.");
        }
        return privateJson({ devnet: serializeDevnetState(draft, await draftSubmissions(id, ownerUserId)) });
      }
      throw new DevnetConflictError("This draft already has another finalized fee-sharing transaction.");
    }
    const submissions = await draftSubmissions(id, ownerUserId);
    const recorded = submissions.find(
      (submission) => submission.kind === "fee" && ["recorded", "verified"].includes(submission.status),
    );
    if (!recorded || recorded.creatorWallet !== session.walletAddress) {
      throw new DevnetConflictError("Reconnect the wallet that signed this recorded fee transaction.");
    }
    const values: SubmissionValues = {
      draftId: id,
      ownerUserId,
      kind: "fee",
      mint: draft.devnetMint,
      creatorWallet: recorded.creatorWallet,
      metadataUri: recorded.metadataUri,
      rewardWallet: recorded.rewardWallet,
      burnWallet: recorded.burnWallet,
      tokenName: recorded.tokenName,
      tokenSymbol: recorded.tokenSymbol,
      signature,
      blockhash,
      lastValidBlockHeight: input.lastValidBlockHeight,
    };
    if (!sameSubmission(recorded, values)) {
      throw new DevnetConflictError("Record this signed fee transaction before asking SportPad to verify it.");
    }
    let verifiedSlot = recorded.verifiedSlot;
    let sharingConfig: string | undefined;
    if (recorded.status === "recorded") {
      let verified: Awaited<ReturnType<typeof verifyPumpDevnetFeeSplit>>;
      try {
        verified = await verifyPumpDevnetFeeSplit({
          signature,
          mintAddress: recorded.mint,
          creatorWallet: recorded.creatorWallet,
          rewardWallet: recorded.rewardWallet,
          burnWallet: recorded.burnWallet,
          blockhash,
          lastValidBlockHeight: input.lastValidBlockHeight,
          invalidBlockhashObservedAt: recorded.invalidBlockhashObservedAt,
        });
      } catch (error) {
        if (
          isDevnetTransactionStateError(error) &&
          error.blockhashInvalid &&
          recorded.invalidBlockhashObservedAt === null
        ) {
          await getDb().update(devnetSubmissions).set({
            invalidBlockhashObservedAt: Date.now(),
            updatedAt: Date.now(),
          }).where(exactSubmissionWhere(recorded, "recorded"));
        }
        if (isDevnetTransactionStateError(error) && (error.txState === "failed" || error.txState === "expired")) {
          await getDb().update(devnetSubmissions).set({
            status: error.txState,
            updatedAt: Date.now(),
          }).where(exactSubmissionWhere(recorded, "recorded"));
        }
        throw error;
      }
      const [claimed] = await getDb().update(devnetSubmissions).set({
        status: "verified",
        verifiedSlot: verified.slot,
        updatedAt: Date.now(),
      }).where(exactSubmissionWhere(recorded, "recorded")).returning();
      if (claimed) {
        verifiedSlot = claimed.verifiedSlot;
        sharingConfig = verified.sharingConfig;
      } else {
        const [current] = await getDb().select().from(devnetSubmissions)
          .where(eq(devnetSubmissions.id, recorded.id)).limit(1);
        if (!current || current.status !== "verified" || !sameSubmission(current, values)) {
          throw new DevnetConflictError("A newer fee transaction replaced this verification attempt.");
        }
        verifiedSlot = current.verifiedSlot;
      }
    }
    if (verifiedSlot === null) throw new DevnetConflictError("The verified fee submission is missing its finalized slot.");
    const verifiedAt = new Date().toISOString();
    const updated = await commitModerationTransition({
      draftId: id,
      fromState: "content_approved",
      toState: "devnet_verified",
      expectedVersion: draft.moderationVersion,
      actorUserId: ownerUserId,
      actorRole: "creator",
      action: "verify_devnet",
      verifiedDevnet: {
        creatorWallet: recorded.creatorWallet,
        metadataUri: recorded.metadataUri,
        feeSignature: signature,
        rewardWallet: recorded.rewardWallet,
        burnWallet: recorded.burnWallet,
        verifiedAt,
      },
    });
    if (!updated) {
      const current = await ownerDraft(id, ownerUserId);
      if (!current || current.devnetFeeSignature !== signature) {
        throw new DevnetConflictError("Another fee-sharing transaction was finalized for this draft first.");
      }
    }
    const finalDraft = updated ?? await ownerDraft(id, ownerUserId);
    if (!finalDraft) throw new DevnetConflictError("The devnet draft disappeared during verification.");
    return privateJson({
      devnet: serializeDevnetState(finalDraft, await draftSubmissions(id, ownerUserId)),
      slot: verifiedSlot,
      sharingConfig,
    });
  } catch (error) {
    if (error instanceof DevnetConflictError) {
      return privateJson({ error: error.message }, 409);
    }
    if (isDevnetTransactionStateError(error)) {
      return privateJson({ error: error.message, txState: error.txState }, 409);
    }
    logFailure("devnet_launch_action_failed", error);
    return privateJson({ error: "The devnet action could not be verified. Check the wallet transaction and retry." }, 503);
  }
}
