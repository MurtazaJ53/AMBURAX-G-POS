import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockResolvePosContext, mockUpload } = vi.hoisted(() => ({
  mockResolvePosContext: vi.fn(),
  mockUpload: vi.fn(),
}));

vi.mock("@/server/sales/posContext", () => ({ resolvePosContext: mockResolvePosContext }));
vi.mock("@/server/catalog/catalogStorage", () => ({ catalogStorage: { uploadImage: mockUpload } }));

const { POST } = await import("@/app/api/v1/catalog/images/route");

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (number[] | Uint8Array)[]) => new Uint8Array(parts.flatMap((p) => Array.from(p)));
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], enc("JFIF"));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = bytes(enc("RIFF"), [0x24, 0x00, 0x00, 0x00], enc("WEBPVP8 "));
const SVG = enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = enc("<!doctype html><script>alert(1)</script>");

const OWNER = { tenantId: "tenant-a", userId: "u1", tenantRole: "OWNER", storeId: "s1", storeName: "S", storeCode: "S", membershipRole: null, canSell: true };

function upload(data: Uint8Array, type: string, name: string) {
  const form = new FormData();
  // Narrowed for the DOM BlobPart type; these arrays are always backed by a plain ArrayBuffer.
  form.append("file", new File([data as Uint8Array<ArrayBuffer>], name, { type }));
  return new NextRequest("http://localhost/api/v1/catalog/images", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePosContext.mockResolvedValue({ status: "ok", context: OWNER });
  mockUpload.mockResolvedValue("/uploads/tenant-a/x.png");
});

describe("POST /api/v1/catalog/images", () => {
  it.each([
    ["JPEG", JPEG, "image/jpeg", "jpeg"],
    ["PNG", PNG, "image/png", "png"],
    ["WebP", WEBP, "image/webp", "webp"],
  ] as const)("stores a real %s using the verified format", async (_l, data, type, format) => {
    const res = await POST(upload(data, type, "photo.bin"));
    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith("tenant-a", expect.any(Uint8Array), format);
  });

  it("ignores a hostile client filename: a real PNG named evil.html is stored as png", async () => {
    const res = await POST(upload(PNG, "image/png", "evil.html"));
    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith("tenant-a", expect.any(Uint8Array), "png");
  });

  it.each([
    ["SVG claiming image/png", SVG, "image/png", "logo.png"],
    ["HTML claiming image/jpeg", HTML, "image/jpeg", "photo.jpg"],
    ["PNG bytes claiming image/jpeg", PNG, "image/jpeg", "photo.jpg"],
    ["JPEG bytes claiming image/webp", JPEG, "image/webp", "photo.webp"],
    ["empty file claiming image/png", new Uint8Array(), "image/png", "empty.png"],
  ])("rejects %s and stores nothing", async (_l, data, type, name) => {
    const res = await POST(upload(data, type, name));
    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["image/svg+xml", SVG],
    ["image/gif", enc("GIF89a....")],
    ["text/html", HTML],
  ])("rejects declared type %s", async (type, data) => {
    const res = await POST(upload(data, type, "x"));
    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("keeps the 5 MB limit", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    const res = await POST(upload(big, "image/png", "big.png"));
    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("keeps owner-only access", async () => {
    mockResolvePosContext.mockResolvedValue({ status: "ok", context: { ...OWNER, tenantRole: "STAFF" } });
    const res = await POST(upload(PNG, "image/png", "p.png"));
    expect(res.status).toBe(403);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("keeps requiring a session", async () => {
    mockResolvePosContext.mockResolvedValue({ status: "unauthorized" });
    expect((await POST(upload(PNG, "image/png", "p.png"))).status).toBe(401);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
