import { env } from "cloudflare:workers";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { Buffer } from "buffer";

import { NATIVE_MINT } from "@/lib/protocol/pump-devnet-verification";
import { isCommunityLaunchFeeSource } from "@/lib/protocol/fee-policy";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { executeJupiterSwap, prepareJupiterSwap, transactionMessageHash } from "@/lib/server/providers/jupiter-swap";
import { readProviderCredentials } from "@/lib/server/providers/runtime-config";
import { isOperatorRequest } from "@/lib/server/publication-policy";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";
import { getVerifiedWalletSession } from "@/lib/server/wallet-session";
import { legacyTransactionMessageHash, prepareSportpadBurn, submitSignedMainnetTransaction } from "@/lib/server/solana/burn";

type SettlementRow = {
  settlement_id: string;
  settlement_state: string;
  reward_amount_atomic: string;
  buyback_amount_atomic: string;
  reward_swap_signature: string | null;
  buyback_swap_signature: string | null;
  burn_signature: string | null;
  buyback_output_atomic: string | null;
  launch_id: string;
  launch_name: string;
  launch_symbol: string;
  launch_mint: string;
  reward_symbol: string;
  reward_mint: string;
  reward_treasury: string;
  buyback_treasury: string;
};

type ControlRow = {
  settlement_paused: number;
  rewards_paused: number;
  buyback_paused: number;
  pause_reason: string;
};

type IntentRow = {
  id: string;
  settlement_id: string;
  signer_address: string;
  action: string;
  state: string;
  provider_request_id: string;
  transaction_message_hash: string;
  last_valid_block_height: number;
  input_mint: string;
  output_mint: string;
  input_amount_atomic: string;
  minimum_output_atomic: string;
  expires_at: string;
};

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

function settlementQuery(suffix = "") {
  return `
    SELECT
      s.id AS settlement_id, s.state AS settlement_state,
      s.reward_amount_atomic, s.buyback_amount_atomic,
      s.reward_swap_signature, s.buyback_swap_signature, s.burn_signature,
      (SELECT output_amount_atomic FROM settlement_steps ss WHERE ss.settlement_id = s.id AND ss.stage = 'buyback_swap' LIMIT 1) AS buyback_output_atomic,
      l.id AS launch_id, l.name AS launch_name, l.symbol AS launch_symbol,
      l.mainnet_mint AS launch_mint,
      l.reward_symbol, l.reward_mint,
      l.mainnet_reward_treasury AS reward_treasury,
      l.mainnet_buyback_treasury AS buyback_treasury
    FROM settlements s
    JOIN fee_events f ON f.id = s.fee_event_id
    JOIN launch_drafts l ON l.id = f.launch_id
    WHERE f.state = 'reconciled'
      AND l.status IN ('mainnet_published', 'mainnet_suspended')
      AND l.reward_mint IS NOT NULL
      AND l.mainnet_reward_treasury IS NOT NULL
      AND l.mainnet_buyback_treasury IS NOT NULL
    ${suffix}
  `;
}

async function controls() {
  return env.DB!.prepare(`
    SELECT settlement_paused, rewards_paused, buyback_paused, pause_reason
    FROM protocol_controls WHERE key = 'global' LIMIT 1
  `).first<ControlRow>();
}

async function settlementById(id: string) {
  return env.DB!.prepare(settlementQuery("AND s.id = ?1 LIMIT 1")).bind(id).first<SettlementRow>();
}

function requireCommunityLaunchSettlement(settlement: SettlementRow) {
  if (!isCommunityLaunchFeeSource(settlement.launch_mint, readMainnetConfig().sportpadMint)) {
    throw new Error("SPORTPAD's own creator fees are reserved for project development and cannot enter community reward or burn settlements.");
  }
}

function requireManualLane(control: ControlRow | null, leg: "reward" | "buyback") {
  if (!control || control.settlement_paused) throw new Error("Settlement execution is paused by the protocol control plane.");
  if (leg === "reward" && control.rewards_paused) throw new Error("Reward swaps are paused by the protocol control plane.");
  if (leg === "buyback" && control.buyback_paused) throw new Error("SPORTPAD buybacks are paused by the protocol control plane.");
}

