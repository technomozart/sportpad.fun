import { env } from "cloudflare:workers";

import { PUBLICATION_MODES, type PublicationMode } from "@/lib/protocol/moderation";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";

export function getPublicationMode(): PublicationMode {
  const value = env.SPORTPAD_PUBLICATION_MODE?.trim().toLowerCase();
  return (PUBLICATION_MODES as readonly string[]).includes(value ?? "")
    ? value as PublicationMode
    : "closed";
}

export function isOperatorUserId(userId: string | null | undefined) {
  if (!userId) return false;
  const configured = env.SPORTPAD_OPERATOR_USER_IDS?.split(",")
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9:_-]{1,128}$/.test(value)) ?? [];
  return configured.includes(userId);
}

export function isOperatorRequest(request: Request) {
  return isOperatorUserId(getLaunchDraftOwner(request));
}

export function isOperatorSelfReviewEnabled() {
  return env.SPORTPAD_ALLOW_SELF_REVIEW?.trim().toLowerCase() === "true";
}
