import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  REPLENISHMENT_ASSETS,
  layerZeroQuoteRequest,
  validateLayerZeroDiscovery,
  validateLayerZeroQuote,
  validatePositiveAtomic,
  validatePublicWallets,
} from "../../protocol/replenishment.ts";

/**
 * Read-only preparation for the exact Solana CHZ -> native Chiliz CHZ route.
 * This module has no signer, RPC sender, or authority to release funds. A
 * provider-built transaction is never safe to sign solely because its envelope
 * passes these checks: instruction effects and on-chain balances need a
 * separate validator using an actual production-key route fixture.
 *
 * API: https://docs.layerzero.network/v2/developers/value-transfer-api/api-reference/overview
 */
const API_BASE = "https://transfer.layerzero-api.com/v1";
const MAX_CANARY_CHZ_ATOMIC = 10n * 10n ** 8n;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_SOLANA_TRANSACTION_BYTES = 1_232;

type JsonObject = Record<string, unknown>;
type FetchLike = typeof fetch;

export type ExactChzBridgeQuote = ReturnType<typeof validateLayerZeroQuote> & {
  readonly sourceSolanaWallet: string;
  readonly destinationChilizWallet: string;
  readonly sourceMint: typeof REPLENISHMENT_ASSETS.solanaChzMint;
  readonly destinationToken: typeof REPLENISHMENT_ASSETS.nativeChilizChz;
  readonly executionReady: false;
};

export type UntrustedSolanaBridgeStep = {
  readonly messageSha256: string;
  readonly programIds: readonly string[];
  readonly recentBlockhash: string;
  readonly signerAddress: string;
  readonly instructionEffectsVerified: false;
  readonly blockhashFreshnessVerified: false;
  readonly executionReady: false;
};

export type ExactChzBridgeStatus = {
  readonly status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
  readonly sourceSignature: string | null;
  readonly destinationTransactionHash: string | null;
  /** A provider status is not an on-chain receipt or a treasury balance proof. */
  readonly destinationReceiptVerified: false;
  readonly executionReady: false;
};

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as JsonObject;
}

function key(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1_024) {
    throw new Error("A production LayerZero Value Transfer API key is required.");
  }
  return value.trim();
}

function ensureCanaryAmount(amountAtomic: string): void {
  validatePositiveAtomic(amountAtomic, "bridge amount");
  if (BigInt(amountAtomic) > MAX_CANARY_CHZ_ATOMIC) {
    throw new Error("Bridge quote exceeds the ten CHZ preparation cap.");
  }
}

async function jsonRequest(fetchImpl: FetchLike, url: string, apiKey?: string, body?: JsonObject): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: body ? "POST" : "GET",
      headers: body ? {
        Accept: "application/json", "Content-Type": "application/json", "x-api-key": key(apiKey ?? ""),
      } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("LayerZero Value Transfer API request failed.");
  }
  if (!response.ok) throw new Error(`LayerZero Value Transfer API returned HTTP ${response.status}.`);
  const reportedLength = Number(response.headers.get("content-length") ?? "0");
  if (reportedLength > MAX_RESPONSE_BYTES) throw new Error("LayerZero response exceeds the size limit.");
  let content: string;
  try { content = await response.text(); }
  catch { throw new Error("LayerZero response could not be read."); }
  if (content.length > MAX_RESPONSE_BYTES) throw new Error("LayerZero response exceeds the size limit.");
  try { return JSON.parse(content) as unknown; }
  catch { throw new Error("LayerZero response is not JSON."); }
}

