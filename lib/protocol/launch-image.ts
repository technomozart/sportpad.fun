export const MAX_LAUNCH_IMAGE_BYTES = 5_000_000;
export const MAX_LAUNCH_IMAGE_DIMENSION = 4_096;
export const MAX_LAUNCH_IMAGE_PIXELS = 16_777_216;

export const LAUNCH_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type LaunchImageMime = (typeof LAUNCH_IMAGE_MIME_TYPES)[number];

export type LaunchImageInspection = {
  ok: true;
  mime: LaunchImageMime;
  extension: "png" | "jpg" | "webp";
  width: number;
  height: number;
};

export type LaunchImageFailure = {
  ok: false;
  code: "empty" | "too_large" | "unsupported_type" | "invalid_container" | "invalid_dimensions";
  message: string;
};

export type LaunchImageValidation = LaunchImageInspection | LaunchImageFailure;

const MIME_TYPES = new Set<string>(LAUNCH_IMAGE_MIME_TYPES);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function fail(code: LaunchImageFailure["code"], message: string): LaunchImageFailure {
  return { ok: false, code, message };
}

function dimensionsAreSafe(width: number, height: number) {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_LAUNCH_IMAGE_DIMENSION &&
    height <= MAX_LAUNCH_IMAGE_DIMENSION &&
    width * height <= MAX_LAUNCH_IMAGE_PIXELS
  );
}

