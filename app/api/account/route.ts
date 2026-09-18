import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";

function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  return privateJson({ authenticated: Boolean(getLaunchDraftOwner(request)) });
}
