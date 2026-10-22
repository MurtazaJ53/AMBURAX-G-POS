"use client";

export function MovementActions({
  movementId,
  referenceType,
  referenceId,
  canManage,
}: {
  movementId: string;
  referenceType?: string | null;
  referenceId?: string | null;
  canManage: boolean;
}) {
  // Stock movements are append-only; hard-deletion of ledger entries is strictly prohibited.
  return null;
}