function readU16Be(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16Le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24Le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32Be(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readU32Le(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  let value = "";
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function crc32(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Uint8Array): LaunchImageValidation {
  if (bytes.length < 45 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return fail("invalid_container", "The PNG image is incomplete or invalid.");
  }

  let cursor = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let sawHeader = false;
  let sawPalette = false;
  let sawImageData = false;

  while (cursor < bytes.length) {
    if (bytes.length - cursor < 12) {
      return fail("invalid_container", "The PNG image is incomplete or invalid.");
    }

    const chunkLength = readU32Be(bytes, cursor);
    const typeOffset = cursor + 4;
    const dataOffset = cursor + 8;
    if (chunkLength > bytes.length - dataOffset - 4) {
      return fail("invalid_container", "The PNG image is incomplete or invalid.");
    }

    const dataEnd = dataOffset + chunkLength;
    const chunkEnd = dataEnd + 4;
    const chunkType = ascii(bytes, typeOffset, 4);
    if (!/^[A-Za-z]{4}$/.test(chunkType)) {
      return fail("invalid_container", "The PNG image contains an invalid chunk.");
    }
    if (readU32Be(bytes, dataEnd) !== crc32(bytes, typeOffset, dataEnd)) {
      return fail("invalid_container", "The PNG image failed its integrity check.");
    }
    if (chunkType[0] === chunkType[0].toUpperCase() && !PNG_CRITICAL_CHUNKS.has(chunkType)) {
      return fail("invalid_container", "The PNG image contains an unsupported critical chunk.");
    }

    if (!sawHeader && chunkType !== "IHDR") {
      return fail("invalid_container", "The PNG image header is missing.");
    }
    if (chunkType === "IHDR") {
      if (sawHeader || chunkLength !== 13) {
        return fail("invalid_container", "The PNG image header is invalid.");
      }
      sawHeader = true;
      width = readU32Be(bytes, dataOffset);
      height = readU32Be(bytes, dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8];
      colorType = bytes[dataOffset + 9];
      const allowedDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !allowedDepths[colorType]?.includes(bitDepth) ||
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0 ||
        ![0, 1].includes(bytes[dataOffset + 12])
      ) {
        return fail("invalid_container", "The PNG image header is invalid.");
      }
    } else if (chunkType === "PLTE" && (chunkLength === 0 || chunkLength % 3 !== 0 || chunkLength > 768)) {
      return fail("invalid_container", "The PNG color palette is invalid.");
    } else if (chunkType === "PLTE") {
      sawPalette = true;
    } else if (chunkType === "IDAT") {
      if (!sawHeader || chunkLength === 0) {
        return fail("invalid_container", "The PNG image data is invalid.");
      }
      sawImageData = true;
    } else if (chunkType === "IEND") {
      if (chunkLength !== 0 || !sawHeader || !sawImageData || chunkEnd !== bytes.length) {
        return fail("invalid_container", "The PNG image ending is invalid.");
      }
      if (colorType === 3 && !sawPalette) {
        return fail("invalid_container", "The PNG image color palette is missing.");
      }
      if (!dimensionsAreSafe(width, height)) {
        return fail(
          "invalid_dimensions",
          `Image dimensions must not exceed ${MAX_LAUNCH_IMAGE_DIMENSION} x ${MAX_LAUNCH_IMAGE_DIMENSION} pixels.`,
        );
      }
      return { ok: true, mime: "image/png", extension: "png", width, height };
    }

    cursor = chunkEnd;
  }

  return fail("invalid_container", "The PNG image is missing its final chunk.");
}

function isJpegStartOfFrame(marker: number) {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

function inspectJpeg(bytes: Uint8Array): LaunchImageValidation {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return fail("invalid_container", "The JPEG image is incomplete or invalid.");
  }

  let cursor = 2;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  let sawScan = false;

  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      return fail("invalid_container", "The JPEG image contains invalid marker data.");
    }
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    if (cursor >= bytes.length) {
      return fail("invalid_container", "The JPEG image is incomplete or invalid.");
    }

    const marker = bytes[cursor];
    cursor += 1;
    if (marker === 0xd9) {
      if (!sawFrame || !sawScan || cursor !== bytes.length) {
        return fail("invalid_container", "The JPEG image ending is invalid.");
      }
      if (!dimensionsAreSafe(width, height)) {
        return fail(
          "invalid_dimensions",
          `Image dimensions must not exceed ${MAX_LAUNCH_IMAGE_DIMENSION} x ${MAX_LAUNCH_IMAGE_DIMENSION} pixels.`,
        );
      }
      return { ok: true, mime: "image/jpeg", extension: "jpg", width, height };
    }
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      return fail("invalid_container", "The JPEG image contains an invalid marker.");
    }
    if (cursor + 2 > bytes.length) {
      return fail("invalid_container", "The JPEG image is incomplete or invalid.");
    }

    const segmentLength = readU16Be(bytes, cursor);
    if (segmentLength < 2 || segmentLength > bytes.length - cursor) {
      return fail("invalid_container", "The JPEG image contains an invalid segment.");
    }
    const segmentEnd = cursor + segmentLength;

    if (isJpegStartOfFrame(marker)) {
      if (sawFrame || segmentLength < 11) {
        return fail("invalid_container", "The JPEG frame header is invalid.");
      }
      const components = bytes[cursor + 7];
      if (components === 0 || segmentLength !== 8 + components * 3) {
        return fail("invalid_container", "The JPEG frame header is invalid.");
      }
      height = readU16Be(bytes, cursor + 3);
      width = readU16Be(bytes, cursor + 5);
      sawFrame = true;
    }

    if (marker !== 0xda) {
      cursor = segmentEnd;
      continue;
    }

    if (!sawFrame || segmentLength < 8) {
      return fail("invalid_container", "The JPEG scan header is invalid.");
    }
    sawScan = true;
    cursor = segmentEnd;

    let foundMarker = false;
    while (cursor < bytes.length) {
      if (bytes[cursor] !== 0xff) {
        cursor += 1;
        continue;
      }
      const markerStart = cursor;
      while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
      if (cursor >= bytes.length) break;
      const scanMarker = bytes[cursor];
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
        cursor += 1;
        continue;
      }
      cursor = markerStart;
      foundMarker = true;
      break;
    }
    if (!foundMarker) {
      return fail("invalid_container", "The JPEG image is missing its final marker.");
    }
  }

  return fail("invalid_container", "The JPEG image is missing its final marker.");
}

