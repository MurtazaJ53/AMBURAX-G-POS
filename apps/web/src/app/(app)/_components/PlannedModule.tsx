import { notFound } from "next/navigation";
import { NAV_BY_HREF } from "./navigation";
import { ComingLaterState, PageHeader } from "./ui";

/**
 * The screen behind a navigation entry for a module that is not built.
 *
 * One component serves all of them, driven by `navigation.ts`, so a planned module cannot
 * accidentally acquire a hand-written screen that looks more finished than it is. It states
 * what the module will do and which phase it belongs to, and nothing on it is interactive.
 *
 * This is the deliberate middle path between hiding the roadmap — which misrepresents the
 * product — and shipping a mock screen, which misrepresents the build.
 */
export function PlannedModule({ href }: { href: string }) {
  const item = NAV_BY_HREF.get(href);

  // A planned screen that is not in the navigation model is a routing mistake, not a
  // screen to improvise.
  if (!item || item.status !== "planned") notFound();

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title={item.label}
        subtitle={item.phase ? `Planned for ${item.phase}` : undefined}
      />
      <ComingLaterState
        module={item.label}
        phase={item.phase}
        description={item.description ?? "This module is part of the AMBURAX roadmap."}
      />
    </div>
  );
}
