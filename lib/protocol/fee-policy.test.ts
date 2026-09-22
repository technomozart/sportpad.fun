import assert from "node:assert/strict";
import test from "node:test";

import { isCommunityLaunchFeeSource, launchFeePolicy } from "./fee-policy.ts";

test("SPORTPAD keeps its own creator fees for project development", () => {
  const sportpadMint = "SportPad111111111111111111111111111111111";
  assert.equal(launchFeePolicy(sportpadMint, sportpadMint), "sportpad_development");
  assert.equal(isCommunityLaunchFeeSource(sportpadMint, sportpadMint), false);
});

test("community launches retain the 80/20 rewards and SPORTPAD burn policy", () => {
  assert.equal(launchFeePolicy("Community1111111111111111111111111111111", "SportPad111111111111111111111111111111111"), "community_80_20");
  assert.equal(isCommunityLaunchFeeSource("Community1111111111111111111111111111111", null), true);
});