function matchingOptionalFields(raw: JsonObject, wallets: { solanaWallet: string; chilizWallet: string }): void {
  const expected: Record<string, string> = {
    srcChainKey: REPLENISHMENT_ASSETS.solanaChainKey,
    dstChainKey: REPLENISHMENT_ASSETS.chilizChainKey,
    srcTokenAddress: REPLENISHMENT_ASSETS.solanaChzMint,
    dstTokenAddress: REPLENISHMENT_ASSETS.nativeChilizChz,
    srcWalletAddress: wallets.solanaWallet,
    dstWalletAddress: wallets.chilizWallet,
  };
  for (const [field, value] of Object.entries(expected)) {
    const supplied = raw[field];
    if (supplied !== undefined && supplied !== value) {
      throw new Error(`LayerZero quote changed ${field}.`);
    }
  }
  const routeSteps = raw.routeSteps;
  if (!Array.isArray(routeSteps) || routeSteps.length !== 1) {
    throw new Error("LayerZero changed the direct CHZ route.");
  }
  const route = object(routeSteps[0], "LayerZero CHZ route");
  if (route.dstChainKey !== undefined && route.dstChainKey !== REPLENISHMENT_ASSETS.chilizChainKey) {
    throw new Error("LayerZero changed the destination chain.");
  }
  const options = raw.options;
  if (options !== undefined) {
    const nativeDrop = object(options, "LayerZero quote options").dstNativeDropAmount;
    if (nativeDrop !== undefined && nativeDrop !== "0") {
      throw new Error("LayerZero quote added an unapproved native drop.");
    }
  }
}

/** Discover the route again, then request one strictly bounded canary quote. */
export async function quoteExactChzBridge(input: {
  apiKey: string;
  amountAtomic: string;
  sourceSolanaWallet: string;
  destinationChilizWallet: string;
  fetchImpl?: FetchLike;
  nowMs?: number;
}): Promise<ExactChzBridgeQuote> {
  key(input.apiKey);
  ensureCanaryAmount(input.amountAtomic);
  const wallets = validatePublicWallets(input.sourceSolanaWallet, input.destinationChilizWallet);
  const fetchImpl = input.fetchImpl ?? fetch;
  const destinations = new URL(`${API_BASE}/tokens`);
  destinations.searchParams.set("transferrableFromChainKey", REPLENISHMENT_ASSETS.solanaChainKey);
  destinations.searchParams.set("transferrableFromTokenAddress", REPLENISHMENT_ASSETS.solanaChzMint);
  const [chains, tokens, reachable] = await Promise.all([
    jsonRequest(fetchImpl, `${API_BASE}/chains`),
    jsonRequest(fetchImpl, `${API_BASE}/tokens`),
    jsonRequest(fetchImpl, destinations.toString()),
  ]);
  validateLayerZeroDiscovery(chains, tokens, reachable);
  const payload = await jsonRequest(fetchImpl, `${API_BASE}/quotes`, input.apiKey,
    layerZeroQuoteRequest(input.amountAtomic, wallets.solanaWallet, wallets.chilizWallet));
  const quote = validateLayerZeroQuote(payload, input.amountAtomic, input.nowMs ?? Date.now());
  const candidates = object(payload, "LayerZero quote response").quotes;
  if (!Array.isArray(candidates)) throw new Error("LayerZero quote response is malformed.");
  const quoteIds = candidates.map((entry) => object(entry, "LayerZero quote").id);
  if (new Set(quoteIds).size !== quoteIds.length) {
    throw new Error("LayerZero returned duplicate quote IDs.");
  }
  const selected = candidates.find((entry) => object(entry, "LayerZero quote").id === quote.quoteId);
  matchingOptionalFields(object(selected, "Selected LayerZero quote"), wallets);
  return {
    ...quote,
    sourceSolanaWallet: wallets.solanaWallet,
    destinationChilizWallet: wallets.chilizWallet,
    sourceMint: REPLENISHMENT_ASSETS.solanaChzMint,
    destinationToken: REPLENISHMENT_ASSETS.nativeChilizChz,
    executionReady: false,
  };
}

function canonicalTransaction(encoded: unknown): VersionedTransaction {
  const fields = object(encoded, "LayerZero encoded transaction");
  if (fields.encoding !== "base64" || typeof fields.data !== "string" ||
      fields.data.length < 100 || fields.data.length > 1_700 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(fields.data)) {
    throw new Error("LayerZero returned an invalid Solana transaction encoding.");
  }
  const bytes = Buffer.from(fields.data, "base64");
  if (bytes.length > MAX_SOLANA_TRANSACTION_BYTES || bytes.toString("base64") !== fields.data) {
    throw new Error("LayerZero returned a noncanonical or oversized Solana transaction.");
  }
  try {
    const tx = VersionedTransaction.deserialize(bytes);
    if (!Buffer.from(tx.serialize()).equals(bytes)) throw new Error("noncanonical");
    return tx;
  } catch {
    throw new Error("LayerZero returned an invalid Solana transaction.");
  }
}

