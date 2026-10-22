import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { apiError, unauthorized, forbidden } from "@/lib/apiError";
import { db } from "@/server/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return forbidden(correlationId, "No active store.");

    const supplierId = req.nextUrl.searchParams.get("supplierId")?.trim();
    const invoiceNo = req.nextUrl.searchParams.get("invoiceNo")?.trim();
    const dateParam = req.nextUrl.searchParams.get("invoiceDate")?.trim();

    if (!supplierId || !invoiceNo) {
      return NextResponse.json({ status: "clean", message: "Supplier and invoice required to check." });
    }

    const effectiveDate = dateParam && /^\d{4}-\d{2}-\d{2}/.test(dateParam)
      ? new Date(`${dateParam}T00:00:00+05:30`)
      : new Date();

    const matches: Array<{
      id: string;
      supplierInvoiceNo: string;
      supplierInvoiceDate: Date | null;
      createdAt: Date;
      fy: number;
      target_fy: number;
    }> = await db.$queryRaw`
      SELECT 
        "id", 
        "supplierInvoiceNo", 
        "supplierInvoiceDate", 
        "createdAt",
        get_financial_year_ist(COALESCE("supplierInvoiceDate", "createdAt")) AS fy,
        get_financial_year_ist(${effectiveDate}::timestamp) AS target_fy
      FROM "purchase_receipts"
      WHERE "tenantId" = ${resolved.context.tenantId}
        AND "supplierId" = ${supplierId}
        AND normalize_product_key("supplierInvoiceNo") = normalize_product_key(${invoiceNo})
      LIMIT 1;
    `;

    if (matches.length === 0) {
      return NextResponse.json({ status: "clean" });
    }

    const match = matches[0]!;
    const billDate = match.supplierInvoiceDate ?? match.createdAt;

    if (match.fy === match.target_fy) {
      return NextResponse.json({
        status: "duplicate",
        receiptId: match.id,
        invoiceNo: match.supplierInvoiceNo,
        date: billDate,
        message: `A bill with invoice number "${match.supplierInvoiceNo}" was already recorded for this supplier on ${billDate.toLocaleDateString("en-IN")}.`,
      });
    }

    return NextResponse.json({
      status: "similar",
      receiptId: match.id,
      invoiceNo: match.supplierInvoiceNo,
      date: billDate,
      message: `A bill with invoice number "${match.supplierInvoiceNo}" was recorded from this supplier in a previous financial year (on ${billDate.toLocaleDateString("en-IN")}).`,
    });
  } catch (err) {
    return apiError({ code: "internal_error", status: 500, message: "Duplicate pre-check failed.", correlationId });
  }
}
