import assert from "node:assert/strict";
import test from "node:test";

import { isUuidV4 } from "./identifiers.ts";

test("accepts crypto.randomUUID draft IDs", () => {
  assert.equal(isUuidV4(crypto.randomUUID()), true);
  assert.equal(isUuidV4("c8d10423-04e1-4d91-a78d-390842607ea9"), true);
});

test("rejects malformed or non-v4 draft IDs", () => {
  assert.equal(isUuidV4("c8d10423-04e1-4d91-a78d390842607ea9"), false);
  assert.equal(isUuidV4("c8d10423-04e1-3d91-a78d-390842607ea9"), false);
  assert.equal(isUuidV4("../c8d10423-04e1-4d91-a78d-390842607ea9"), false);
});
