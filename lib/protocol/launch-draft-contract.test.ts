import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { launchDraftPayloadSchema } from "./launch-draft-input.ts";

function readProjectFile(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const validPayload = {
  name: "The 12th Player",
  symbol: "player",
  sport: "Football",
  website: "",
  social: "https://x.com/sportpad",
  rewardSymbol: "PSG",
  attestations: { rights: true, unofficial: true, economics: true },
} as const;

test("draft schema accepts an omitted or empty description and enforces its maximum", () => {
  assert.equal(launchDraftPayloadSchema.parse(validPayload).description, "");
  assert.equal(launchDraftPayloadSchema.parse({ ...validPayload, description: "" }).description, "");
  assert.equal(launchDraftPayloadSchema.parse(validPayload).symbol, "PLAYER");
  assert.equal(
    launchDraftPayloadSchema.safeParse({ ...validPayload, description: "x".repeat(281) }).success,
    false,
  );
});

test("draft schema rejects malformed types, unsafe URLs, missing attestations, and unknown fields", () => {
  assert.equal(launchDraftPayloadSchema.safeParse(null).success, false);
  assert.equal(launchDraftPayloadSchema.safeParse({ ...validPayload, name: 7 }).success, false);
  assert.equal(launchDraftPayloadSchema.safeParse({ ...validPayload, website: "http://example.com" }).success, false);
  assert.equal(
    launchDraftPayloadSchema.safeParse({
      ...validPayload,
      attestations: { ...validPayload.attestations, rights: false },
    }).success,
    false,
  );
  assert.equal(launchDraftPayloadSchema.safeParse({ ...validPayload, unexpected: true }).success, false);
});

test("draft API requires one bounded multipart image and returns only a private image URL", () => {
  const routeSource = readProjectFile("app", "api", "launch-drafts", "route.ts");
  const imageRouteSource = readProjectFile("app", "api", "launch-drafts", "[id]", "image", "route.ts");

  assert.match(routeSource, /request\.headers\.get\("content-length"\)/);
  assert.match(routeSource, /payloadParts\.length !== 1/);
  assert.match(routeSource, /imageParts\.length !== 1/);
  assert.match(routeSource, /image\.size === 0/);
  assert.match(routeSource, /launchDraftPayloadSchema\.safeParse/);
  assert.match(routeSource, /imageStored: true/);
  assert.doesNotMatch(routeSource, /artworkStored/);
  assert.match(routeSource, /const \{ imageKey, \.\.\.safeDraft \} = draft/);
  assert.match(imageRouteSource, /eq\(launchDrafts\.ownerUserId, ownerUserId\)/);
  assert.match(imageRouteSource, /X-Content-Type-Options/);
  assert.match(imageRouteSource, /Cache-Control.*private, no-store/);
});

test("launch builder keeps description optional and verifies decoded image storage", () => {
  const builderSource = readProjectFile("app", "launch", "launch-builder.tsx");
  const canContinue = builderSource.match(/const canContinue = ([^;]+);/)?.[1];

  assert.ok(canContinue, "launch builder must define its continue requirements");
  assert.doesNotMatch(canContinue, /description/);
  assert.match(builderSource, />Description \(optional\)</);
  assert.match(builderSource, /createImageBitmap\(file\)/);
  assert.match(builderSource, /body\.imageStored !== true/);
  assert.doesNotMatch(builderSource, /artworkStored/);
});
