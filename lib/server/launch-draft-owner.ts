export function getLaunchDraftOwner(request: Request) {
  const authenticatedOwner = request.headers.get("oai-authenticated-user-id");
  // Reserve wallet:* exclusively for principals proven by a signed wallet
  // challenge. Dispatch-provided account IDs may never claim that namespace.
  if (authenticatedOwner && /^[A-Za-z0-9:_-]{1,128}$/.test(authenticatedOwner) && !authenticatedOwner.startsWith("wallet:")) {
    return authenticatedOwner;
  }

  return null;
}
