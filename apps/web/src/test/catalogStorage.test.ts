import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalFsStorageAdapter, UnverifiedImageError } from "@/server/catalog/catalogStorage";

/**
 * The real local adapter, pointed at a throwaway temp directory (never the repo's public/uploads).
 */

const enc = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...enc("JFIF")]);

let root: string;
let adapter: LocalFsStorageAdapter;
const uploads = () => path.join(root, "public", "uploads");
const filesUnder = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dir, f)).isFile())
    : [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gpos-catalog-storage-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  adapter = new LocalFsStorageAdapter();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("LocalFsStorageAdapter.uploadImage", () => {
  it.each([
    ["png", PNG, ".png"],
    ["jpeg", JPEG, ".jpg"],
  ] as const)("stores verified %s bytes under the tenant folder with a random name and canonical extension", async (format, data, ext) => {
    const url = await adapter.uploadImage("tenant-a", data, format);
    expect(url).toMatch(new RegExp(`^/uploads/tenant-a/[0-9a-f-]{36}\\${ext}$`));
    const written = path.join(uploads(), "tenant-a", path.basename(url));
    expect(fs.readFileSync(written)).toEqual(Buffer.from(data));
  });

  it("refuses bytes that do not match the declared format and writes nothing", async () => {
    await expect(adapter.uploadImage("tenant-a", PNG, "jpeg")).rejects.toBeInstanceOf(UnverifiedImageError);
    await expect(adapter.uploadImage("tenant-a", enc("<svg/>"), "png")).rejects.toBeInstanceOf(UnverifiedImageError);
    expect(filesUnder(uploads())).toEqual([]);
  });
});

describe("LocalFsStorageAdapter.deleteImage containment", () => {
  it("deletes only within the tenant's own folder", async () => {
    const mine = await adapter.uploadImage("tenant-a", PNG, "png");
    const theirs = await adapter.uploadImage("tenant-b", PNG, "png");

    await adapter.deleteImage("tenant-a", theirs); // another tenant's URL: ignored
    await adapter.deleteImage("tenant-a", "https://example.com/x.png"); // external: ignored
    await adapter.deleteImage("tenant-a", "/uploads/tenant-a/../tenant-b/" + path.basename(theirs)); // traversal: basename only
    expect(fs.existsSync(path.join(uploads(), "tenant-b", path.basename(theirs)))).toBe(true);

    await adapter.deleteImage("tenant-a", mine);
    expect(fs.existsSync(path.join(uploads(), "tenant-a", path.basename(mine)))).toBe(false);
  });
});