function inspectWebp(bytes: Uint8Array): LaunchImageValidation {
  if (
    bytes.length < 26 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    readU32Le(bytes, 4) !== bytes.length - 8
  ) {
    return fail("invalid_container", "The WebP image is incomplete or invalid.");
  }

  let cursor = 12;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let frameWidth = 0;
  let frameHeight = 0;
  let sawExtendedHeader = false;
  let sawImageData = false;

  while (cursor < bytes.length) {
    if (bytes.length - cursor < 8) {
      return fail("invalid_container", "The WebP image contains an incomplete chunk.");
    }
    const chunkType = ascii(bytes, cursor, 4);
    const chunkLength = readU32Le(bytes, cursor + 4);
    const dataOffset = cursor + 8;
    if (chunkLength > bytes.length - dataOffset) {
      return fail("invalid_container", "The WebP image contains an invalid chunk.");
    }
    const dataEnd = dataOffset + chunkLength;
    const paddedEnd = dataEnd + (chunkLength & 1);
    if (paddedEnd > bytes.length) {
      return fail("invalid_container", "The WebP image contains invalid padding.");
    }

    if (chunkType === "VP8X") {
      if (sawExtendedHeader || chunkLength !== 10 || cursor !== 12) {
        return fail("invalid_container", "The WebP extended header is invalid.");
      }
      sawExtendedHeader = true;
      const flags = bytes[dataOffset];
      if ((flags & 0x02) !== 0) {
        return fail("invalid_container", "Animated WebP images are not supported.");
      }
      canvasWidth = readU24Le(bytes, dataOffset + 4) + 1;
      canvasHeight = readU24Le(bytes, dataOffset + 7) + 1;
    } else if (chunkType === "VP8 ") {
      if (
        sawImageData ||
        chunkLength < 11 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        return fail("invalid_container", "The WebP VP8 frame header is invalid.");
      }
      sawImageData = true;
      frameWidth = readU16Le(bytes, dataOffset + 6) & 0x3fff;
      frameHeight = readU16Le(bytes, dataOffset + 8) & 0x3fff;
    } else if (chunkType === "VP8L") {
      if (sawImageData || chunkLength < 6 || bytes[dataOffset] !== 0x2f) {
        return fail("invalid_container", "The WebP lossless frame header is invalid.");
      }
      sawImageData = true;
      const sizeBits = readU32Le(bytes, dataOffset + 1);
      frameWidth = (sizeBits & 0x3fff) + 1;
      frameHeight = ((sizeBits >>> 14) & 0x3fff) + 1;
    }

    cursor = paddedEnd;
  }

  if (cursor !== bytes.length || !sawImageData) {
    return fail("invalid_container", "The WebP image data is missing or invalid.");
  }
  const width = canvasWidth || frameWidth;
  const height = canvasHeight || frameHeight;
  if (sawExtendedHeader && (frameWidth !== canvasWidth || frameHeight !== canvasHeight)) {
    return fail("invalid_container", "The WebP canvas and frame dimensions do not match.");
  }
  if (!dimensionsAreSafe(width, height)) {
    return fail(
      "invalid_dimensions",
      `Image dimensions must not exceed ${MAX_LAUNCH_IMAGE_DIMENSION} x ${MAX_LAUNCH_IMAGE_DIMENSION} pixels.`,
    );
  }
  return { ok: true, mime: "image/webp", extension: "webp", width, height };
}

export function validateLaunchImage(bytes: Uint8Array, mime: string): LaunchImageValidation {
  if (bytes.length === 0) return fail("empty", "Choose a non-empty image.");
  if (bytes.length > MAX_LAUNCH_IMAGE_BYTES) {
    return fail("too_large", "Choose an image that is 5 MB or smaller.");
  }
  if (!MIME_TYPES.has(mime)) {
    return fail("unsupported_type", "Choose a PNG, JPEG, or WebP image.");
  }
  if (mime === "image/png") return inspectPng(bytes);
  if (mime === "image/jpeg") return inspectJpeg(bytes);
  return inspectWebp(bytes);
}
