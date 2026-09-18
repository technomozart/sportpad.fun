import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { getRewardAsset, REWARD_ASSETS } from "./reward-assets.ts";

test("official reward registry contains 82 unique symbols and Solana mints", () => {
  const symbols = new Set(REWARD_ASSETS.map((asset) => asset.symbol));
  const mints = new Set(REWARD_ASSETS.map((asset) => asset.solanaMint));

  assert.equal(REWARD_ASSETS.length, 82);
  assert.equal(symbols.size, 82, "reward symbols must be unique");
  assert.equal(mints.size, 82, "Solana mint addresses must be unique");
});

test("every registry entry is disabled for execution and has a local image", () => {
  for (const asset of REWARD_ASSETS) {
    assert.equal(asset.executionStatus, "not_enabled", `${asset.symbol} must remain execution-disabled`);
    assert.match(asset.solanaMint, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, `${asset.symbol} must use a plausible base58 Solana mint`);

    const relativeImagePath = asset.imagePath.replace(/^[/\\]+/, "");
    const imagePath = path.join(process.cwd(), "public", relativeImagePath);
    assert.ok(existsSync(imagePath), `${asset.symbol} image is missing at ${imagePath}`);
    assert.ok(statSync(imagePath).size > 0, `${asset.symbol} image must not be empty`);
  }
});

test("TIGRES and UFC are present in the official reward registry", () => {
  const tigres = getRewardAsset("tigres");
  const ufc = getRewardAsset("UFC");

  assert.equal(tigres?.symbol, "TIGRES");
  assert.equal(tigres?.category, "Football");
  assert.equal(ufc?.symbol, "UFC");
  assert.equal(ufc?.category, "Combat");
});
