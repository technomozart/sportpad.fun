import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

/** Add only after a published launch's immutable Pump 80/20 config has been
 * checked. This table is not seeded or used by a scheduled worker. */
export const INSERT_PAUSED_PUMP_FEE_COLLECTION_POLICY_SQL = `
  INSERT INTO pump_fee_collection_policies
    (launch_id, mint, collector_signer, reward_treasury, buyback_treasury)
  VALUES (?1, ?2, ?3, ?4, ?5)
`;

export const ARM_PUMP_FEE_COLLECTION_POLICY_SQL = `
  UPDATE pump_fee_collection_policies SET state = 'armed',
    updated_at = CURRENT_TIMESTAMP
  WHERE launch_id = ?1 AND state = 'paused'
`;

export const PAUSE_PUMP_FEE_COLLECTION_POLICY_SQL = `
  UPDATE pump_fee_collection_policies SET state = 'paused',
    updated_at = CURRENT_TIMESTAMP
  WHERE launch_id = ?1 AND state = 'armed'
`;

/** The INSERT trigger checks the paused/armed policy and published launch.
 * The row starts unverified: signature validity alone says nothing about
 * instruction effects, lookup tables, CPI, or the Pump fee distribution. */
export const INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL = `
  INSERT INTO pump_fee_collection_intents
    (id, launch_id, mint, collector_signer, reward_treasury,
      buyback_treasury, recent_blockhash, last_valid_block_height,
      history_anchor_signature, signed_transaction_base64,
      signed_transaction_sha256, source_signature)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
`;

/** Signed transaction bytes are bearer-spend data. Only the authenticated
 * dedicated collector worker should ever query this row, after a separate
 * exact effect attestation. Migration 0026 forbids any such attestation;
 * there is presently no caller. */
export const SELECT_VERIFIED_PUMP_FEE_COLLECTION_SQL = `
  SELECT intent.* FROM pump_fee_collection_intents intent
  JOIN pump_fee_collection_policies policy ON policy.launch_id = intent.launch_id
  JOIN launch_drafts launch ON launch.id = intent.launch_id
  WHERE intent.id = ?1 AND intent.state = 'prepared'
    AND intent.instruction_effect_state = 'verified'
    AND intent.instruction_evidence_json IS NOT NULL
    AND policy.state = 'armed' AND launch.status = 'mainnet_published'
  LIMIT 1
`;

/** Commit this one-way marker before the first sendRawTransaction call. The
 * caller must assert one affected row and must not build a replacement if the
 * response is lost. Bind current finalized block height at ?4. */
export const MARK_PUMP_FEE_COLLECTION_BROADCAST_SQL = `
  UPDATE pump_fee_collection_intents SET state = 'broadcast_attempted',
    broadcast_attempted_at_ms = ?3, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2 AND state = 'prepared'
    AND instruction_effect_state = 'verified'
    AND instruction_evidence_json IS NOT NULL
    AND ?3 > 0 AND ?4 > 0 AND ?4 <= last_valid_block_height
    AND EXISTS (SELECT 1 FROM pump_fee_collection_policies policy
      JOIN launch_drafts launch ON launch.id = policy.launch_id
      WHERE policy.launch_id = pump_fee_collection_intents.launch_id
        AND policy.state = 'armed' AND launch.status = 'mainnet_published'
        AND launch.mainnet_mint = pump_fee_collection_intents.mint)
`;

export const HOLD_PUMP_FEE_COLLECTION_SQL = `
  UPDATE pump_fee_collection_intents SET state = 'held',
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2 AND state = 'broadcast_attempted'
`;

/** The caller must independently verify a finalized successful receipt and
 * exact treasury deltas with the Pump distribution verifier. JSON fences the
 * persisted proof, but does not itself establish onchain truth. */
