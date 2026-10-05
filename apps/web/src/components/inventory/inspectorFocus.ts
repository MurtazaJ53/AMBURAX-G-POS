/**
 * Focus restoration for the inventory product inspector.
 *
 * The inspector is opened by a link — a table row's product link or a grid card — whose
 * `selected` query parameter names the SKU. Closing it (Close, Escape, the backdrop) is a
 * navigation: the server re-renders the page without the panel, and the focused Close link is
 * removed with it, which used to drop focus onto <body>.
 *
 * The invoker is found again by SKU after that re-render rather than held as an element
 * reference, because the element captured at open time is not guaranteed to be the one on
 * screen after the URL changes. Looking it up in the live DOM means a detached node can never
 * be focused.
 */

/** The live link that opens the inspector for `sku`, outside any dialog, or null. */
export function findInspectorInvoker(root: ParentNode, sku: string): HTMLAnchorElement | null {
  for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href*='selected=']")) {
    if (!a.isConnected || a.closest('[role="dialog"]')) continue;
    const href = a.getAttribute("href") ?? "";
    const query = href.indexOf("?");
    if (query < 0) continue;
    if (new URLSearchParams(href.slice(query + 1)).get("selected") === sku) return a;
  }
  return null;
}

/**
 * Called after the inspector has closed. Does nothing when focus is still somewhere real — a
 * filter, a pagination link, the row itself — because the user put it there. Only when focus
 * has fallen to <body> (or onto a removed node) is it moved: to the SKU's own row or card when
 * that is on screen, otherwise to the page heading, made programmatically focusable for this.
 *
 * Returns the element that received focus, or null when focus was left alone.
 */
export function restoreInspectorFocus(sku: string, doc: Document = document): HTMLElement | null {
  const active = doc.activeElement;
  if (active && active !== doc.body && active.isConnected) return null;

  const invoker = findInspectorInvoker(doc, sku);
  if (invoker) {
    invoker.focus();
    return invoker;
  }

  const heading = doc.querySelector<HTMLElement>("main h1");
  if (!heading) return null;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  heading.focus();
  return heading;
}
