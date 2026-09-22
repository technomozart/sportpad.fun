import { and, eq, isNull, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { normalizeTransactionSignature } from "@/lib/protocol/devnet-launch";
import { isUuidV4 } from "@/lib/protocol/identifiers";
import { getRewardOption, type RewardChain } from "@/lib/protocol/reward-options";
import { normalizeSolanaAddress } from "@/lib/protocol/wallet-auth";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { uploadPumpMetadata } from "@/lib/server/pump-metadata";
import { checkRewardRoute } from "@/lib/server/providers/jupiter-reward-route";
import { checkChilizRewardRoute } from "@/lib/server/providers/chiliz-reward-route";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";
import {
  isDevnetTransactionStateError,
  verifyPumpMainnetCreate,
  verifyPumpMainnetFeeSplit,
} from "@/lib/server/solana/devnet";
import { getVerifiedWalletSession } from "@/lib/server/wallet-session";

type MainnetRouteContext = { params: Promise<{ id: string }> };

const evidenceSchema = z.object({
  signature: z.string().max(96),
  blockhash: z.string().max(44),
  lastValidBlockHeight: z.number().int().nonnegative(),
}).strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare"),
    publicationAccepted: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal("verify"),
    mint: z.string().max(44),
    create: evidenceSchema,
    fee: evidenceSchema,
  }).strict(),
]);

const MAINNET_ELIGIBLE_STATES = new Set([
  "content_approved",
  "devnet_verified",
  "receipt_review",
  "devnet_published",
]);

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function serializeMainnetState(draft: typeof launchDrafts.$inferSelect) {
  const config = readMainnetConfig();
  return {
    draftId: draft.id,
    chain: "solana:mainnet",
    enabled: config.enabled,
    ready: config.ready,
    missing: config.missing,
    rewardTreasury: config.rewardTreasury,
    buybackTreasury: config.buybackTreasury,
    sportpadMintConfigured: Boolean(config.sportpadMint),
    creatorWallet: draft.mainnetCreatorWallet,
    metadataUri: draft.mainnetMetadataUri,
    mint: draft.mainnetMint,
    createSignature: draft.mainnetCreateSignature,
    feeSignature: draft.mainnetFeeSignature,
    verifiedAt: draft.mainnetVerifiedAt,
    publicPath: draft.status === "mainnet_published" ? `/launches/${encodeURIComponent(draft.id)}` : null,
    status: draft.status === "mainnet_published"
      ? "published"
      : draft.mainnetMetadataUri
        ? "prepared"
        : "not_started",
  };
}

async function ownerDraft(id: string, ownerUserId: string) {
  const [draft] = await getDb().select().from(launchDrafts).where(and(
    eq(launchDrafts.id, id),
    eq(launchDrafts.ownerUserId, ownerUserId),
  )).limit(1);
  return draft ?? null;
}

function logFailure(event: string, error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  console.error(event, message.replace(/api-key=[^&\s]+/gi, "api-key=[redacted]"));
}

export async function GET(request: Request, context: MainnetRouteContext) {
  const ownerUserId = getLaunchDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Sign in is required." }, 401);
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);
  try {
    const draft = await ownerDraft(id, ownerUserId);
    if (!draft) return privateJson({ error: "Draft not found." }, 404);
    return privateJson({ mainnet: serializeMainnetState(draft) });
  } catch (error) {
    logFailure("mainnet_state_get_failed", error);
    return privateJson({ error: "Mainnet launch state is temporarily unavailable." }, 503);
  }
}