export const FINALIZE_PUMP_FEE_COLLECTION_SQL = `
  UPDATE pump_fee_collection_intents SET state = 'finalized',
    finalized_slot = ?3, finalized_evidence_json = ?4,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2
    AND state IN ('broadcast_attempted', 'held')
    AND broadcast_attempted_at_ms IS NOT NULL AND ?3 > 0
    AND json_valid(?4) AND json_type(?4) = 'object'
    AND NOT EXISTS (SELECT 1 FROM json_tree(?4)
      WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
    AND json_extract(?4, '$.finalized') = 1
    AND json_extract(?4, '$.transactionSucceeded') = 1
    AND json_extract(?4, '$.feeDistributionVerified') = 1
    AND json_extract(?4, '$.sourceSignature') = source_signature
    AND json_extract(?4, '$.signedTransactionSha256') = signed_transaction_sha256
    AND json_extract(?4, '$.mint') = mint
    AND json_extract(?4, '$.collectorSigner') = collector_signer
    AND json_extract(?4, '$.rewardTreasury') = reward_treasury
    AND json_extract(?4, '$.buybackTreasury') = buyback_treasury
    AND json_extract(?4, '$.finalizedSlot') = ?3
    AND json_type(?4, '$.rewardDeltaLamports') = 'text'
    AND json_type(?4, '$.buybackDeltaLamports') = 'text'
    AND json_extract(?4, '$.rewardDeltaLamports') GLOB '[0-9]*'
    AND json_extract(?4, '$.rewardDeltaLamports') NOT GLOB '*[^0-9]*'
    AND json_extract(?4, '$.buybackDeltaLamports') GLOB '[0-9]*'
    AND json_extract(?4, '$.buybackDeltaLamports') NOT GLOB '*[^0-9]*'
`;

/** An absent status/receipt alone is not enough to authorize another signed
 * collection. A future verifier must prove finalized history reaches the
 * pre-broadcast anchor and still contains no matching signature. */
export const EXPIRE_PUMP_FEE_COLLECTION_SQL = `
  UPDATE pump_fee_collection_intents SET state = 'expired',
    expired_observed_block_height = ?3, expiry_evidence_json = ?4,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2
    AND state IN ('prepared', 'broadcast_attempted', 'held')
    AND ?3 > last_valid_block_height
    AND json_valid(?4) AND json_type(?4) = 'object'
    AND NOT EXISTS (SELECT 1 FROM json_tree(?4)
      WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
    AND json_extract(?4, '$.finalized') = 1
    AND json_extract(?4, '$.blockhashValid') = 0
    AND json_extract(?4, '$.transactionAbsent') = 1
    AND json_extract(?4, '$.finalizedHistoryCoversAnchor') = 1
    AND json_extract(?4, '$.sourceSignature') = source_signature
    AND json_extract(?4, '$.historyAnchorSignature') = history_anchor_signature
    AND json_extract(?4, '$.recentBlockhash') = recent_blockhash
    AND json_extract(?4, '$.lastValidBlockHeight') = last_valid_block_height
    AND json_extract(?4, '$.observedBlockHeight') = ?3
`;

export type PreparedPumpFeeCollectionIntent = {
  id: string;
  launchId: string;
  mint: string;
  collectorSigner: string;
  rewardTreasury: string;
  buybackTreasury: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  historyAnchorSignature: string;
  signedTransactionBase64: string;
  signedTransactionSha256: string;
  sourceSignature: string;
  instructionEffectState: "unverified";
};

function canonicalAddress(value: string, label: string): string {
  let address: PublicKey;
  try { address = new PublicKey(value); }
  catch { throw new Error(`fee_collection_${label}_invalid`); }
  if (address.toBase58() !== value) throw new Error(`fee_collection_${label}_invalid`);
  return value;
}

/** Cryptographically validates the stored Solana signatures and identity.
 * This deliberately does NOT certify the instruction effects. */
