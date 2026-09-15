import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * `next/link`, minus the router.
 *
 * The real component reads the App Router context, which only exists inside a running Next
 * tree; rendering a component that links anywhere would otherwise fail on a null context and
 * report it as a fault in the component under test.
 *
 * This is a navigation element, and what these tests assert about navigation is exactly what
 * an anchor exposes — that a link is present, reachable by its accessible name, and points at
 * the right href. Substituting one here does not weaken any of that.
 */
export default function Link({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
