/**
 * Types for `dom-accessibility-api`.
 *
 * The package ships `index.d.ts` but omits it from its `exports` map, so TypeScript resolves
 * the import to `any` and the suite would type-check nothing. Declaring the one function used
 * here restores that, and keeps the workaround in a single file rather than a suppression at
 * every call site.
 */
declare module "dom-accessibility-api" {
  /** The name a screen reader would announce for an element, per the accname specification. */
  export function computeAccessibleName(element: Element): string;
}
