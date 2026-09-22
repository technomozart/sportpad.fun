import "server-only";

export async function acquireWorkerLease({
  database,
  key,
  owner,
  ttlSeconds = 55,
}: {
  database: D1Database;
  key: string;
  owner: string;
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  const result = await database.prepare(`
    INSERT INTO worker_leases (key, owner, expires_at, acquired_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?4)
    ON CONFLICT(key) DO UPDATE SET
      owner = excluded.owner,
      expires_at = excluded.expires_at,
      acquired_at = excluded.acquired_at,
      updated_at = excluded.updated_at
    WHERE worker_leases.expires_at <= ?4 OR worker_leases.owner = ?2
  `).bind(key, owner, expiresAt, now).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function releaseWorkerLease(database: D1Database, key: string, owner: string) {
  await database.prepare("DELETE FROM worker_leases WHERE key = ?1 AND owner = ?2").bind(key, owner).run();
}
