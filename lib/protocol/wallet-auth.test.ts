import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import {
  buildWalletChallenge,
  normalizeSolanaAddress,
  readCookie,
  sha256Base64Url,
  verifyWalletChallengeSignature,
  walletDraftOwnerId,
  walletSessionBelongsToRequester,
} from "./wallet-auth.ts";

const walletAddress = bs58.encode(crypto.getRandomValues(new Uint8Array(32)));
const challengeFields = {
  domain: "sportpad.fun",
  uri: "https://sportpad.fun",
  walletAddress,
  nonce: "test-nonce-123",
  issuedAt: new Date("2026-09-18T10:00:00.000Z"),
  expiresAt: new Date("2026-09-18T10:05:00.000Z"),
};
const challenge = buildWalletChallenge(challengeFields);

test("normalizes canonical 32-byte Solana addresses", () => {
  assert.equal(normalizeSolanaAddress(walletAddress), walletAddress);
  assert.equal(normalizeSolanaAddress("not-a-wallet"), null);
  assert.equal(normalizeSolanaAddress(`${walletAddress} `), walletAddress);
});

test("wallet-only draft owner requires the exact verified Solana address", () => {
  const ownerUserId = walletDraftOwnerId(walletAddress);
  assert.equal(ownerUserId, `wallet:${walletAddress}`);
  assert.equal(walletDraftOwnerId("not-a-wallet"), null);
  assert.equal(walletSessionBelongsToRequester({ ownerUserId: ownerUserId!, walletAddress }, null), true);
  assert.equal(walletSessionBelongsToRequester({ ownerUserId: "wallet:forged", walletAddress }, null), false);
});

test("legacy signed-in sessions cannot be reused by a different ChatGPT user", () => {
  const session = { ownerUserId: "user-one", walletAddress };
  assert.equal(walletSessionBelongsToRequester(session, "user-one"), true);
  assert.equal(walletSessionBelongsToRequester(session, "user-two"), false);
  assert.equal(walletSessionBelongsToRequester(session, null), false);
});

test("builds a domain, URI, wallet, nonce, and mainnet bound message", () => {
  assert.match(challenge, /^sportpad\.fun wants you to verify/);
  assert.match(challenge, new RegExp(`Wallet: ${walletAddress}`));
  assert.match(challenge, /Chain: solana:mainnet/);
  assert.match(challenge, /Nonce: test-nonce-123/);
  assert.match(challenge, /does not create a transaction or authorize spending/);
});

test("verifies the exact signed challenge and rejects changed content", async () => {
  const keypair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const signingWallet = bs58.encode(new Uint8Array(await crypto.subtle.exportKey("raw", keypair.publicKey)));
  const signedChallenge = buildWalletChallenge({ ...challengeFields, walletAddress: signingWallet });
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    keypair.privateKey,
    new TextEncoder().encode(signedChallenge),
  ));
  const signatureBase64 = Buffer.from(signature).toString("base64");
  assert.equal(await verifyWalletChallengeSignature({ walletAddress: signingWallet, message: signedChallenge, signatureBase64 }), true);
  assert.equal(await verifyWalletChallengeSignature({ walletAddress: signingWallet, message: `${signedChallenge}.`, signatureBase64 }), false);
  assert.equal(await verifyWalletChallengeSignature({ walletAddress: signingWallet, message: signedChallenge, signatureBase64: "bad" }), false);
  const otherWallet = bs58.encode(crypto.getRandomValues(new Uint8Array(32)));
  assert.equal(await verifyWalletChallengeSignature({ walletAddress: otherWallet, message: signedChallenge, signatureBase64 }), false);
  const otherChallenge = buildWalletChallenge({ ...challengeFields, walletAddress: otherWallet });
  const wrongKeySignature = Buffer.from(await crypto.subtle.sign(
    { name: "Ed25519" }, keypair.privateKey, new TextEncoder().encode(otherChallenge),
  )).toString("base64");
  assert.equal(await verifyWalletChallengeSignature({ walletAddress: otherWallet, message: otherChallenge, signatureBase64: wrongKeySignature }), false);
});

test("rejects the low-order zero-key and zero-signature forgery", async () => {
  const zeroWallet = bs58.encode(new Uint8Array(32));
  assert.equal(await verifyWalletChallengeSignature({
    walletAddress: zeroWallet,
    message: buildWalletChallenge({ ...challengeFields, walletAddress: zeroWallet }),
    signatureBase64: Buffer.alloc(64).toString("base64"),
  }), false);
});

test("rejects the low-order identity-key and identity-R forgery", async () => {
  const identity = new Uint8Array(32);
  identity[0] = 1;
  const identityWallet = bs58.encode(identity);
  const forgedSignature = new Uint8Array(64);
  forgedSignature[0] = 1;
  assert.equal(await verifyWalletChallengeSignature({
    walletAddress: identityWallet,
    message: buildWalletChallenge({ ...challengeFields, walletAddress: identityWallet }),
    signatureBase64: Buffer.from(forgedSignature).toString("base64"),
  }), false);
});

test("parses an exact cookie name and hashes session tokens", async () => {
  assert.equal(readCookie("a=1; sportpad_wallet_session=token-value; b=2", "sportpad_wallet_session"), "token-value");
  assert.equal(readCookie("sportpad_wallet_session_extra=no", "sportpad_wallet_session"), null);
  assert.equal((await sha256Base64Url("secret")).length, 43);
});
