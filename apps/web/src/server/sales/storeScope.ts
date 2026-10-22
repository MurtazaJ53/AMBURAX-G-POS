/**
 * The legal Company and currency a Store trades under, read only from the persisted Store.
 *
 * A Store counts as scoped only when it names a Company and its currency matches that
 * Company's currency. Anything else returns null: callers persist no scope rather than
 * inventing one, and the khata book (which requires scope) will not show those records.
 */
export interface StoreScope {
  companyId: string;
  currency: string;
}

export function storeScopeOf(store: {
  companyId: string | null;
  currency: string | null;
  company: { currency: string } | null;
}): StoreScope | null {
  if (!store.companyId || !store.company || !store.currency) return null;
  if (store.currency !== store.company.currency) return null;
  return { companyId: store.companyId, currency: store.currency };
}

/** The select shape `storeScopeOf` needs. */
export const STORE_SCOPE_SELECT = {
  companyId: true,
  currency: true,
  company: { select: { currency: true } },
} as const;