async function inspectStep(value: unknown, expectedSigner: string): Promise<UntrustedSolanaBridgeStep> {
  const step = object(value, "LayerZero user step");
  if (step.type !== "TRANSACTION" || step.chainKey !== REPLENISHMENT_ASSETS.solanaChainKey ||
      step.chainType !== "SOLANA" || step.signerAddress !== expectedSigner) {
    throw new Error("LayerZero returned an unapproved chain, signer, or step type.");
  }
  const transaction = object(step.transaction, "LayerZero transaction");
  const encoded = object(transaction.encoded, "LayerZero encoded transaction");
  const tx = canonicalTransaction(encoded);
  const message = tx.message;
  const accountKeys = message.staticAccountKeys;
  const lookups = message.addressTableLookups;
  const instructions = message.compiledInstructions;
  if (message.header.numRequiredSignatures !== 1 || message.header.numReadonlySignedAccounts !== 0 ||
      accountKeys[0]?.toBase58() !== expectedSigner || tx.signatures.length !== 1 ||
      tx.signatures[0].some((byte) => byte !== 0) || lookups.length !== 0 || instructions.length === 0 ||
      message.recentBlockhash === PublicKey.default.toBase58()) {
    throw new Error("LayerZero Solana transaction has an unapproved signer, lookup, or message.");
  }
  const programIds = instructions.map((ix) => {
    const id = accountKeys[ix.programIdIndex];
    if (!id || !message.isAccountWritable || message.isAccountWritable(ix.programIdIndex)) {
      throw new Error("LayerZero Solana transaction has an invalid program account.");
    }
    return id.toBase58();
  });
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(message.serialize()));
  return {
    messageSha256: Buffer.from(hash).toString("hex"),
    programIds,
    recentBlockhash: message.recentBlockhash,
    signerAddress: expectedSigner,
    instructionEffectsVerified: false,
    blockhashFreshnessVerified: false,
    executionReady: false,
  };
}

/**
 * Validate the fresh Solana envelopes. This cannot prove their token, recipient,
 * or amount effects; consumers must never sign these steps without an
 * independent instruction/lookup/simulation and balance-delta verifier.
 */
export async function validateBuiltChzBridgeSteps(
  payload: unknown, quote: ExactChzBridgeQuote, nowMs = Date.now(),
): Promise<readonly UntrustedSolanaBridgeStep[]> {
  if (quote.executionReady !== false || quote.sourceMint !== REPLENISHMENT_ASSETS.solanaChzMint ||
      quote.destinationToken !== REPLENISHMENT_ASSETS.nativeChilizChz ||
      quote.routeType !== "OFT" && quote.routeType !== "OFT_V2" ||
      !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) < nowMs + 15_000) {
    throw new Error("LayerZero CHZ bridge quote expired or changed route.");
  }
  ensureCanaryAmount(quote.sourceAmountAtomic);
  validatePublicWallets(quote.sourceSolanaWallet, quote.destinationChilizWallet);
  const steps = object(payload, "LayerZero build response").userSteps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 3) {
    throw new Error("LayerZero returned no usable Solana transaction steps.");
  }
  const inspected = await Promise.all(steps.map((step) => inspectStep(step, quote.sourceSolanaWallet)));
  if (new Set(inspected.map((step) => step.messageSha256)).size !== inspected.length) {
    throw new Error("LayerZero returned duplicate Solana transaction steps.");
  }
  return inspected;
}

/** Build steps only. No method in this client signs or sends a transaction. */
export async function buildUntrustedChzBridgeSteps(input: {
  apiKey: string;
  quote: ExactChzBridgeQuote;
  fetchImpl?: FetchLike;
  nowMs?: number;
}): Promise<readonly UntrustedSolanaBridgeStep[]> {
  key(input.apiKey);
  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(input.quote.expiresAt) < nowMs + 15_000) {
    throw new Error("LayerZero CHZ bridge quote is too near expiry.");
  }
  const payload = await jsonRequest(input.fetchImpl ?? fetch, `${API_BASE}/build-user-steps`, input.apiKey,
    { quoteId: input.quote.quoteId });
  return validateBuiltChzBridgeSteps(payload, input.quote, nowMs);
}

