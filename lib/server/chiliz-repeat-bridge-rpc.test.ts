import assert from "node:assert/strict";
import test from "node:test";
import { independentChilizRpcOrigins } from "./chiliz-repeat-bridge-rpc.ts";

test("requires independent HTTPS RPC origins, not merely distinct URL paths", () => {
  assert.equal(independentChilizRpcOrigins(
    "https://rpc.chiliz.com/one", "https://rpc.chiliz.com/two"), false);
  assert.equal(independentChilizRpcOrigins(
    "https://rpc.chiliz.com", "https://chiliz-rpc.publicnode.com"), true);
  assert.equal(independentChilizRpcOrigins(
    "http://rpc.chiliz.com", "https://chiliz-rpc.publicnode.com"), false);
  assert.equal(independentChilizRpcOrigins(
    "https://user@rpc.chiliz.com", "https://chiliz-rpc.publicnode.com"), false);
});
