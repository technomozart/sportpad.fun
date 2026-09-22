import { readWorkerToken } from "@/lib/server/execution-config";
import { observeTreasuries } from "@/lib/server/workers/treasury-observer";

function unauthorized() {
  return Response.json({ error: "Worker authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

async function secureTokenEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) mismatch |= leftBytes[index] ^ rightBytes[index];
  return mismatch === 0;
}

export async function POST(request: Request) {
  const configuredToken = readWorkerToken();
  if (!configuredToken) {
    return Response.json({ error: "Worker endpoint is locked." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!suppliedToken || !(await secureTokenEqual(configuredToken, suppliedToken))) return unauthorized();
  try {
    return Response.json({ ok: true, result: await observeTreasuries("internal") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("treasury_worker_failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Treasury observation failed." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