function validSettlementId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
}

function validIntentId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);
}

export async function GET(request: Request) {
  if (!isOperatorRequest(request)) return privateJson({ error: "Operator access is required." }, 403);
  if (!env.DB) return privateJson({ error: "Settlement database is unavailable." }, 503);
  const [control, result] = await Promise.all([
    controls(),
    env.DB.prepare(settlementQuery("ORDER BY s.created_at DESC LIMIT 100")).all<SettlementRow>(),
  ]);
  return privateJson({
    controls: control ? {
      settlementPaused: Boolean(control.settlement_paused),
      rewardsPaused: Boolean(control.rewards_paused),
      buybackPaused: Boolean(control.buyback_paused),
      pauseReason: control.pause_reason,
    } : null,
    sportpadMint: readMainnetConfig().sportpadMint,
    items: result.results
      .filter((row) => isCommunityLaunchFeeSource(row.launch_mint, readMainnetConfig().sportpadMint))
      .map((row) => ({
      settlementId: row.settlement_id,
      state: row.settlement_state,
      launchId: row.launch_id,
      launchName: row.launch_name,
      launchSymbol: row.launch_symbol,
      rewardSymbol: row.reward_symbol,
      rewardMint: row.reward_mint,
      rewardAmountAtomic: row.reward_amount_atomic,
      buybackAmountAtomic: row.buyback_amount_atomic,
      rewardTreasury: row.reward_treasury,
      buybackTreasury: row.buyback_treasury,
      rewardSwapSignature: row.reward_swap_signature,
      buybackSwapSignature: row.buyback_swap_signature,
      burnSignature: row.burn_signature,
      buybackOutputAtomic: row.buyback_output_atomic,
      })),
  });
}

