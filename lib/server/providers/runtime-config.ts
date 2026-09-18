import "server-only";

import { env } from "cloudflare:workers";

import type { ProviderCredentials } from "./types";

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

export function readProviderCredentials(): ProviderCredentials {
  // Cloudflare bindings are authoritative in production. process.env is a
  // server-only fallback for the ignored `.env.local` development file.
  return {
    heliusApiKey: firstNonEmpty(env.HELIUS_API_KEY, process.env.HELIUS_API_KEY),
    jupiterApiKey: firstNonEmpty(env.JUPITER_API_KEY, process.env.JUPITER_API_KEY),
  };
}
