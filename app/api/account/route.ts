import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";
import { isOperatorUserId } from "@/lib/server/publication-policy";

function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  const principalId = getLaunchDraftOwner(request);
  return privateJson({
    authenticated: Boolean(principalId),
    isOperator: isOperatorUserId(principalId),
    principalId,
  });
}
