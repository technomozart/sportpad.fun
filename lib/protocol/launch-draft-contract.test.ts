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
  assert.equal(launchDraftPayloadSchema.safeParse({ ...validPayload, symbol: "SPORTPAD" }).success, false);
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
  assert.match(routeSource, /function serializeDraft/);
  assert.doesNotMatch(routeSource, /\.\.\.safeDraft/);
  assert.doesNotMatch(routeSource, /moderationActorUserId/);
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
  const moderationTransitionSource = readProjectFile("lib", "server", "moderation-transition.ts");
  const verifierSource = readProjectFile("lib", "server", "solana", "devnet.ts");
  const schemaSource = readProjectFile("db", "schema.ts");

  assert.ok(
    clientSource.indexOf("await onSubmitted") < clientSource.indexOf("sendRawTransaction"),
    "signed evidence must be persisted before the transaction is broadcast",
  );
  assert.match(routeSource, /record_create_submission/);
  assert.match(routeSource, /record_fee_submission/);
  assert.match(routeSource, /commitModerationTransition/);
  assert.match(routeSource, /action: "verify_devnet"/);
  assert.match(routeSource, /publicationAccepted/);
  assert.match(routeSource, /isNull\(launchDrafts\.devnetCreateSignature\)/);
  assert.match(moderationTransitionSource, /isNull\(launchDrafts\.devnetFeeSignature\)/);
  assert.match(moderationTransitionSource, /isNull\(launchDrafts\.devnetVerifiedAt\)/);
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

test("mainnet launch fails closed, freezes treasuries, and verifies exact onchain evidence", () => {
  const clientSource = readProjectFile("lib", "client", "pump-mainnet.ts");
  const panelSource = readProjectFile("app", "launch", "mainnet-launch-panel.tsx");
  const routeSource = readProjectFile("app", "api", "launch-drafts", "[id]", "mainnet", "route.ts");
  const configSource = readProjectFile("lib", "server", "mainnet-config.ts");
  const walletSessionSource = readProjectFile("lib", "server", "wallet-session.ts");
  const schemaSource = readProjectFile("db", "schema.ts");

  assert.ok(
    clientSource.indexOf("await onSubmitted") < clientSource.indexOf("sendRawTransaction"),
    "signed mainnet evidence must be persisted locally before broadcast",
  );
  assert.match(configSource, /MAINNET_EXECUTION_ENABLED/);
  assert.match(configSource, /SOLANA_REWARD_TREASURY_ADDRESS/);
  assert.match(configSource, /SOLANA_BUYBACK_TREASURY_ADDRESS/);
  assert.match(walletSessionSource, /sportpad_mainnet_wallet_session_v1/);
  assert.match(routeSource, /checkRewardRoute/);
  assert.match(routeSource, /readLaunchAutomationReadiness\(env\.DB, rewardChain, config\.buybackTreasury\)/);
  assert.ok(
    routeSource.indexOf('if (input.action === "prepare")') < routeSource.indexOf("readLaunchAutomationReadiness(env.DB, rewardChain"),
    "the automation gate must run inside prepare, before a new mainnet coin can be signed",
  );
  assert.ok(
    routeSource.indexOf("readLaunchAutomationReadiness(env.DB, rewardChain") < routeSource.indexOf("// Verification must never be blocked"),
    "previously signed mainnet evidence must be verifiable after the preflight gate closes",
  );
  assert.match(panelSource, /New mainnet launches are paused until reward and buyback automation are verified/);
  assert.match(panelSource, /Boolean\(pending\.create && pending\.fee\)/);
  assert.ok(
    panelSource.indexOf('await post({ action: "prepare", publicationAccepted: true });', panelSource.indexOf("if (!work.fee)"))
      < panelSource.indexOf("configurePumpMainnetFeeSplit", panelSource.indexOf("if (!work.fee)")),
    "a new fee-lock signature requires a fresh server-side automation preflight",
  );
  assert.match(routeSource, /verifyPumpMainnetCreate/);
  assert.match(routeSource, /verifyPumpMainnetFeeSplit/);
  assert.match(routeSource, /mainnetRewardTreasury: config\.rewardTreasury/);
  assert.match(routeSource, /mainnetBuybackTreasury: config\.buybackTreasury/);
  assert.match(routeSource, /status: "mainnet_published"/);
  assert.match(routeSource, /isNull\(launchDrafts\.mainnetMint\)/);
  assert.ok(
    panelSource.indexOf('post({ action: "prepare"') < panelSource.indexOf("createPumpMainnetCoin"),
    "the live reward route must be rechecked immediately before signing",
  );
  assert.match(schemaSource, /idx_launch_drafts_mainnet_mint/);
  assert.match(schemaSource, /idx_launch_drafts_mainnet_fee_signature/);
});
