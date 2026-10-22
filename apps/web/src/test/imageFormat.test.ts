import { describe, expect, it } from "vitest";
import { detectImageFormat, formatForMime, IMAGE_FORMATS } from "@/server/catalog/imageFormat";

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (number[] | Uint8Array)[]) => new Uint8Array(parts.flatMap((p) => Array.from(p)));

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], enc("JFIF"));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = bytes(enc("RIFF"), [0x24, 0x00, 0x00, 0x00], enc("WEBPVP8 "));

describe("detectImageFormat", () => {
  it.each([
    ["JPEG", JPEG, "jpeg"],
    ["PNG", PNG, "png"],
    ["WebP", WEBP, "webp"],
  ] as const)("identifies %s from its signature", (_label, data, format) => {
    expect(detectImageFormat(data)).toBe(format);
  });

  it.each([
    ["SVG markup", enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["SVG with XML prolog", enc('<?xml version="1.0"?><svg/>')],
    ["HTML", enc("<!doctype html><script>alert(1)</script>")],
    ["GIF", enc("GIF89a....")],
    ["a RIFF container that is not WebP (WAV)", bytes(enc("RIFF"), [0, 0, 0, 0], enc("WAVEfmt "))],
    ["a truncated PNG signature", bytes([0x89, 0x50, 0x4e, 0x47])],
    ["a truncated WebP header", enc("RIFF\0\0")],
    ["empty bytes", new Uint8Array()],
    ["plain text", enc("hello")],
  ])("rejects %s", (_label, data) => {
    expect(detectImageFormat(data)).toBeNull();
  });
});

describe("format mapping", () => {
  it("maps each format to one canonical extension and MIME type", () => {
    expect(IMAGE_FORMATS).toEqual({
      jpeg: { mime: "image/jpeg", ext: ".jpg" },
      png: { mime: "image/png", ext: ".png" },
      webp: { mime: "image/webp", ext: ".webp" },
    });
  });

  it.each([
    ["image/jpeg", "jpeg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/svg+xml", null],
    ["image/gif", null],
    ["text/html", null],
    ["", null],
  ])("formatForMime(%j) = %j", (mime, format) => {
    expect(formatForMime(mime)).toBe(format);
  });
});
