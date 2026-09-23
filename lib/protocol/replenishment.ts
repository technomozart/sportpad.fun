import { PublicKey } from "@solana/web3.js";

// Public asset identifiers verified against LayerZero's token directory on
// 2026-09-23. Discovery is rechecked on every dry run; it is not a guarantee
// that a funded, executable quote exists at any later time.
export const REPLENISHMENT_ASSETS = {
  solanaChainKey: "solana",
  chilizChainKey: "chiliz",
  solanaChainId: 1,
  chilizChainId: 88_888,
  solMint: "So11111111111111111111111111111111111111112",
  solanaChzMint: "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw",
  solanaChzDecimals: 8,
  nativeChilizChz: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  nativeChilizChzDecimals: 18,
} as const;

const MAX_BRIDGE_FEE_PERCENT = 2;
const MIN_QUOTE_LIFETIME_MS = 30_000;
const MAX_QUOTE_LIFETIME_MS = 30 * 60_000;
const ALLOWED_ROUTE_TYPES = new Set(["OFT", "OFT_V2"]);

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} is not an array.`);
  return value;
}

function positiveAtomic(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${field} must be a positive atomic-unit integer.`);
  }
  return value;
}

export function validatePublicWallets(solanaWallet: string, chilizWallet: string) {
  let canonicalSolana: string;
  try {
    canonicalSolana = new PublicKey(solanaWallet).toBase58();
  } catch {
    throw new Error("A valid public Solana treasury address is required.");
  }
  if (canonicalSolana !== solanaWallet) throw new Error("Solana treasury address is not canonical.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(chilizWallet)) {
    throw new Error("A valid public Chiliz treasury address is required.");
  }
  return { solanaWallet: canonicalSolana, chilizWallet };
}

export function validatePositiveAtomic(value: string, field: string) {
  return positiveAtomic(value, field);
}

export function validateLayerZeroDiscovery(chainsPayload: unknown, tokensPayload: unknown, destinationsPayload: unknown) {
  const chains = array(record(chainsPayload, "LayerZero chains").chains, "LayerZero chains");
  const tokens = array(record(tokensPayload, "LayerZero tokens").tokens, "LayerZero tokens");
  const destinations = array(record(destinationsPayload, "LayerZero destinations").tokens, "LayerZero destinations");
  const chainPresent = (key: string, type: string, id: number) => chains.some((entry) => {
    const chain = record(entry, "LayerZero chain");
    return chain.chainKey === key && chain.chainType === type && chain.chainId === id;
  });
  if (!chainPresent(REPLENISHMENT_ASSETS.solanaChainKey, "SOLANA", REPLENISHMENT_ASSETS.solanaChainId)
      || !chainPresent(REPLENISHMENT_ASSETS.chilizChainKey, "EVM", REPLENISHMENT_ASSETS.chilizChainId)) {
    throw new Error("LayerZero no longer lists the expected Solana and Chiliz mainnets.");
  }
  const sourcePresent = tokens.some((entry) => {
    const token = record(entry, "LayerZero token");
    return token.chainKey === REPLENISHMENT_ASSETS.solanaChainKey
      && token.address === REPLENISHMENT_ASSETS.solanaChzMint
      && token.symbol === "CHZ"
      && token.decimals === REPLENISHMENT_ASSETS.solanaChzDecimals
      && token.isSupported === true;
  });
  const destinationPresent = destinations.some((entry) => {
    const token = record(entry, "LayerZero destination token");
    return token.chainKey === REPLENISHMENT_ASSETS.chilizChainKey
      && typeof token.address === "string"
      && token.address.toLowerCase() === REPLENISHMENT_ASSETS.nativeChilizChz.toLowerCase()
      && token.symbol === "CHZ"
      && token.decimals === REPLENISHMENT_ASSETS.nativeChilizChzDecimals
      && token.isSupported === true;
  });
  if (!sourcePresent || !destinationPresent) {
    throw new Error("LayerZero no longer lists the exact Solana CHZ to native Chiliz CHZ route.");
  }
  for (const payload of [tokensPayload, destinationsPayload]) {
    const pagination = record(payload, "LayerZero token directory").pagination;
    if (pagination !== undefined && record(pagination, "LayerZero pagination").nextToken) {
      // A partial directory could omit or conceal a conflicting asset record.
      throw new Error("LayerZero token directory is paginated; refuse an incomplete route check.");
    }
  }
  return {
    sourceMint: REPLENISHMENT_ASSETS.solanaChzMint,
    destinationToken: REPLENISHMENT_ASSETS.nativeChilizChz,
    sourceDecimals: REPLENISHMENT_ASSETS.solanaChzDecimals,
    destinationDecimals: REPLENISHMENT_ASSETS.nativeChilizChzDecimals,
  };
}

