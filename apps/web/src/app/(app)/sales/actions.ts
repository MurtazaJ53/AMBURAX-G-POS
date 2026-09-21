"use server";

import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { getSaleDetail } from "@/server/sales/saleQueries";

export async function fetchSaleDetailAction(saleId: string) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);

  if (resolved.status === "unauthorized" || resolved.status === "no_store") {
    throw new Error("Unauthorized or no store");
  }

  return getSaleDetail({
    tenantId: resolved.context.tenantId,
    saleId,
  });
}
