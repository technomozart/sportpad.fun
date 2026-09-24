#!/usr/bin/env node
// Quote-only tooling. This file has no wallet/secret-key loader, signer,
// execute endpoint, build-user-steps call, or transaction broadcast path.
import {
  REPLENISHMENT_ASSETS,
  layerZeroQuoteRequest,
  validateLayerZeroDiscovery,
  validateLayerZeroQuote,
  validatePositiveAtomic,
  validatePublicWallets,
} from "../lib/protocol/replenishment.ts";
import {
  inspectSolanaChzFundingOrder,
  MAX_CHZ_FUNDING_LAMPORTS,
} from "../lib/protocol/replenishment-swap-inspection.ts";
import { prepareJupiterSwap } from "../lib/server/providers/jupiter-swap.ts";

const LAYERZERO_BASE = "https://transfer.layerzero-api.com/v1";

function usage() {
  return [
    "Dry-run route check only. This command cannot move funds.",
    "Usage:",
    "  node --experimental-strip-types --env-file-if-exists=.env.local scripts/replenish-chiliz.mjs --sol-lamports <amount> --solana-wallet <public-address> --chiliz-wallet <public-address>",
    "  node --experimental-strip-types --env-file-if-exists=.env.local scripts/replenish-chiliz.mjs --chz-atomic <confirmed-existing-balance> --solana-wallet <public-address> --chiliz-wallet <public-address>",
    "Only JUPITER_API_KEY and LAYERZERO_VT_API_KEY are read from the environment. Private keys are never read.",
  ].join("\n");
}

function options(args) {
  if (args.includes("--help")) return { help: true };
  const permitted = new Set(["--sol-lamports", "--chz-atomic", "--solana-wallet", "--chiliz-wallet"]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!permitted.has(key) || !value || value.startsWith("--") || values.has(key)) {
      throw new Error(`Invalid or duplicate option: ${key ?? "missing"}.`);
    }
    values.set(key, value);
  }
  const sourceModes = [values.has("--sol-lamports"), values.has("--chz-atomic")].filter(Boolean);
  if (sourceModes.length !== 1) throw new Error("Specify exactly one of --sol-lamports or --chz-atomic.");
  const solanaWallet = values.get("--solana-wallet");
  const chilizWallet = values.get("--chiliz-wallet");
  if (!solanaWallet || !chilizWallet) throw new Error("Both public treasury wallet addresses are required.");
  validatePublicWallets(solanaWallet, chilizWallet);
  const amount = values.get("--sol-lamports") ?? values.get("--chz-atomic");
  validatePositiveAtomic(amount, "input amount");
  if (values.has("--sol-lamports") && BigInt(amount) > MAX_CHZ_FUNDING_LAMPORTS) {
    throw new Error(`SOL to CHZ dry-run input exceeds the ${MAX_CHZ_FUNDING_LAMPORTS} lamport per-order cap.`);
  }
  return {
    help: false,
    mode: values.has("--sol-lamports") ? "sol_to_chz_to_chiliz" : "confirmed_chz_to_chiliz",
    amount,
    solanaWallet,
    chilizWallet,
  };
}

async function getJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Route provider returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error("Route provider returned invalid JSON.");
  }
}

async function checkDiscovery() {
  const destinations = new URL(`${LAYERZERO_BASE}/tokens`);
  destinations.searchParams.set("transferrableFromChainKey", REPLENISHMENT_ASSETS.solanaChainKey);
  destinations.searchParams.set("transferrableFromTokenAddress", REPLENISHMENT_ASSETS.solanaChzMint);
  const [chains, tokens, reachable] = await Promise.all([
    getJson(`${LAYERZERO_BASE}/chains`),
    getJson(`${LAYERZERO_BASE}/tokens`),
    getJson(destinations),
  ]);
  return validateLayerZeroDiscovery(chains, tokens, reachable);
}

async function getLayerZeroQuote(apiKey, amount, solanaWallet, chilizWallet) {
  const body = layerZeroQuoteRequest(amount, solanaWallet, chilizWallet);
  const payload = await getJson(`${LAYERZERO_BASE}/quotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  return validateLayerZeroQuote(payload, amount);
}

async function main() {
  const input = options(process.argv.slice(2));
  if (input.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = {
    mode: "dry_run_only",
    executionEnabled: false,
    fundsMoved: false,
    route: "Solana SOL → Solana CHZ → native Chiliz CHZ",
    sourceSolanaWallet: input.solanaWallet,
    destinationChilizWallet: input.chilizWallet,
    sourceChzMint: REPLENISHMENT_ASSETS.solanaChzMint,
    routeDirectory: "checking",
    jupiter: null,
    layerZero: null,
    blockers: [],
    warning: "Quotes are indicative. The swap must settle and its actual CHZ balance must be verified before a fresh bridge quote. This command cannot sign or broadcast.",
  };
  await checkDiscovery();
  report.routeDirectory = "exact Solana CHZ to native Chiliz CHZ path listed";

  let bridgeAmount = input.mode === "confirmed_chz_to_chiliz" ? input.amount : null;
  if (input.mode === "sol_to_chz_to_chiliz") {
    const jupiterKey = process.env.JUPITER_API_KEY?.trim();
    if (!jupiterKey) {
      report.blockers.push("JUPITER_API_KEY is absent; no SOL to CHZ quote was requested.");
    } else {
      const plan = await prepareJupiterSwap({
        apiKey: jupiterKey,
        inputMint: REPLENISHMENT_ASSETS.solMint,
        outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
        amountAtomic: input.amount,
        taker: input.solanaWallet,
      });
      const inspection = inspectSolanaChzFundingOrder(plan, input.solanaWallet);
      bridgeAmount = plan.minimumOutputAtomic;
      report.jupiter = {
        inputLamports: plan.inputAmountAtomic,
        expectedChzAtomic: plan.outputAmountAtomic,
        minimumChzAtomic: plan.minimumOutputAtomic,
        priceImpactPercent: plan.priceImpactPercent,
        router: plan.router,
        transactionMessageHash: plan.transactionMessageHash,
        requestId: plan.requestId,
        inspection,
      };
      report.blockers.push("The SOL to official Solana CHZ order is not execution-ready: fee provenance, lookup/writable accounts, and simulated on-chain balance effects require independent verification.");
    }
  } else {
    report.warning = "Provided CHZ amount is not verified against a settled on-chain balance. This command cannot sign or broadcast.";
  }

  const layerZeroKey = process.env.LAYERZERO_VT_API_KEY?.trim();
  if (!layerZeroKey) {
    report.blockers.push("LAYERZERO_VT_API_KEY is absent; no executable bridge quote can be checked.");
  } else if (!bridgeAmount) {
    report.blockers.push("A valid CHZ amount is required before a bridge quote.");
  } else {
    report.layerZero = await getLayerZeroQuote(layerZeroKey, bridgeAmount, input.solanaWallet, input.chilizWallet);
    if (input.mode === "sol_to_chz_to_chiliz") {
      report.blockers.push("The SOL to CHZ swap is not settled; the LayerZero quote is indicative only and must be refreshed after on-chain reconciliation.");
    }
  }
  report.blockers.push("Live signing, broadcast, durable settlement journal, and post-bridge balance reconciliation are deliberately not implemented.");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ mode: "dry_run_only", executionEnabled: false, fundsMoved: false, error: error instanceof Error ? error.message : "Unknown route-check failure." })}\n`);
  process.exitCode = 1;
});
