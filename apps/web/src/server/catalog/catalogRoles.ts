import { TenantRole } from "@prisma/client";

/**
 * Authorization rule for the catalogue workspace.
 *
 * Currently, only owners can create and edit products and variants.
 * This ensures strict control over the shared catalogue data.
 */
export function canManageCatalog(role: TenantRole): boolean {
  return role === TenantRole.OWNER;
}