export async function POST(request: Request, context: MainnetRouteContext) {
  const ownerUserId = getLaunchDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Sign in is required." }, 401);
  const session = await getVerifiedWalletSession(request).catch(() => null);
  if (!session || session.ownerUserId !== ownerUserId) {
    return privateJson({ error: "Connect and verify the Solana wallet that will sign this mainnet launch." }, 401);
  }
  const requestUrl = new URL(request.url);
  if (request.headers.get("origin") !== requestUrl.origin) {
    return privateJson({ error: "Cross-origin launch requests are not allowed." }, 403);
  }
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);
  let input: z.infer<typeof actionSchema>;
  try { input = actionSchema.parse(await request.json()); }
  catch { return privateJson({ error: "Invalid mainnet launch request." }, 400); }

  try {
    const config = readMainnetConfig();
    if (!config.ready || !config.rewardTreasury || !config.buybackTreasury) {
      return privateJson({ error: `Mainnet launch is waiting for: ${config.missing.join(", ")}.` }, 409);
    }
    if (session.walletAddress === config.rewardTreasury || session.walletAddress === config.buybackTreasury) {
      return privateJson({ error: "The creator wallet must be different from both protocol treasury addresses." }, 409);
    }
    const draft = await ownerDraft(id, ownerUserId);
    if (!draft) return privateJson({ error: "Draft not found." }, 404);
    if (draft.status === "mainnet_published") {
      return privateJson({ mainnet: serializeMainnetState(draft) });
    }
    if (!MAINNET_ELIGIBLE_STATES.has(draft.status)) {
      return privateJson({ error: "Content approval is required before a mainnet launch." }, 409);
    }
    const rewardChain = draft.rewardChain as RewardChain;
    const rewardAsset = getRewardOption(rewardChain, draft.rewardSymbol);
    if (!rewardAsset || rewardAsset.tokenAddress.toLowerCase() !== draft.rewardMint?.toLowerCase()) {
      return privateJson({ error: "The approved reward token no longer matches the verified registry." }, 409);
    }
    if (input.action === "prepare") {
      const rewardRoute = rewardChain === "chiliz"
        ? await checkChilizRewardRoute(rewardAsset.wrappedTokenAddress!)
        : await checkRewardRoute(rewardAsset.tokenAddress);
      if (!rewardRoute.available) {
        return privateJson({ error: `${rewardAsset.symbol} does not have a live acquisition route on ${rewardAsset.venue} right now.` }, 409);
      }
      if (!env.BUCKET || !draft.imageKey || !draft.imageMime) {
        return privateJson({ error: "The approved token image is unavailable." }, 409);
      }
      if (draft.mainnetMetadataUri) {
        if (
          draft.mainnetCreatorWallet !== session.walletAddress ||
          draft.mainnetRewardTreasury !== config.rewardTreasury ||
          draft.mainnetBuybackTreasury !== config.buybackTreasury
        ) {
          return privateJson({ error: "The prepared mainnet configuration belongs to different wallets." }, 409);
        }
        return privateJson({ mainnet: serializeMainnetState(draft) });
      }
      const limitSubject = `${ownerUserId}:${session.walletAddress}`;
      const hourly = await consumeFixedWindow({ scope: "mainnet_prepare_hour", subject: limitSubject, limit: 3, windowSeconds: 3_600 });
      if (!hourly.allowed) return rateLimitedJson("Mainnet preparation limit reached. Try again later.", hourly);
      const daily = await consumeFixedWindow({ scope: "mainnet_prepare_day", subject: limitSubject, limit: 5, windowSeconds: 86_400 });
      if (!daily.allowed) return rateLimitedJson("Daily mainnet preparation limit reached. Try again tomorrow.", daily);
      const image = await env.BUCKET.get(draft.imageKey);
      if (!image) return privateJson({ error: "The approved token image is unavailable." }, 409);
      const metadataUri = await uploadPumpMetadata({
        image: await image.arrayBuffer(),
        imageMime: draft.imageMime,
        name: draft.name,
        symbol: draft.symbol,
        description: draft.description,
        website: draft.website,
        social: draft.social,
      });
      const [updated] = await getDb().update(launchDrafts).set({
        mainnetCreatorWallet: session.walletAddress,
        mainnetMetadataUri: metadataUri,
        mainnetRewardTreasury: config.rewardTreasury,
        mainnetBuybackTreasury: config.buybackTreasury,
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(launchDrafts.id, id),
        eq(launchDrafts.ownerUserId, ownerUserId),
        isNull(launchDrafts.mainnetMetadataUri),
        isNull(launchDrafts.mainnetMint),
      )).returning();
      if (!updated) return privateJson({ error: "The launch changed in another tab. Reload before signing." }, 409);
      return privateJson({ mainnet: serializeMainnetState(updated) });
    }

    // Verification must never be blocked by a route disappearing after the
    // creator has already signed irreversible mainnet transactions. The route
    // is checked immediately before signing through the prepare action above.
    if (
      !draft.mainnetMetadataUri ||
      draft.mainnetCreatorWallet !== session.walletAddress ||
      draft.mainnetRewardTreasury !== config.rewardTreasury ||
      draft.mainnetBuybackTreasury !== config.buybackTreasury
    ) {
      return privateJson({ error: "Prepare the exact mainnet launch configuration before signing." }, 409);
    }
    const mint = normalizeSolanaAddress(input.mint);
    const createSignature = normalizeTransactionSignature(input.create.signature);
    const feeSignature = normalizeTransactionSignature(input.fee.signature);
    const createBlockhash = normalizeSolanaAddress(input.create.blockhash);
    const feeBlockhash = normalizeSolanaAddress(input.fee.blockhash);
    if (!mint || !createSignature || !feeSignature || !createBlockhash || !feeBlockhash) {
      return privateJson({ error: "The mainnet transaction evidence is invalid." }, 400);
    }
    const createReceipt = await verifyPumpMainnetCreate({
      signature: createSignature,
      mintAddress: mint,
      creatorWallet: session.walletAddress,
      name: draft.name,
      symbol: draft.symbol,
      metadataUri: draft.mainnetMetadataUri,
      blockhash: createBlockhash,
      lastValidBlockHeight: input.create.lastValidBlockHeight,
      invalidBlockhashObservedAt: null,
    });
    const feeReceipt = await verifyPumpMainnetFeeSplit({
      signature: feeSignature,
      mintAddress: mint,
      creatorWallet: session.walletAddress,
      rewardWallet: config.rewardTreasury,
      burnWallet: config.buybackTreasury,
      blockhash: feeBlockhash,
      lastValidBlockHeight: input.fee.lastValidBlockHeight,
      invalidBlockhashObservedAt: null,
    });
    const now = new Date().toISOString();
    const [updated] = await getDb().update(launchDrafts).set({
      mainnetMint: mint,
      mainnetCreateSignature: createSignature,
      mainnetFeeSignature: feeSignature,
      mainnetCreateSlot: createReceipt.slot,
      mainnetFeeSlot: feeReceipt.slot,
      mainnetVerifiedAt: now,
      status: "mainnet_published",
      moderationVersion: sql`${launchDrafts.moderationVersion} + 1`,
      moderationReviewedAt: now,
      moderationActorUserId: ownerUserId,
      moderationActorRole: "system",
      moderationAction: "verify_mainnet",
      moderationReason: "approved",
      moderationOwnerMessage: `Mainnet launch verified at slots ${createReceipt.slot} and ${feeReceipt.slot}.`,
      updatedAt: now,
    }).where(and(
      eq(launchDrafts.id, id),
      eq(launchDrafts.ownerUserId, ownerUserId),
      isNull(launchDrafts.mainnetMint),
      eq(launchDrafts.mainnetMetadataUri, draft.mainnetMetadataUri),
      eq(launchDrafts.mainnetCreatorWallet, session.walletAddress),
    )).returning();
    if (!updated) return privateJson({ error: "Another mainnet receipt was recorded first." }, 409);
    return privateJson({ mainnet: serializeMainnetState(updated) }, 201);
  } catch (error) {
    if (isDevnetTransactionStateError(error)) {
      return privateJson({ error: error.message, txState: error.txState }, error.txState === "pending" ? 409 : 422);
    }
    logFailure("mainnet_launch_action_failed", error);
    return privateJson({ error: "The mainnet launch could not be verified. No new transaction was created by the server." }, 503);
  }
}
