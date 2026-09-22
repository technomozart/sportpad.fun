import assert from "node:assert/strict";
import test from "node:test";

import { KAYEN } from "../../protocol/chiliz-reward-assets.ts";
import { decodeKayenGetAmountsOut, encodeKayenGetAmountsOut } from "./chiliz-reward-route.ts";

function word(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

test("Kayen quote calldata uses the exact WCHZ to wrapped Fan Token path", () => {
  const output = "0x1111111111111111111111111111111111111111";
  const data = encodeKayenGetAmountsOut(output, 7n);

  assert.ok(data.startsWith("0xd06ca61f"));
  assert.ok(data.includes(KAYEN.wrappedChz.slice(2).toLowerCase()));
  assert.ok(data.endsWith(output.slice(2).toLowerCase()));
});

test("Kayen quote results decode the final path amount", () => {
  const encoded = `0x${word(32n)}${word(2n)}${word(1n)}${word(42n)}`;
  assert.equal(decodeKayenGetAmountsOut(encoded), 42n);
});
