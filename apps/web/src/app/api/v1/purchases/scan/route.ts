import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { BILL_MAX_BYTES, BILL_TYPES, scanSupplierBill } from "@/server/purchasing/billScan";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Read an uploaded supplier bill into a draft purchase (nothing is saved). Needs the owner's AI key. */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const c = resolved.context;
    if (!canManageInventory(c)) return forbidden(correlationId, "Your role can't record purchases.");
    const form = await req.formData().catch(() => null);
    const file = form?.get("bill");
    if (!(file instanceof File)) return apiError({ code: "validation_error", status: 400, message: "Choose a photo or PDF of the bill.", correlationId });
    if (!(BILL_TYPES as readonly string[]).includes(file.type)) {
      return apiError({ code: "validation_error", status: 400, message: "Upload a JPG, PNG, WebP photo or a PDF.", correlationId });
    }
    if (file.size > BILL_MAX_BYTES) return apiError({ code: "validation_error", status: 400, message: "That file is over 8 MB. Take a smaller photo.", correlationId });
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const res = await scanSupplierBill({
      tenantId: c.tenantId,
      storeId: c.storeId,
      file: { base64, mediaType: file.type as (typeof BILL_TYPES)[number] },
    });
    if (res.status === "no_key") {
      return apiError({ code: "ai_not_set_up", status: 409, message: "Bill reading needs an AI key. The owner can add one in Settings → AI.", correlationId });
    }
    if (res.status === "ai_error") return apiError({ code: "ai_error", status: 502, message: res.message, correlationId });
    return NextResponse.json({ status: "ok", draft: res.draft, correlationId });
  } catch (err) {
    logError("purchases/scan: failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Couldn't read the bill. Try again.", correlationId });
  }
}