export async function POST(request: Request) {
  if (!isOperatorRequest(request)) return privateJson({ error: "Operator access is required." }, 403);
  if (!isSameOrigin(request)) return privateJson({ error: "Same-origin request required." }, 403);
  if (!env.DB) return privateJson({ error: "Settlement database is unavailable." }, 503);
  const walletSession = await getVerifiedWalletSession(request);
  if (!walletSession) return privateJson({ error: "Verify the required Solana treasury wallet first." }, 401);
  const rateLimit = await consumeFixedWindow({
    scope: "operator_swaps",
    subject: walletSession.ownerUserId,
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) return rateLimitedJson("Too many settlement actions.", rateLimit);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return privateJson({ error: "A JSON action is required." }, 400); }
  const credentials = readProviderCredentials();
  if (!credentials.jupiterApiKey) return privateJson({ error: "Jupiter is not configured." }, 503);

  try {
    if (body.action === "prepare_swap") {
      if (!validSettlementId(body.settlementId) || (body.leg !== "reward" && body.leg !== "buyback")) {
        return privateJson({ error: "A valid settlement and swap leg are required." }, 400);
      }
      const leg = body.leg;
      const [control, settlement] = await Promise.all([controls(), settlementById(body.settlementId)]);
      if (!settlement) return privateJson({ error: "Settlement not found." }, 404);
      requireCommunityLaunchSettlement(settlement);
      requireManualLane(control, leg);
      if ((leg === "reward" && settlement.reward_swap_signature) || (leg === "buyback" && settlement.buyback_swap_signature)) {
        return privateJson({ error: "That settlement leg already has a transaction receipt." }, 409);
      }
      const mainnet = readMainnetConfig();
      const signerAddress = leg === "reward" ? settlement.reward_treasury : settlement.buyback_treasury;
      const outputMint = leg === "reward" ? settlement.reward_mint : mainnet.sportpadMint;
      const inputAmountAtomic = leg === "reward" ? settlement.reward_amount_atomic : settlement.buyback_amount_atomic;
      if (!outputMint) return privateJson({ error: "The SPORTPAD mint must be deployed and configured before buybacks can run." }, 409);
      if (walletSession.walletAddress !== signerAddress) {
        return privateJson({ error: `Connect and verify the ${leg === "reward" ? "80% reward" : "20% SPORTPAD buyback"} treasury wallet.` }, 403);
      }
      const plan = await prepareJupiterSwap({
        apiKey: credentials.jupiterApiKey,
        inputMint: NATIVE_MINT.toBase58(),
        outputMint,
        amountAtomic: inputAmountAtomic,
        taker: signerAddress,
      });
      const intentId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 90_000).toISOString();
      await env.DB.prepare(`
        INSERT INTO transaction_intents (
          id, idempotency_key, settlement_id, signer_role, signer_address, action, state,
          expected_programs_json, expected_mints_json, maximum_spend_lamports,
          provider_request_id, unsigned_transaction_base64, transaction_message_hash,
          last_valid_block_height, input_mint, output_mint, input_amount_atomic,
          minimum_output_atomic, expires_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, 'planned',
          '["jupiter_v2_exact_message"]', ?7, ?8,
          ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
        )
      `).bind(
        intentId,
        `jupiter:${settlement.settlement_id}:${leg}:${plan.requestId}`,
        settlement.settlement_id,
        leg === "reward" ? "reward_treasury" : "buyback_treasury",
        signerAddress,
        leg === "reward" ? "reward_swap" : "sportpad_buyback",
        JSON.stringify([plan.inputMint, plan.outputMint]),
        plan.inputAmountAtomic,
        plan.requestId,
        plan.transactionBase64,
        plan.transactionMessageHash,
        plan.lastValidBlockHeight,
        plan.inputMint,
        plan.outputMint,
        plan.inputAmountAtomic,
        plan.minimumOutputAtomic,
        expiresAt,
      ).run();
      return privateJson({
        intentId,
        transactionBase64: plan.transactionBase64,
        expiresAt,
        inputAmountAtomic: plan.inputAmountAtomic,
        quotedOutputAtomic: plan.outputAmountAtomic,
        minimumOutputAtomic: plan.minimumOutputAtomic,
        priceImpactPercent: plan.priceImpactPercent,
        outputMint: plan.outputMint,
      });
    }

    if (body.action === "submit_swap") {
      if (!validIntentId(body.intentId) || typeof body.signedTransactionBase64 !== "string" || body.signedTransactionBase64.length > 20_000) {
        return privateJson({ error: "A valid signed transaction intent is required." }, 400);
      }
      const intent = await env.DB.prepare(`
        SELECT id, settlement_id, signer_address, action, state, provider_request_id,
          transaction_message_hash, last_valid_block_height, input_mint, output_mint,
          input_amount_atomic, minimum_output_atomic, expires_at
        FROM transaction_intents WHERE id = ?1 LIMIT 1
      `).bind(body.intentId).first<IntentRow>();
      if (!intent || intent.state !== "planned") return privateJson({ error: "That transaction intent is no longer signable." }, 409);
      const intentSettlement = await settlementById(intent.settlement_id);
      if (!intentSettlement) return privateJson({ error: "Settlement not found." }, 404);
      requireCommunityLaunchSettlement(intentSettlement);
      if (Date.parse(intent.expires_at) <= Date.now()) return privateJson({ error: "That Jupiter order expired. Prepare a new order." }, 409);
      if (walletSession.walletAddress !== intent.signer_address) return privateJson({ error: "The signed wallet does not match this treasury intent." }, 403);
      let signed: VersionedTransaction;
      try { signed = VersionedTransaction.deserialize(Buffer.from(body.signedTransactionBase64, "base64")); } catch { return privateJson({ error: "The signed transaction is unreadable." }, 400); }
      if (await transactionMessageHash(signed) !== intent.transaction_message_hash) {
        return privateJson({ error: "The signed transaction does not match the exact Jupiter order." }, 400);
      }
      const signatureBytes = signed.signatures[0];
      if (!signatureBytes || signatureBytes.every((byte) => byte === 0) || !ed25519.verify(signatureBytes, signed.message.serialize(), new PublicKey(intent.signer_address).toBytes())) {
        return privateJson({ error: "The treasury signature is invalid." }, 400);
      }
      const expectedSignature = bs58.encode(signatureBytes);
      const claimed = await env.DB.prepare(`
        UPDATE transaction_intents SET state = 'submitting', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND state = 'planned'
      `).bind(intent.id).run();
      if (Number(claimed.meta.changes ?? 0) !== 1) return privateJson({ error: "That transaction intent is already being submitted." }, 409);

      let execution;
      try {
        execution = await executeJupiterSwap({
          apiKey: credentials.jupiterApiKey,
          signedTransactionBase64: body.signedTransactionBase64,
          requestId: intent.provider_request_id,
          lastValidBlockHeight: intent.last_valid_block_height,
        });
      } catch (error) {
        await env.DB.prepare(`UPDATE transaction_intents SET state = 'submission_unknown', error_code = 'jupiter_execute_unknown', updated_at = CURRENT_TIMESTAMP WHERE id = ?1`)
          .bind(intent.id).run();
        throw error;
      }
      if (execution.signature !== expectedSignature) {
        await env.DB.prepare(`UPDATE transaction_intents SET state = 'submission_unknown', error_code = 'signature_mismatch', updated_at = CURRENT_TIMESTAMP WHERE id = ?1`)
          .bind(intent.id).run();
        throw new Error("Jupiter returned a different transaction signature.");
      }
      const leg = intent.action === "reward_swap" ? "reward" : "buyback";
      const stepId = `step:${intent.settlement_id}:${leg}`;
      const eventId = `swap:${intent.id}`;
      const settlementUpdate = leg === "reward"
        ? env.DB.prepare(`
            UPDATE settlements SET reward_swap_signature = ?2,
              state = CASE WHEN buyback_swap_signature IS NULL THEN 'reward_swap_submitted' ELSE 'swaps_submitted' END,
              updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND reward_swap_signature IS NULL
          `).bind(intent.settlement_id, execution.signature)
        : env.DB.prepare(`
            UPDATE settlements SET buyback_swap_signature = ?2,
              state = CASE WHEN reward_swap_signature IS NULL THEN 'buyback_swap_submitted' ELSE 'swaps_submitted' END,
              updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND buyback_swap_signature IS NULL
          `).bind(intent.settlement_id, execution.signature);
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE transaction_intents SET state = 'submitted', tx_signature = ?2, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1 AND state = 'submitting'
        `).bind(intent.id, execution.signature),
        env.DB.prepare(`
          INSERT INTO settlement_steps (
            id, settlement_id, stage, idempotency_key, state, input_mint, output_mint,
            input_amount_atomic, output_amount_atomic, minimum_output_atomic,
            provider_request_id, tx_signature, attempt
          ) VALUES (?1, ?2, ?3, ?4, 'submitted', ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1)
          ON CONFLICT(idempotency_key) DO UPDATE SET
            state = excluded.state, output_amount_atomic = excluded.output_amount_atomic,
            provider_request_id = excluded.provider_request_id, tx_signature = excluded.tx_signature,
            attempt = settlement_steps.attempt + 1, updated_at = CURRENT_TIMESTAMP
        `).bind(
          stepId, intent.settlement_id, leg === "reward" ? "reward_swap" : "buyback_swap",
          `settlement:${intent.settlement_id}:${leg}`, intent.input_mint, intent.output_mint,
          intent.input_amount_atomic, execution.outputAmountAtomic, intent.minimum_output_atomic,
          intent.provider_request_id, execution.signature,
        ),
        settlementUpdate,
        env.DB.prepare(`
          INSERT OR IGNORE INTO protocol_events (
            id, category, entity_type, entity_id, event_type, idempotency_key, state,
            signature, slot, amount_atomic, mint
          ) VALUES (?1, 'settlement', 'settlement', ?2, ?3, ?1, 'submitted', ?4, ?5, ?6, ?7)
        `).bind(eventId, intent.settlement_id, leg === "reward" ? "reward_swap_submitted" : "buyback_swap_submitted", execution.signature, execution.slot, intent.input_amount_atomic, intent.output_mint),
      ]);
      return privateJson({ ok: true, signature: execution.signature, outputAmountAtomic: execution.outputAmountAtomic });
    }

    if (body.action === "prepare_burn") {
      if (!validSettlementId(body.settlementId)) return privateJson({ error: "A valid settlement is required." }, 400);
      const [control, settlement] = await Promise.all([controls(), settlementById(body.settlementId)]);
      if (!settlement) return privateJson({ error: "Settlement not found." }, 404);
      requireCommunityLaunchSettlement(settlement);
      requireManualLane(control, "buyback");
      if (!settlement.buyback_swap_signature) return privateJson({ error: "The SPORTPAD buyback must be completed before burning." }, 409);
      if (settlement.burn_signature) return privateJson({ error: "That settlement already has a burn receipt." }, 409);
      if (walletSession.walletAddress !== settlement.buyback_treasury) {
        return privateJson({ error: "Connect and verify the 20% SPORTPAD buyback treasury wallet." }, 403);
      }
      const sportpadMint = readMainnetConfig().sportpadMint;
      if (!sportpadMint) return privateJson({ error: "The SPORTPAD mint must be deployed and configured before burns can run." }, 409);
      if (!settlement.buyback_output_atomic || !/^[1-9]\d*$/.test(settlement.buyback_output_atomic)) {
        return privateJson({ error: "The confirmed SPORTPAD buyback output is not available for an exact burn." }, 409);
      }
      const plan = await prepareSportpadBurn({
        mintAddress: sportpadMint,
        ownerAddress: settlement.buyback_treasury,
        amountAtomic: settlement.buyback_output_atomic,
      });
      const intentId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 90_000).toISOString();
      await env.DB.prepare(`
        INSERT INTO transaction_intents (
          id, idempotency_key, settlement_id, signer_role, signer_address, action, state,
          expected_programs_json, expected_mints_json, maximum_spend_lamports,
          unsigned_transaction_base64, transaction_message_hash, last_valid_block_height,
          input_mint, output_mint, input_amount_atomic, expires_at
        ) VALUES (?1, ?2, ?3, 'buyback_treasury', ?4, 'sportpad_burn', 'planned',
          ?5, ?6, '0', ?7, ?8, ?9, ?10, ?10, ?11, ?12)
      `).bind(
        intentId,
        `burn:${settlement.settlement_id}:${plan.blockhash}`,
        settlement.settlement_id,
        settlement.buyback_treasury,
        JSON.stringify([plan.tokenProgram]),
        JSON.stringify([sportpadMint]),
        plan.transactionBase64,
        plan.transactionMessageHash,
        plan.lastValidBlockHeight,
        sportpadMint,
        settlement.buyback_output_atomic,
        expiresAt,
      ).run();
      return privateJson({
        intentId,
        transactionBase64: plan.transactionBase64,
        expiresAt,
        burnAmountAtomic: settlement.buyback_output_atomic,
        mint: sportpadMint,
      });
    }

    if (body.action === "submit_burn") {
      if (!validIntentId(body.intentId) || typeof body.signedTransactionBase64 !== "string" || body.signedTransactionBase64.length > 20_000) {
        return privateJson({ error: "A valid signed burn intent is required." }, 400);
      }
      const intent = await env.DB.prepare(`
        SELECT id, settlement_id, signer_address, action, state, provider_request_id,
          transaction_message_hash, last_valid_block_height, input_mint, output_mint,
          input_amount_atomic, minimum_output_atomic, expires_at
        FROM transaction_intents WHERE id = ?1 LIMIT 1
      `).bind(body.intentId).first<IntentRow>();
      if (!intent || intent.action !== "sportpad_burn" || intent.state !== "planned") {
        return privateJson({ error: "That burn intent is no longer signable." }, 409);
      }
      const burnSettlement = await settlementById(intent.settlement_id);
      if (!burnSettlement) return privateJson({ error: "Settlement not found." }, 404);
      requireCommunityLaunchSettlement(burnSettlement);
      if (Date.parse(intent.expires_at) <= Date.now()) return privateJson({ error: "That burn transaction expired. Prepare a new burn." }, 409);
      if (walletSession.walletAddress !== intent.signer_address) return privateJson({ error: "The signed wallet does not match this burn intent." }, 403);
      let signed: Transaction;
      try { signed = Transaction.from(Buffer.from(body.signedTransactionBase64, "base64")); } catch { return privateJson({ error: "The signed burn transaction is unreadable." }, 400); }
      if (await legacyTransactionMessageHash(signed) !== intent.transaction_message_hash) {
        return privateJson({ error: "The signed burn transaction does not match the exact intent." }, 400);
      }
      const signer = signed.signatures.find((entry) => entry.publicKey.toBase58() === intent.signer_address);
      if (!signer?.signature || !ed25519.verify(signer.signature, signed.serializeMessage(), new PublicKey(intent.signer_address).toBytes())) {
        return privateJson({ error: "The buyback treasury signature is invalid." }, 400);
      }
      const claimed = await env.DB.prepare(`
        UPDATE transaction_intents SET state = 'submitting', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND state = 'planned'
      `).bind(intent.id).run();
      if (Number(claimed.meta.changes ?? 0) !== 1) return privateJson({ error: "That burn intent is already being submitted." }, 409);
      let signature: string;
      try {
        signature = await submitSignedMainnetTransaction(signed);
      } catch (error) {
        await env.DB.prepare(`UPDATE transaction_intents SET state = 'submission_unknown', error_code = 'burn_submit_unknown', updated_at = CURRENT_TIMESTAMP WHERE id = ?1`)
          .bind(intent.id).run();
        throw error;
      }
      const stepId = `step:${intent.settlement_id}:burn`;
      const eventId = `burn:${intent.id}`;
      await env.DB.batch([
        env.DB.prepare(`UPDATE transaction_intents SET state = 'submitted', tx_signature = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'submitting'`)
          .bind(intent.id, signature),
        env.DB.prepare(`
          INSERT INTO settlement_steps (
            id, settlement_id, stage, idempotency_key, state, input_mint, input_amount_atomic,
            tx_signature, attempt
          ) VALUES (?1, ?2, 'burn', ?3, 'submitted', ?4, ?5, ?6, 1)
          ON CONFLICT(idempotency_key) DO UPDATE SET
            state = excluded.state, tx_signature = excluded.tx_signature,
            attempt = settlement_steps.attempt + 1, updated_at = CURRENT_TIMESTAMP
        `).bind(stepId, intent.settlement_id, `settlement:${intent.settlement_id}:burn`, intent.input_mint, intent.input_amount_atomic, signature),
        env.DB.prepare(`UPDATE settlements SET burn_signature = ?2, state = 'burn_submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND burn_signature IS NULL`)
          .bind(intent.settlement_id, signature),
        env.DB.prepare(`
          INSERT OR IGNORE INTO protocol_events (
            id, category, entity_type, entity_id, event_type, idempotency_key, state,
            signature, amount_atomic, mint
          ) VALUES (?1, 'settlement', 'settlement', ?2, 'sportpad_burn_submitted', ?1, 'submitted', ?3, ?4, ?5)
        `).bind(eventId, intent.settlement_id, signature, intent.input_amount_atomic, intent.input_mint),
      ]);
      return privateJson({ ok: true, signature });
    }
    return privateJson({ error: "Unknown settlement action." }, 400);
  } catch (error) {
    console.error("operator_swap_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: error instanceof Error ? error.message : "The settlement action failed safely." }, 503);
  }
}