export async function createPreparedPumpFeeCollectionIntent(input: {
  id: string;
  launchId: string;
  mint: string;
  collectorSigner: string;
  rewardTreasury: string;
  buybackTreasury: string;
  lastValidBlockHeight: number;
  historyAnchorSignature: string;
  signedTransactionBase64: string;
}): Promise<PreparedPumpFeeCollectionIntent> {
  if (!input.id || input.id.length > 128 || !input.launchId ||
      input.launchId.length > 128) throw new Error("fee_collection_identity_invalid");
  const mint = canonicalAddress(input.mint, "mint");
  const collectorSigner = canonicalAddress(input.collectorSigner, "collector_signer");
  const rewardTreasury = canonicalAddress(input.rewardTreasury, "reward_treasury");
  const buybackTreasury = canonicalAddress(input.buybackTreasury, "buyback_treasury");
  if (!PublicKey.isOnCurve(new PublicKey(collectorSigner).toBytes()) ||
      collectorSigner === rewardTreasury || collectorSigner === buybackTreasury ||
      rewardTreasury === buybackTreasury) {
    throw new Error("fee_collection_dedicated_signer_invalid");
  }
  if (!Number.isSafeInteger(input.lastValidBlockHeight) ||
      input.lastValidBlockHeight <= 0) {
    throw new Error("fee_collection_block_height_invalid");
  }
  let anchorBytes: Uint8Array;
  try { anchorBytes = bs58.decode(input.historyAnchorSignature); }
  catch { throw new Error("fee_collection_history_anchor_signature_invalid"); }
  if (anchorBytes.length !== 64 ||
      bs58.encode(anchorBytes) !== input.historyAnchorSignature) {
    throw new Error("fee_collection_history_anchor_signature_invalid");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.signedTransactionBase64)) {
    throw new Error("fee_collection_transaction_base64_invalid");
  }
  const serialized = Buffer.from(input.signedTransactionBase64, "base64");
  if (serialized.length < 100 || serialized.length > 1232 ||
      serialized.toString("base64") !== input.signedTransactionBase64) {
    throw new Error("fee_collection_transaction_size_or_encoding_invalid");
  }
  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(serialized); }
  catch { throw new Error("fee_collection_transaction_invalid"); }
  const message = transaction.message.serialize();
  const signer = transaction.message.staticAccountKeys[0];
  const signature = transaction.signatures[0];
  const required = transaction.message.header.numRequiredSignatures;
  if (!signer || signer.toBase58() !== collectorSigner ||
      !transaction.message.recentBlockhash ||
      required < 1 || required > transaction.message.staticAccountKeys.length ||
      transaction.signatures.length !== required || !signature ||
      !transaction.signatures.every((signed, index) =>
        signed.length === 64 && signed.some((byte) => byte !== 0) &&
        ed25519.verify(signed, message,
          transaction.message.staticAccountKeys[index].toBytes()))) {
    throw new Error("fee_collection_signature_invalid");
  }
  const sourceSignature = bs58.encode(signature);
  if (sourceSignature === input.historyAnchorSignature) {
    throw new Error("fee_collection_history_anchor_reused");
  }
  const digest = await crypto.subtle.digest("SHA-256", serialized);
  return {
    id: input.id, launchId: input.launchId, mint, collectorSigner,
    rewardTreasury, buybackTreasury,
    recentBlockhash: transaction.message.recentBlockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
    historyAnchorSignature: input.historyAnchorSignature,
    signedTransactionBase64: input.signedTransactionBase64,
    signedTransactionSha256: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    sourceSignature, instructionEffectState: "unverified",
  };
}

export function pumpFeeCollectionInsertBindings(intent: PreparedPumpFeeCollectionIntent) {
  return [intent.id, intent.launchId, intent.mint, intent.collectorSigner,
    intent.rewardTreasury, intent.buybackTreasury, intent.recentBlockhash,
    intent.lastValidBlockHeight, intent.historyAnchorSignature,
    intent.signedTransactionBase64, intent.signedTransactionSha256,
    intent.sourceSignature] as const;
}
