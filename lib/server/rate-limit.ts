import { env } from "cloudflare:workers";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export async function consumeFixedWindow({
  scope,
  subject,
  limit,
  windowSeconds,
}: {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  if (!env.DB) throw new Error("D1 binding `DB` is unavailable.");
  if (!/^[a-z0-9:_-]{1,64}$/.test(scope) || !subject || subject.length > 256) {
    throw new TypeError("Invalid rate-limit key.");
  }
  const now = Math.floor(Date.now() / 1_000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const expiresAt = windowStart + windowSeconds;
  const key = `${scope}:${windowStart}:${subject}`;
  const row = await env.DB.prepare(`
    INSERT INTO rate_limit_windows (key, count, window_expires_at, updated_at)
    VALUES (?1, 1, ?2, ?3)
    ON CONFLICT(key) DO UPDATE SET
      count = rate_limit_windows.count + 1,
      updated_at = excluded.updated_at
    RETURNING count
  `).bind(key, expiresAt, now).first<{ count: number }>();
  if (!row || !Number.isSafeInteger(row.count)) throw new Error("Rate limit could not be recorded.");
  return {
    allowed: row.count <= limit,
    limit,
    remaining: Math.max(0, limit - row.count),
    retryAfterSeconds: Math.max(1, expiresAt - now),
  };
}

export function rateLimitedJson(message: string, result: RateLimitResult) {
  return Response.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}
