import { readProviderCredentials } from "@/lib/server/providers/runtime-config";
import { getProviderStatus } from "@/lib/server/providers/status";

type Providers = Awaited<ReturnType<typeof getProviderStatus>>;

const PROVIDER_CACHE_MS = 30_000;
let providerCache: { value: Providers; expiresAt: number } | null = null;
let providerCheckInFlight: Promise<Providers> | null = null;

async function readCachedProviderStatus() {
  const now = Date.now();
  if (providerCache && providerCache.expiresAt > now) return providerCache.value;

  providerCheckInFlight ??= getProviderStatus(readProviderCredentials());
  try {
    const value = await providerCheckInFlight;
    providerCache = { value, expiresAt: now + PROVIDER_CACHE_MS };
    return value;
  } finally {
    providerCheckInFlight = null;
  }
}

export async function GET() {
  const providers = await readCachedProviderStatus();
  const configuredCount = Number(providers.helius.configured) + Number(providers.jupiter.configured);
  const healthyCount = Number(providers.helius.healthy) + Number(providers.jupiter.healthy);

  const status = configuredCount === 0
    ? "configuration_required"
    : healthyCount === 2
      ? "ok"
      : "degraded";

  return Response.json(
    {
      status,
      mode: "private-prototype",
      providers,
      // Deliberately hard-locked. Provider credentials enable read-only canaries only.
      mainnetExecution: false,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=15, stale-while-revalidate=30",
      },
    },
  );
}
