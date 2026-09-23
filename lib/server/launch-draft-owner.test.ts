import assert from "node:assert/strict";
import test from "node:test";

import { getLaunchDraftOwner } from "./launch-draft-owner.ts";

test("reserves the wallet principal namespace for signed wallet sessions", () => {
  const makeRequest = (principal: string) => new Request("https://sportpad.fun/api/account", {
    headers: { "oai-authenticated-user-id": principal },
  });
  assert.equal(getLaunchDraftOwner(makeRequest("user_123")), "user_123");
  assert.equal(getLaunchDraftOwner(makeRequest("wallet:forged")), null);
  assert.equal(getLaunchDraftOwner(makeRequest("wallet:abc")), null);
});

test("anonymous public visitors never receive the local preview principal", () => {
  assert.equal(getLaunchDraftOwner(new Request("https://sportpad.fun/launch")), null);
  assert.equal(getLaunchDraftOwner(new Request("http://localhost:5173/launch")), null);
});
