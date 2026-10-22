/**
 * Catalog image formats, identified from the file's own bytes.
 *
 * The browser's `file.type` and the uploaded filename are both client-supplied, so neither decides
 * what is stored. Only these three raster formats are accepted (the upload route's existing
 * allow-list); anything else — SVG, HTML, GIF, or bytes that match no signature — is rejected.
 */

export type ImageFormat = "jpeg" | "png" | "webp";

export const IMAGE_FORMATS: Record<ImageFormat, { mime: string; ext: string }> = {
  jpeg: { mime: "image/jpeg", ext: ".jpg" },
  png: { mime: "image/png", ext: ".png" },
  webp: { mime: "image/webp", ext: ".webp" },
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** The format the bytes actually are, or null when they match no accepted signature. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  // JPEG: SOI marker followed by the start of another marker.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  // WebP: a RIFF container whose form type is "WEBP".
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  return null;
}

/** The format for an allowed MIME type, or null for anything else (including image/svg+xml). */
export function formatForMime(mime: string): ImageFormat | null {
  const entry = (Object.entries(IMAGE_FORMATS) as [ImageFormat, { mime: string }][]).find(([, f]) => f.mime === mime);
  return entry ? entry[0] : null;
}
