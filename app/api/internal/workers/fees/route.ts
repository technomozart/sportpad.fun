import { readWorkerToken } from "@/lib/server/execution-config";
import { secureTokenEqual, workerUnauthorized } from "@/lib/server/workers/auth";
import { runFeeIndexer } from "@/lib/server/workers/fee-indexer";

export async function POST(request: Request) {
  const configuredToken = readWorkerToken();
  if (!configuredToken) {
    return Response.json({ error: "Worker endpoint is locked." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!suppliedToken || !(await secureTokenEqual(configuredToken, suppliedToken))) return workerUnauthorized();
  try {
    return Response.json({ ok: true, result: await runFeeIndexer("internal") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("fee_indexer_failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Finalized Pump fee indexing failed." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
