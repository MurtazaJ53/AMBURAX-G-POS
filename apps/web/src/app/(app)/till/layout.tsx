import "@/design/tokens.css";

/**
 * The till's surface.
 *
 * Its only job is to bring the platform design tokens into scope. They are declared under
 * `[data-amburax]` rather than `:root`, so importing them here restyles the till and nothing
 * else — the existing workspace screens keep the styling they already have, which is what lets
 * this phase ship without touching them.
 */
export default function TillLayout({ children }: { children: React.ReactNode }) {
  return children;
}
