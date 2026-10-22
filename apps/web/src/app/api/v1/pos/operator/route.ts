import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { clearTillOperator, currentTillOperator, listTillStaff, switchTillOperator } from "@/server/pos/tillOperator";

export const runtime = "nodejs";

/** Shared counter: who can sell here (names, PIN set or not) and who is selling now. */
export async function GET(req: NextRequest) {
  const correlationId = randomUUID();
  const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  try {
    const resolved = await resolvePosContext(token);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const c = resolved.context;
    const [staff, current] = await Promise.all([
      listTillStaff({ tenantId: c.tenantId, storeId: c.storeId }),
      currentTillOperator({ sessionToken: token, tenantId: c.tenantId, storeId: c.storeId }),
    ]);
    return NextResponse.json({
      status: "ok",
      staff,
      current,
      signedIn: { id: c.userId },
      correlationId,
    });
  } catch (err) {
    logError("pos/operator: list failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Couldn't load the team.", correlationId });
  }
}

const switchBody = z.object({ userId: z.string().trim().min(1), pin: z.string().trim().min(1).max(12) }).strict();

/** Switch the till to a team member by their own PIN. */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  try {
    const resolved = await resolvePosContext(token);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const parsed = switchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError({ code: "validation_error", status: 400, message: "Choose your name and type your PIN.", correlationId });
    const c = resolved.context;
    const res = await switchTillOperator({
      sessionToken: token,
      tenantId: c.tenantId,
      storeId: c.storeId,
      userId: parsed.data.userId,
      pin: parsed.data.pin,
    });
    switch (res.status) {
      case "ok":
        return NextResponse.json({ status: "ok", operator: res.operator, correlationId });
      case "locked":
        return apiError({ code: "pin_locked", status: 423, message: `Too many wrong tries. Try again after ${res.until.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}.`, correlationId });
      case "wrong_pin":
        return apiError({ code: "wrong_pin", status: 401, message: `Wrong PIN. ${res.attemptsLeft} ${res.attemptsLeft === 1 ? "try" : "tries"} left.`, correlationId });
      default:
        return apiError({ code: "not_allowed", status: 403, message: "That PIN can't be used here. Ask the owner to set your PIN on the Staff page.", correlationId });
    }
  } catch (err) {
    logError("pos/operator: switch failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Couldn't switch. Try again.", correlationId });
  }
}

/** Lock the till: bills go back to the signed-in user until someone types their PIN. */
export async function DELETE(req: NextRequest) {
  const correlationId = randomUUID();
  const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  try {
    const resolved = await resolvePosContext(token);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    await clearTillOperator(token);
    return NextResponse.json({ status: "ok", correlationId });
  } catch (err) {
    logError("pos/operator: lock failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Couldn't lock the till.", correlationId });
  }
}
