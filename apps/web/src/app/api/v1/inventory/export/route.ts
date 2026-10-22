import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { unauthorized, forbidden, noStore } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { db } from "@/server/db";
import { csvCell } from "@/server/ops/operations";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const movements = await db.stockMovement.findMany({
      where: {
        tenantId: resolved.context.tenantId,
        storeId: resolved.context.storeId,
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: {
        createdAt: true,
        type: true,
        quantityDelta: true,
        reason: true,
        referenceType: true,
        referenceId: true,
        unitCostMinor: true,
        variant: {
          select: {
            sku: true,
            barcode: true,
            product: { select: { name: true, category: true, brand: true } },
          },
        },
      },
    });

    const header = [
      "Timestamp",
      "SKU",
      "Barcode",
      "Product Name",
      "Category",
      "Brand",
      "Movement Type",
      "Quantity Delta",
      "Unit Cost (Rs)",
      "Reason",
      "Reference Type",
      "Reference ID",
    ];

    const rows = movements.map((m) => [
      m.createdAt.toISOString(),
      m.variant.sku,
      m.variant.barcode ?? "",
      m.variant.product.name,
      m.variant.product.category ?? "",
      m.variant.product.brand ?? "",
      m.type,
      m.quantityDelta,
      m.unitCostMinor != null ? (m.unitCostMinor / 100).toFixed(2) : "",
      m.reason ?? "",
      m.referenceType ?? "",
      m.referenceId ?? "",
    ]);

    const csvContent = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="stock-ledger-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    logError("inventory: export failed", err, { correlationId });
    return NextResponse.json({ error: "Failed to export stock ledger." }, { status: 500 });
  }
}
