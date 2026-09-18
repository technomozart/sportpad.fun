export function getLaunchDraftOwner(request: Request) {
  const authenticatedOwner = request.headers.get("oai-authenticated-user-id");
  if (authenticatedOwner && /^[A-Za-z0-9:_-]{1,128}$/.test(authenticatedOwner)) {
    return authenticatedOwner;
  }

  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return "local-preview-user";
  }
  return null;
}
