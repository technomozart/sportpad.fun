import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";

import { requireExistingTreasuryAta } from "./solana-existing-ata.mjs";

test("requires the finalized, exact treasury ATA without any creation call", async () => {
  const owner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const address = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID);
  let reads = 0;
  const account = await requireExistingTreasuryAta({
    connection: {}, mint, owner, tokenProgram: TOKEN_PROGRAM_ID,
    readAccount: async (_connection, requested, commitment, tokenProgram) => {
      reads += 1;
      assert.equal(requested.toBase58(), address.toBase58());
      assert.equal(commitment, "finalized");
      assert.equal(tokenProgram.toBase58(), TOKEN_PROGRAM_ID.toBase58());
      return { address, owner, mint, isInitialized: true, isFrozen: false,
        delegate: null, closeAuthority: null };
    },
  });
  assert.equal(reads, 1);
  assert.equal(account.address.toBase58(), address.toBase58());
});

test("missing or mismatched treasury ATA fails closed", async () => {
  const owner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const address = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID);
  const base = { connection: {}, mint, owner, tokenProgram: TOKEN_PROGRAM_ID };
  await assert.rejects(requireExistingTreasuryAta({ ...base,
    readAccount: async () => { throw new Error("not found"); },
  }), /treasury_output_ata_not_ready/);
  const valid = { address, owner, mint, isInitialized: true, isFrozen: false,
    delegate: null, closeAuthority: null };
  for (const wrong of [
    { ...valid, address: Keypair.generate().publicKey },
    { ...valid, owner: Keypair.generate().publicKey },
    { ...valid, mint: Keypair.generate().publicKey },
    { ...valid, isInitialized: false },
    { ...valid, isFrozen: true },
    { ...valid, delegate: Keypair.generate().publicKey },
    { ...valid, closeAuthority: Keypair.generate().publicKey },
  ]) {
    await assert.rejects(requireExistingTreasuryAta({ ...base,
      readAccount: async () => wrong,
    }), /treasury_output_ata_mismatch/);
  }
});

test("both purchase lanes check existing ATAs before arming or requesting a quote", () => {
  const source = readFileSync(new URL("./solana-automation-worker.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getOrCreateAssociatedTokenAccount/);
  const buyback = source.split("async function buyAndBurn(")[1]?.split("async function buyRewards(")[0];
  const rewards = source.split("async function buyRewards(")[1]?.split("async function finalizePreparedSolanaClaim(")[0];
  for (const lane of [buyback, rewards]) {
    assert.ok(lane);
    const guard = lane.indexOf("await requireExistingTreasuryAta(");
    assert.ok(guard >= 0);
    assert.ok(guard < lane.indexOf("await arm()"));
    assert.ok(guard < lane.indexOf("new URL(ORDER_URL)"));
  }
});
