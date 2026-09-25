#!/usr/bin/env node
// Quote-only tooling. This file has no wallet/secret-key loader, signer,
// execute endpoint, build-user-steps call, or transaction broadcast path.
import {
  REPLENISHMENT_ASSETS,
  validatePositiveAtomic,
  validatePublicWallets,
} from "../lib/protocol/replenishment.ts";
import {
  inspectSolanaChzFundingOrder,
  MAX_CHZ_FUNDING_LAMPORTS,
} from "../lib/protocol/replenishment-swap-inspection.ts";
import { prepareJupiterSwap } from "../lib/server/providers/jupiter-swap.ts";
import { quoteDirectChzOft } from "../lib/server/providers/chiliz-direct-oft.ts";
import { getExactChzBridgeStatus } from "../lib/server/providers/layerzero-value-transfer.ts";

function usage() {
  return [
    "Dry-run route check only. This command cannot move funds.",
    "Usage:",
    "  node --experimental-strip-types --env-file-if-exists=.env.local scripts/replenish-chiliz.mjs --sol-lamports <amount> --solana-wallet <public-address> --chiliz-wallet <public-address>",
    "  node --experimental-strip-types --env-file-if-exists=.env.local scripts/replenish-chiliz.mjs --chz-atomic <confirmed-existing-balance> --solana-wallet <public-address> --chiliz-wallet <public-address>",
    "  node --experimental-strip-types --env-file-if-exists=.env.local scripts/replenish-chiliz.mjs --status-quote-id <quote-id> --source-signature <Solana-signature>",
    "Direct OFT quotes use SOLANA_RPC_URL or HELIUS_API_KEY; SOL-to-CHZ quotes also use JUPITER_API_KEY.",
    "The legacy --status-quote-id mode alone uses LAYERZERO_VT_API_KEY. Private keys are never read.",
  ].join("\n");
}

function options(args) {
  if (args.includes("--help")) return { help: true };
  const permitted = new Set(["--sol-lamports", "--chz-atomic", "--solana-wallet", "--chiliz-wallet", "--status-quote-id", "--source-signature"]);
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
  if (values.has("--status-quote-id") || values.has("--source-signature")) {
    if (!values.has("--status-quote-id") || !values.has("--source-signature") ||
        sourceModes.length !== 0 || values.has("--solana-wallet") || values.has("--chiliz-wallet")) {
      throw new Error("Bridge status requires only --status-quote-id and --source-signature.");
    }
    return { help: false, mode: "bridge_status", quoteId: values.get("--status-quote-id"),
      sourceSignature: values.get("--source-signature") };
  }
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

async function main() {
  const input = options(process.argv.slice(2));
  if (input.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (input.mode === "bridge_status") {
    const layerZeroKey = process.env.LAYERZERO_VT_API_KEY?.trim();
    if (!layerZeroKey) throw new Error("LAYERZERO_VT_API_KEY is required for bridge status.");
    const status = await getExactChzBridgeStatus({ apiKey: layerZeroKey,
      quoteId: input.quoteId, sourceSignature: input.sourceSignature });
    process.stdout.write(`${JSON.stringify({ mode: "bridge_status", ...status,
      fundsMoved: false,
      warning: "Provider status is not an independently verified on-chain receipt, amount, or treasury credit." }, null, 2)}\n`);
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
    routeDirectory: "official Chiliz direct Solana OFT to native Chiliz CHZ",
    jupiter: null,
    directOft: null,
    blockers: [],
      warning: "Quotes are indicative. The swap must settle and its actual CHZ balance must be verified before a fresh bridge quote. This command cannot sign or broadcast.",
  };

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

  if (!bridgeAmount) {
    report.blockers.push("A valid CHZ amount is required before a bridge quote.");
  } else {
    const heliusKey = process.env.HELIUS_API_KEY?.trim();
    const rpcUrl = process.env.SOLANA_RPC_URL?.trim() ||
      (heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}` :
        "https://api.mainnet-beta.solana.com");
    try {
      report.directOft = await quoteDirectChzOft({
        amountAtomic: bridgeAmount,
        payerSolanaWallet: input.solanaWallet,
        destinationChilizWallet: input.chilizWallet,
        solanaRpcUrl: rpcUrl,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown route failure";
      // SDK errors can contain the RPC URL, including a query-string API key.
      // Emit only a fixed public diagnostic, never arbitrary provider text.
      const safeCode = /AccountNotFound/i.test(reason)
        ? "payer_account_unfunded_or_missing"
        : /InsufficientFunds|insufficient lamports/i.test(reason)
          ? "payer_has_insufficient_sol_for_quote"
          : "direct_oft_rpc_quote_failed";
      report.blockers.push(`Direct OFT quote unavailable: ${safeCode}`);
    }
    if (input.mode === "sol_to_chz_to_chiliz") {
      report.blockers.push("The SOL to CHZ swap is not settled; the direct OFT quote is indicative only and must be refreshed after on-chain reconciliation.");
    }
  }
  report.blockers.push("Live signing, broadcast, durable settlement journal, and post-bridge balance reconciliation are deliberately not implemented.");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 2;
}

main().catch((error) => {
  // Provider errors may contain an RPC URL or API key. Never echo their raw
  // message from a command that can be run with `.env.local` loaded.
  const message = error instanceof Error ? error.message : "";
  const safeError = message === "Invalid or duplicate option: --execute."
    ? message
    : /^SOL to CHZ dry-run input exceeds the [0-9]+ lamport per-order cap\.$/.test(message)
      ? message
      : "route_check_failed";
  process.stderr.write(`${JSON.stringify({ mode: "dry_run_only", executionEnabled: false, fundsMoved: false, error: safeError })}\n`);
  process.exitCode = 1;
});
