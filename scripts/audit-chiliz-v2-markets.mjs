// Read-only, dated market inspection. A quote is never authorization to launch,
// buy, or pay a Fan Token reward. This script uses no signing key.
import { CHILIZ_REWARD_ASSETS } from "../lib/protocol/chiliz-reward-assets.ts";
import { inspectChilizV2Market } from "../lib/server/providers/chiliz-reward-route.ts";

const results = new Array(CHILIZ_REWARD_ASSETS.length);
let next = 0;

await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < CHILIZ_REWARD_ASSETS.length) {
    const index = next++;
    const asset = CHILIZ_REWARD_ASSETS[index];
    const market = await inspectChilizV2Market(asset.currentV2Contract);
    results[index] = { symbol: asset.symbol, contract: asset.currentV2Contract, ...market };
  }
}));

const counts = Object.fromEntries([...new Set(results.map((row) => row.reason))]
  .sort().map((reason) => [reason, results.filter((row) => row.reason === reason).length]));
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  network: "Chiliz Chain",
  total: results.length,
  counts,
  note: "Read-only quotes and depth estimates do not approve execution or guarantee a future trade.",
  results,
}, null, 2));