/**
 * Parse LayerZero's asynchronous status without treating its report as a
 * finalized source/destination chain receipt. A successful provider report
 * must be followed by independent RPC checks before accounting for CHZ.
 */
export function validateExactChzBridgeStatus(
  payload: unknown, expectedSourceSignature: string,
): ExactChzBridgeStatus {
  try {
    const signature = bs58.decode(expectedSourceSignature);
    if (signature.length !== 64 || bs58.encode(signature) !== expectedSourceSignature) {
      throw new Error("invalid signature");
    }
  } catch {
    throw new Error("A canonical Solana source signature is required.");
  }
  const response = object(payload, "LayerZero status response");
  const status = response.status;
  if (status !== "PENDING" && status !== "PROCESSING" && status !== "SUCCEEDED" &&
      status !== "FAILED" && status !== "UNKNOWN") {
    throw new Error("LayerZero returned an unknown transfer state.");
  }
  const history = response.executionHistory ?? [];
  if (!Array.isArray(history) || history.length > 20) {
    throw new Error("LayerZero returned malformed execution history.");
  }
  let sourceSignature: string | null = null;
  let destinationTransactionHash: string | null = null;
  for (const item of history) {
    const event = object(item, "LayerZero execution event");
    const transaction = object(event.transaction, "LayerZero execution transaction");
    if (event.event === "SENT") {
      if (transaction.chainKey !== REPLENISHMENT_ASSETS.solanaChainKey ||
          transaction.hash !== expectedSourceSignature || sourceSignature !== null) {
        throw new Error("LayerZero status changed the Solana source transaction.");
      }
      sourceSignature = expectedSourceSignature;
    } else if (event.event === "DELIVERED") {
      if (transaction.chainKey !== REPLENISHMENT_ASSETS.chilizChainKey ||
          typeof transaction.hash !== "string" ||
          !/^0x[0-9a-fA-F]{64}$/.test(transaction.hash) || destinationTransactionHash !== null) {
        throw new Error("LayerZero status has an invalid Chiliz destination transaction.");
      }
      destinationTransactionHash = transaction.hash.toLowerCase();
    }
  }
  if (status === "SUCCEEDED" && (!sourceSignature || !destinationTransactionHash)) {
    throw new Error("LayerZero success lacks source and destination transaction evidence.");
  }
  return {
    status, sourceSignature, destinationTransactionHash,
    destinationReceiptVerified: false, executionReady: false,
  };
}

/** Provider status is advisory; never release inventory from this call alone. */
export async function getExactChzBridgeStatus(input: {
  apiKey: string;
  quoteId: string;
  sourceSignature: string;
  fetchImpl?: FetchLike;
}): Promise<ExactChzBridgeStatus> {
  key(input.apiKey);
  if (!/^[A-Za-z0-9_-]{4,256}$/.test(input.quoteId)) {
    throw new Error("LayerZero quote ID is invalid.");
  }
  const url = new URL(`${API_BASE}/status/${encodeURIComponent(input.quoteId)}`);
  url.searchParams.set("txHash", input.sourceSignature);
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: { Accept: "application/json", "x-api-key": key(input.apiKey) },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("LayerZero status request failed.");
  }
  if (!response.ok) throw new Error(`LayerZero status returned HTTP ${response.status}.`);
  const reportedLength = Number(response.headers.get("content-length") ?? "0");
  if (reportedLength > MAX_RESPONSE_BYTES) throw new Error("LayerZero status exceeds the size limit.");
  let body: string;
  try { body = await response.text(); }
  catch { throw new Error("LayerZero status could not be read."); }
  if (body.length > MAX_RESPONSE_BYTES) throw new Error("LayerZero status exceeds the size limit.");
  let payload: unknown;
  try { payload = JSON.parse(body) as unknown; }
  catch { throw new Error("LayerZero status is not JSON."); }
  return validateExactChzBridgeStatus(payload, input.sourceSignature);
}

export const layerZeroBridgePreparationLimits = Object.freeze({
  maximumChzAtomic: MAX_CANARY_CHZ_ATOMIC.toString(),
  executionReady: false,
});
