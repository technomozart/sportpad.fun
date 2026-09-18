import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_LAUNCH_IMAGE_BYTES,
  MAX_LAUNCH_IMAGE_DIMENSION,
  validateLaunchImage,
} from "./launch-image.ts";

const validPng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

function structuralJpeg(width = 1, height = 1) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00,
    0xff, 0xd9,
  ]);
}

function structuralWebp(width = 1, height = 1) {
  const sizeBits = ((height - 1) << 14) | (width - 1);
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46,
    0x12, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c,
    0x06, 0x00, 0x00, 0x00,
    0x2f,
    sizeBits & 0xff,
    (sizeBits >>> 8) & 0xff,
    (sizeBits >>> 16) & 0xff,
    (sizeBits >>> 24) & 0xff,
    0x00,
  ]);
}

test("validates complete PNG, JPEG, and WebP containers and dimensions", () => {
  assert.deepEqual(validateLaunchImage(validPng, "image/png"), {
    ok: true,
    mime: "image/png",
    extension: "png",
    width: 1,
    height: 1,
  });
  assert.deepEqual(validateLaunchImage(structuralJpeg(), "image/jpeg"), {
    ok: true,
    mime: "image/jpeg",
    extension: "jpg",
    width: 1,
    height: 1,
  });
  assert.deepEqual(validateLaunchImage(structuralWebp(), "image/webp"), {
    ok: true,
    mime: "image/webp",
    extension: "webp",
    width: 1,
    height: 1,
  });
});

test("rejects empty, truncated, MIME-mismatched, oversized, and trailing data", () => {
  assert.equal(validateLaunchImage(new Uint8Array(), "image/png").ok, false);
  assert.equal(validateLaunchImage(validPng.slice(0, 4), "image/png").ok, false);
  assert.equal(validateLaunchImage(validPng, "image/jpeg").ok, false);
  assert.equal(validateLaunchImage(new Uint8Array(MAX_LAUNCH_IMAGE_BYTES + 1), "image/png").ok, false);

  const pngWithTrailingData = new Uint8Array(validPng.length + 1);
  pngWithTrailingData.set(validPng);
  assert.equal(validateLaunchImage(pngWithTrailingData, "image/png").ok, false);

  const webpWithWrongRiffSize = structuralWebp();
  webpWithWrongRiffSize[4] = 0x11;
  assert.equal(validateLaunchImage(webpWithWrongRiffSize, "image/webp").ok, false);
});

test("rejects dimensions beyond the launch image limit", () => {
  const result = validateLaunchImage(structuralJpeg(MAX_LAUNCH_IMAGE_DIMENSION + 1, 1), "image/jpeg");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid_dimensions");
});
