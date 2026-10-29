import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockResolvePosContext, mockUpdateProduct, mockCreateVariant, mockUploadImage } = vi.hoisted(() => ({
  mockResolvePosContext: vi.fn(),
  mockUpdateProduct: vi.fn(),
  mockCreateVariant: vi.fn(),
  mockUploadImage: vi.fn(),
}));

vi.mock("@/server/sales/posContext", () => ({ resolvePosContext: mockResolvePosContext }));
vi.mock("@/server/catalog/catalogService", () => ({
  updateProduct: mockUpdateProduct,
  createVariant: mockCreateVariant,
}));
vi.mock("@/server/catalog/catalogStorage", () => ({
  catalogStorage: { uploadImage: mockUploadImage },
}));

const { PUT: updateProductRoute } = await import("@/app/api/v1/catalog/products/[id]/route");
const { POST: createVariantRoute } = await import("@/app/api/v1/catalog/products/[id]/variants/route");
const { POST: uploadImageRoute } = await import("@/app/api/v1/catalog/images/route");
const { env } = await import("@/lib/env");

const READ_ONLY_STAFF = {
  tenantId: "tenant-read-only",
  userId: "staff-user-1",
  tenantRole: "STAFF" as const,
  storeId: "store-1",
  storeName: "Main Store",
  storeCode: "MAIN",
  membershipRole: "CASHIER",
  canSell: true,
};

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (number[] | Uint8Array)[]) => new Uint8Array(parts.flatMap((p) => Array.from(p)));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function jsonRequest(url: string, method: "PUT" | "POST", body: unknown) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: `${env.SESSION_COOKIE_NAME}=test-session-token`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function imageUploadRequest(data: Uint8Array, type: string, name: string) {
  const form = new FormData();
  form.append("file", new File([data as Uint8Array<ArrayBuffer>], name, { type }));
  return new NextRequest("http://localhost/api/v1/catalog/images", {
    method: "POST",
    headers: {
      cookie: `${env.SESSION_COOKIE_NAME}=test-session-token`,
    },
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePosContext.mockResolvedValue({ status: "ok", context: READ_ONLY_STAFF });
  mockUpdateProduct.mockResolvedValue({ status: "forbidden" });
  mockCreateVariant.mockResolvedValue({ status: "forbidden" });
});

describe("Server-side catalogue permissions for read-only staff (no catalogue edit rights)", () => {
  it("product edit returns 403 Forbidden", async () => {
    const req = jsonRequest("http://localhost/api/v1/catalog/products/prod-1", "PUT", {
      name: "Updated Product Name",
    });
    const res = await updateProductRoute(req, { params: Promise.resolve({ id: "prod-1" }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe("forbidden");
    expect(mockUpdateProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          tenantId: READ_ONLY_STAFF.tenantId,
          userId: READ_ONLY_STAFF.userId,
          tenantRole: "STAFF",
        },
        productId: "prod-1",
      }),
    );
  });

  it("variant create returns 403 Forbidden", async () => {
    const req = jsonRequest("http://localhost/api/v1/catalog/products/prod-1/variants", "POST", {
      priceMinor: 50_000,
      taxTreatment: "NON_GST",
    });
    const res = await createVariantRoute(req, { params: Promise.resolve({ id: "prod-1" }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe("forbidden");
    expect(mockCreateVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          tenantId: READ_ONLY_STAFF.tenantId,
          userId: READ_ONLY_STAFF.userId,
          tenantRole: "STAFF",
        },
        productId: "prod-1",
      }),
    );
  });

  it("product photo upload returns 403 Forbidden", async () => {
    const req = imageUploadRequest(PNG, "image/png", "sample.png");
    const res = await uploadImageRoute(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBe("Forbidden");
    expect(mockUploadImage).not.toHaveBeenCalled();
  });
});
