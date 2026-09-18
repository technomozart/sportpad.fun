import "server-only";

import { checkHeliusHealth, checkJupiterQuote } from "./canaries";
import type { ProviderCredentials } from "./types";

export async function getProviderStatus(credentials: ProviderCredentials) {
  const [helius, jupiter] = await Promise.all([
    checkHeliusHealth(credentials.heliusApiKey),
    checkJupiterQuote(credentials.jupiterApiKey),
  ]);

  return { helius, jupiter };
}