export function layerZeroQuoteRequest(amountAtomic: string, solanaWallet: string, chilizWallet: string) {
  positiveAtomic(amountAtomic, "CHZ bridge amount");
  validatePublicWallets(solanaWallet, chilizWallet);
  return {
    srcChainKey: REPLENISHMENT_ASSETS.solanaChainKey,
    dstChainKey: REPLENISHMENT_ASSETS.chilizChainKey,
    srcTokenAddress: REPLENISHMENT_ASSETS.solanaChzMint,
    dstTokenAddress: REPLENISHMENT_ASSETS.nativeChilizChz,
    srcWalletAddress: solanaWallet,
    dstWalletAddress: chilizWallet,
    amount: amountAtomic,
    options: { amountType: "EXACT_SRC_AMOUNT", feeTolerance: { type: "PERCENT", amount: 1 } },
  } as const;
}

export function validateLayerZeroQuote(payload: unknown, expectedAmountAtomic: string, nowMs = Date.now()) {
  positiveAtomic(expectedAmountAtomic, "expected CHZ bridge amount");
  const quotes = array(record(payload, "LayerZero quote response").quotes, "LayerZero quotes");
  const candidates = quotes.map((entry) => {
    const quote = record(entry, "LayerZero quote");
    const id = quote.id;
    if (typeof id !== "string" || id.length < 4 || id.length > 256) throw new Error("LayerZero quote has no valid ID.");
    const source = positiveAtomic(quote.srcAmount, "LayerZero source amount");
    const destination = positiveAtomic(quote.dstAmount, "LayerZero destination amount");
    const minimum = positiveAtomic(quote.dstAmountMin, "LayerZero minimum destination amount");
    if (source !== expectedAmountAtomic || BigInt(minimum) > BigInt(destination)) {
      throw new Error("LayerZero changed the exact bridge amount or minimum output.");
    }
    if (typeof quote.feePercent !== "string" && typeof quote.feePercent !== "number") {
      throw new Error("LayerZero quote has no bridge fee percentage.");
    }
    const feePercent = Number(quote.feePercent);
    if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > MAX_BRIDGE_FEE_PERCENT) {
      throw new Error("LayerZero bridge fee exceeds the SportPad safety limit.");
    }
    const parityAmount = BigInt(source) * 10n ** BigInt(REPLENISHMENT_ASSETS.nativeChilizChzDecimals - REPLENISHMENT_ASSETS.solanaChzDecimals);
    if (BigInt(minimum) > parityAmount || BigInt(minimum) * 100n < parityAmount * 95n) {
      throw new Error("LayerZero CHZ output is outside the approved 1:1 bridge range.");
    }
    const expiresAt = typeof quote.expiresAt === "string" ? Date.parse(quote.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt < nowMs + MIN_QUOTE_LIFETIME_MS || expiresAt > nowMs + MAX_QUOTE_LIFETIME_MS) {
      throw new Error("LayerZero quote has no acceptable expiry.");
    }
    const steps = array(quote.routeSteps, "LayerZero route steps");
    if (steps.length !== 1) throw new Error("Only direct one-step CHZ OFT routes are permitted.");
    const step = record(steps[0], "LayerZero route step");
    if (!ALLOWED_ROUTE_TYPES.has(String(step.type)) || step.srcChainKey !== REPLENISHMENT_ASSETS.solanaChainKey) {
      throw new Error("LayerZero returned an unapproved bridge route.");
    }
    return {
      quoteId: id,
      sourceAmountAtomic: source,
      destinationAmountAtomic: destination,
      minimumDestinationAmountAtomic: minimum,
      feePercent,
      expiresAt: new Date(expiresAt).toISOString(),
      routeType: String(step.type),
    };
  });
  if (candidates.length === 0) throw new Error("LayerZero returned no executable CHZ bridge quote.");
  return candidates.sort((a, b) => {
    const first = BigInt(a.minimumDestinationAmountAtomic);
    const second = BigInt(b.minimumDestinationAmountAtomic);
    return first === second ? 0 : first > second ? -1 : 1;
  })[0];
}

export type ReplenishmentJournalState =
  | "planned"
  | "swap_broadcast_unknown"
  | "swap_confirmed"
  | "bridge_broadcast_unknown"
  | "bridge_succeeded"
  | "manual_review";

// Intended recovery rules for a future durable ledger. Unknown broadcast
// states are NEVER automatically retried: query signatures, balances and the
// LayerZero status endpoint, then reconcile before creating another spend.
export function automaticReplenishmentNextAction(state: ReplenishmentJournalState) {
  switch (state) {
    case "planned": return "quote_only";
    case "swap_confirmed": return "reconcile_chz_balance_before_bridge_quote";
    case "swap_broadcast_unknown":
    case "bridge_broadcast_unknown": return "manual_reconcile_no_retry";
    case "bridge_succeeded": return "complete";
    case "manual_review": return "manual_reconcile_no_retry";
    default: throw new Error("Unknown replenishment journal state; do not retry.");
  }
}
