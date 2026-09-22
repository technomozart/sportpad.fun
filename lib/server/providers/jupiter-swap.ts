import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";

const JUPITER_ORDER_ENDPOINT = "https://api.jup.ag/swap/v2/order";
const JUPITER_EXECUTE_ENDPOINT = "https://api.jup.ag/swap/v2/execute";
const MAX_PRICE_IMPACT_PERCENT = 5;
const SLIPPAGE_BPS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function positiveAtomic(value: unknown, field: string) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`Jupiter returned an invalid ${field}.`);
  }
  return value;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Jupiter returned an invalid ${field}.`);
  return value;
}

function decodeUnsignedTransaction(value: unknown, taker: string) {
  const transactionBase64 = requiredString(value, "transaction");
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, "base64"));
  } catch {
    throw new Error("Jupiter returned an unreadable transaction.");
  }
  if (transaction.message.header.numRequiredSignatures !== 1) {
    throw new Error("Jupiter returned an unexpected signer set.");
  }
  if (transaction.message.staticAccountKeys[0]?.toBase58() !== taker) {
    throw new Error("Jupiter returned a transaction for a different fee payer.");
  }
  if (transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
    throw new Error("Jupiter returned a pre-signed transaction.");
  }
  return { transactionBase64, messageBytes: transaction.message.serialize() };
}

async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type JupiterSwapPlan = {
  transactionBase64: string;
  transactionMessageHash: string;
  requestId: string;
  lastValidBlockHeight: number;
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: string;
  outputAmountAtomic: string;
  minimumOutputAtomic: string;
  priceImpactPercent: number;
  router: string | null;
};

export async function prepareJupiterSwap({
  apiKey,
  inputMint,
  outputMint,
  amountAtomic,
  taker,
  fetcher = fetch,
}: {
  apiKey: string;
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  taker: string;
  fetcher?: typeof fetch;
}): Promise<JupiterSwapPlan> {
  new PublicKey(inputMint);
  new PublicKey(outputMint);
  new PublicKey(taker);
  positiveAtomic(amountAtomic, "requested input amount");
  if (inputMint === outputMint) throw new Error("Jupiter input and output mints must differ.");

  const endpoint = new URL(JUPITER_ORDER_ENDPOINT);
  endpoint.searchParams.set("inputMint", inputMint);
  endpoint.searchParams.set("outputMint", outputMint);
  endpoint.searchParams.set("amount", amountAtomic);
  endpoint.searchParams.set("taker", taker);
  endpoint.searchParams.set("slippageBps", String(SLIPPAGE_BPS));
  endpoint.searchParams.set("excludeRouters", "jupiterz,dflow,okx");
  const response = await fetcher(endpoint, {
    headers: { Accept: "application/json", "x-api-key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !isRecord(payload)) throw new Error(`Jupiter order failed with status ${response.status}.`);

  const responseInputMint = requiredString(payload.inputMint, "input mint");
  const responseOutputMint = requiredString(payload.outputMint, "output mint");
  const responseTaker = requiredString(payload.taker, "taker");
  const inAmount = positiveAtomic(payload.inAmount, "input amount");
  const outAmount = positiveAtomic(payload.outAmount, "output amount");
  const minimumOutput = positiveAtomic(payload.otherAmountThreshold, "minimum output amount");
  if (responseInputMint !== inputMint || responseOutputMint !== outputMint || responseTaker !== taker || inAmount !== amountAtomic) {
    throw new Error("Jupiter changed an exact swap constraint.");
  }
  if (BigInt(minimumOutput) > BigInt(outAmount)) throw new Error("Jupiter returned an invalid minimum output amount.");
  const priceImpact = typeof payload.priceImpact === "number" ? payload.priceImpact : Number(payload.priceImpact);
  if (!Number.isFinite(priceImpact) || Math.abs(priceImpact) > MAX_PRICE_IMPACT_PERCENT) {
    throw new Error("Jupiter route price impact exceeds the SportPad safety limit.");
  }
  if (payload.swapMode !== "ExactIn" || Number(payload.slippageBps) > SLIPPAGE_BPS || payload.router !== "metis") {
    throw new Error("Jupiter changed the approved exact-in routing policy.");
  }
  if (payload.gasless !== false || payload.signatureFeePayer !== taker) {
    throw new Error("Jupiter returned an unapproved sponsored-gas transaction.");
  }
  const { transactionBase64, messageBytes } = decodeUnsignedTransaction(payload.transaction, taker);
  const lastValidBlockHeight = Number(payload.lastValidBlockHeight);
  if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) {
    throw new Error("Jupiter returned an invalid block-height expiry.");
  }
  return {
    transactionBase64,
    transactionMessageHash: await sha256Hex(messageBytes),
    requestId: requiredString(payload.requestId, "request ID"),
    lastValidBlockHeight,
    inputMint,
    outputMint,
    inputAmountAtomic: inAmount,
    outputAmountAtomic: outAmount,
    minimumOutputAtomic: minimumOutput,
    priceImpactPercent: priceImpact,
    router: typeof payload.router === "string" ? payload.router : null,
  };
}

export async function executeJupiterSwap({
  apiKey,
  signedTransactionBase64,
  requestId,
  lastValidBlockHeight,
  fetcher = fetch,
}: {
  apiKey: string;
  signedTransactionBase64: string;
  requestId: string;
  lastValidBlockHeight: number;
  fetcher?: typeof fetch;
}) {
  const response = await fetcher(JUPITER_EXECUTE_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ signedTransaction: signedTransactionBase64, requestId, lastValidBlockHeight }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !isRecord(payload) || payload.status !== "Success") {
    throw new Error(`Jupiter execution failed with status ${response.status}.`);
  }
  return {
    signature: requiredString(payload.signature, "execution signature"),
    slot: Number.isSafeInteger(Number(payload.slot)) ? Number(payload.slot) : null,
    outputAmountAtomic: typeof payload.totalOutputAmount === "string" && /^[1-9]\d*$/.test(payload.totalOutputAmount)
      ? payload.totalOutputAmount
      : null,
  };
}

export async function transactionMessageHash(transaction: VersionedTransaction) {
  return sha256Hex(transaction.message.serialize());
}
