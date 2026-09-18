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
  assert.match(routeSource, /const \{ imageKey, ownerUserId: _ownerUserId, \.\.\.safeDraft \} = draft/);
  assert.match(routeSource, /void _ownerUserId/);
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

test("private drafts can be listed and resumed only through the authenticated owner API", () => {
  const builderSource = readProjectFile("app", "launch", "launch-builder.tsx");
  const routeSource = readProjectFile("app", "api", "launch-drafts", "route.ts");
  const accountRouteSource = readProjectFile("app", "api", "account", "route.ts");

  assert.match(builderSource, /fetch\("\/api\/launch-drafts", \{ cache: "no-store"/);
  assert.match(builderSource, /function resumeDraft\(draft: SavedLaunchDraft\)/);
  assert.match(builderSource, /\/signin-with-chatgpt\?return_to=%2Flaunch/);
  assert.match(routeSource, /eq\(launchDrafts\.ownerUserId, ownerUserId\)/);
  assert.match(routeSource, /Cache-Control": "private, no-store"/);
  assert.match(accountRouteSource, /getLaunchDraftOwner\(request\)/);
  assert.doesNotMatch(accountRouteSource, /ownerUserId/);
});

test("devnet launch records signed evidence before broadcast and finalizes with database guards", () => {
  const clientSource = readProjectFile("lib", "client", "pump-devnet.ts");
  const routeSource = readProjectFile("app", "api", "launch-drafts", "[id]", "devnet", "route.ts");
  const verifierSource = readProjectFile("lib", "server", "solana", "devnet.ts");
  const schemaSource = readProjectFile("db", "schema.ts");

  assert.ok(
    clientSource.indexOf("await onSubmitted") < clientSource.indexOf("sendRawTransaction"),
    "signed evidence must be persisted before the transaction is broadcast",
  );
  assert.match(routeSource, /record_create_submission/);
  assert.match(routeSource, /record_fee_submission/);
  assert.match(routeSource, /publicationAccepted/);
  assert.match(routeSource, /isNull\(launchDrafts\.devnetCreateSignature\)/);
  assert.match(routeSource, /isNull\(launchDrafts\.devnetFeeSignature\)/);
  assert.match(routeSource, /exactSubmissionWhere\(recorded, "recorded"\)/);
  assert.match(routeSource, /creatorWallet: recorded\.creatorWallet/);
  assert.match(routeSource, /metadataUri: recorded\.metadataUri/);
  assert.match(routeSource, /invalidBlockhashObservedAt: Date\.now\(\)/);
  assert.match(verifierSource, /isBlockhashValid\(/);
  assert.match(verifierSource, /INVALID_BLOCKHASH_GRACE_MS/);
  assert.match(schemaSource, /idx_launch_drafts_devnet_mint/);
  assert.match(schemaSource, /idx_devnet_submissions_signature/);
  assert.match(schemaSource, /creatorWallet: text\("creator_wallet"\)/);
  assert.match(schemaSource, /invalidBlockhashObservedAt: integer\("invalid_blockhash_observed_at"\)/);
});
