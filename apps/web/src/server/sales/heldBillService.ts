import { db } from "@/server/db";

export interface CreateHeldBillInput {
  tenantId: string;
  storeId: string;
  heldByUserId: string;
  posSessionId?: string | null;
  idempotencyKey: string;
  items: { variantId: string; quantity: number }[];
}

export async function createHeldBill(input: CreateHeldBillInput) {
  // Use existing idempotency fast path
  const existing = await db.heldBill.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    include: { items: true },
  });

  if (existing) {
    return { status: "ok", heldBill: existing, duplicate: true };
  }

  // Authorize/Check
  if (!input.items.length) {
    throw new Error("Cannot hold an empty bill");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

  try {
    const created = await db.heldBill.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        heldByUserId: input.heldByUserId,
        posSessionId: input.posSessionId,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
        expiresAt,
        items: {
          create: input.items.map((item) => ({
            quantity: item.quantity,
            variant: {
              connect: {
                id_tenantId: {
                  id: item.variantId,
                  tenantId: input.tenantId
                }
              }
            }
          })),
        },
      },
      include: { items: true },
    });

    return { status: "ok", heldBill: created, duplicate: false };
  } catch (err: any) {
    if (
      err.code === "P2002" &&
      Array.isArray(err.meta?.target) &&
      (err.meta!.target as string[]).includes("idempotencyKey")
    ) {
      const winner = await db.heldBill.findUniqueOrThrow({
        where: {
          tenantId_idempotencyKey: {
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: { items: true },
      });
      return { status: "ok", heldBill: winner, duplicate: true };
    }
    throw err;
  }
}

export interface ListHeldBillsInput {
  tenantId: string;
  storeId: string;
  page?: number;
  pageSize?: number;
}

export async function listHeldBills(input: ListHeldBillsInput) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;

  const now = new Date();

  return db.heldBill.findMany({
    where: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      resumedAt: null,
      discardedAt: null,
      expiresAt: { gt: now },
    },
    include: {
      heldByUser: { select: { id: true, name: true } },
      items: {
        include: {
          variant: { select: { id: true, sku: true } }
        }
      },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
}

export async function getHeldBill(tenantId: string, storeId: string, id: string) {
  const bill = await db.heldBill.findFirst({
    where: { tenantId, storeId, id },
    include: {
      items: {
        include: {
          variant: {
            include: { product: true }
          },
        }
      }
    }
  });

  if (!bill) {
    throw new Error("Held bill not found");
  }

  return bill;
}

export interface ResumeHeldBillInput {
  tenantId: string;
  storeId: string;
  id: string;
  resumedByUserId: string;
  expectedVersion: number;
}

export async function resumeHeldBill(input: ResumeHeldBillInput) {
  const now = new Date();

  const result = await db.heldBill.updateMany({
    where: {
      id: input.id,
      tenantId: input.tenantId,
      storeId: input.storeId,
      version: input.expectedVersion,
      resumedAt: null,
      discardedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      resumedAt: now,
      resumedByUserId: input.resumedByUserId,
      version: { increment: 1 },
    },
  });

  if (result.count === 0) {
    throw new Error("Held bill is no longer available, expired, or was already resumed/discarded.");
  }

  // Fetch the successfully resumed bill
  const resumedBill = await getHeldBill(input.tenantId, input.storeId, input.id);
  
  return { status: "ok", heldBill: resumedBill };
}

export interface DiscardHeldBillInput {
  tenantId: string;
  storeId: string;
  id: string;
  discardedByUserId: string;
  expectedVersion: number;
}

export async function discardHeldBill(input: DiscardHeldBillInput) {
  const now = new Date();

  // Can discard expired bills, but not resumed bills
  const result = await db.heldBill.updateMany({
    where: {
      id: input.id,
      tenantId: input.tenantId,
      storeId: input.storeId,
      version: input.expectedVersion,
      resumedAt: null,
      discardedAt: null,
    },
    data: {
      discardedAt: now,
      discardedByUserId: input.discardedByUserId,
      version: { increment: 1 },
    },
  });

  if (result.count === 0) {
    throw new Error("Held bill could not be discarded (conflict or already terminal).");
  }

  return { status: "ok" };
}
