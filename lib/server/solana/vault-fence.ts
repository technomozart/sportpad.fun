/** Every automatic ledger mutation for one physical treasury ATA must touch
 * the same D1 row. A stale aggregate-balance read then loses this CAS and is
 * retried against fresh obligations before any vault credit is committed. */
export const UPDATE_SOLANA_VAULT_FENCE_SQL = `
  UPDATE service_cursors SET value = ?3, updated_at = CURRENT_TIMESTAMP
  WHERE key = ?1 AND value = ?2
`;

export async function readSolanaVaultFence(database: D1Database, treasury: string, mint: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(treasury) ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw new Error("solana_vault_fence_identity_invalid");
  const key = `solana-vault-fence:${treasury}:${mint}`;
  await database.prepare(`
    INSERT OR IGNORE INTO service_cursors (key, value, updated_at)
    VALUES (?1, '0', CURRENT_TIMESTAMP)
  `).bind(key).run();
  const row = await database.prepare("SELECT value FROM service_cursors WHERE key = ?1")
    .bind(key).first<{ value: string }>();
  if (!row) throw new Error("solana_vault_fence_missing");
  return { key, priorValue: row.value, nextValue: crypto.randomUUID() };
}
