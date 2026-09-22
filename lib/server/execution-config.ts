import "server-only";

import { env } from "cloudflare:workers";

import { deriveExecutionReadiness } from "@/lib/protocol/settlement";
import { readMainnetConfig } from "@/lib/server/mainnet-config";

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function enabled(name: keyof Cloudflare.Env) {
  return firstNonEmpty(env[name] as string | undefined, process.env[name]) === "true";
}

function configured(name: keyof Cloudflare.Env) {
  return Boolean(firstNonEmpty(env[name] as string | undefined, process.env[name]));
}

export type ProtocolControls = {
  settlementPaused: boolean;
  rewardsPaused: boolean;
  buybackPaused: boolean;
  pauseReason: string;
  revision: number;
  updatedAt: string | null;
};

export const DEFAULT_PROTOCOL_CONTROLS: ProtocolControls = {
  settlementPaused: true,
  rewardsPaused: true,
  buybackPaused: true,
  pauseReason: "signer_not_configured",
  revision: 0,
  updatedAt: null,
};

export function readExecutionConfig(controls: ProtocolControls = DEFAULT_PROTOCOL_CONTROLS) {
  const mainnet = readMainnetConfig();
  const flags = {
    settlementEnabled: enabled("SPORTPAD_SETTLEMENT_ENABLED"),
    rewardsEnabled: enabled("SPORTPAD_REWARDS_ENABLED"),
    holderIndexerEnabled: enabled("SPORTPAD_HOLDER_INDEXER_ENABLED"),
    claimsEnabled: enabled("SPORTPAD_CLAIMS_ENABLED"),
    buybackEnabled: enabled("SPORTPAD_BUYBACK_ENABLED"),
  };
  const signerProvider = firstNonEmpty(env.SPORTPAD_SIGNER_PROVIDER, process.env.SPORTPAD_SIGNER_PROVIDER) ?? null;
  const signerRefs = {
    feeCollector: configured("SOLANA_FEE_COLLECTOR_KEY_REF"),
    rewardVault: configured("SOLANA_REWARD_VAULT_KEY_REF"),
    buybackExecutor: configured("SOLANA_BUYBACK_EXECUTOR_KEY_REF"),
  };
  const workerTokenConfigured = configured("SPORTPAD_WORKER_TOKEN");
  const readiness = deriveExecutionReadiness({
    globalEnabled: mainnet.enabled,
    settlementEnabled: flags.settlementEnabled,
    rewardsEnabled: flags.rewardsEnabled,
    buybackEnabled: flags.buybackEnabled,
    claimsEnabled: flags.claimsEnabled,
    workerTokenConfigured,
    feeCollectorSignerConfigured: Boolean(signerProvider && signerRefs.feeCollector),
    rewardVaultSignerConfigured: Boolean(signerProvider && signerRefs.rewardVault),
    buybackSignerConfigured: Boolean(signerProvider && signerRefs.buybackExecutor),
    sportpadMintConfigured: Boolean(mainnet.sportpadMint),
    settlementPaused: controls.settlementPaused,
    rewardsPaused: controls.rewardsPaused,
    buybackPaused: controls.buybackPaused,
  });

  return {
    mainnet,
    flags,
    signerProviderConfigured: Boolean(signerProvider),
    signerRefs,
    workerTokenConfigured,
    controls,
    readiness,
  };
}

export function readWorkerToken() {
  return firstNonEmpty(env.SPORTPAD_WORKER_TOKEN, process.env.SPORTPAD_WORKER_TOKEN) ?? null;
}
