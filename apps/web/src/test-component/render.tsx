import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  configure,
  getQueriesForElement,
  waitFor,
  within,
  type BoundFunctions,
  type queries,
} from "@testing-library/dom";

/**
 * A minimal React renderer for the DOM suite.
 *
 * ## Why not @testing-library/react
 *
 * Because it cannot be installed here without changing what the app runs on. This repository
 * is an npm workspace; Testing Library declares React as a peer, npm auto-installs the lowest
 * satisfying version (18) into the hoisted `node_modules`, and Testing Library then resolves
 * that copy — rendering this app's React 19 element tree through React DOM 18, which fails in
 * a way that reads as a component bug. Every fix amounts to pinning React for the whole
 * workspace to satisfy a test library, which is the tail wagging the dog.
 *
 * What that library provides over its DOM package is small and reproduced here: a mounted
 * container, `act` wrappers so React's work is flushed before an assertion runs, and cleanup
 * between tests. The queries — `getByRole`, `findByText`, `waitFor` — come from
 * `@testing-library/dom`, which has no React peer and is therefore not part of the conflict.
 * The suite ends up testing the React the application actually ships, which is the property
 * that matters.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The two wrappers, and the direction of each matters.
 *
 * A dispatched event runs *inside* `act`, so React finishes the render it triggers before the
 * next line asserts. An asynchronous wait runs *outside* it: `waitFor` polls the DOM, and
 * holding an `act` scope open across that poll keeps React's work batched, so the DOM the test
 * is waiting on never changes and every `findBy` times out. Getting these two the same way
 * round is the classic way to make a React DOM suite hang.
 */
configure({
  asyncWrapper: async (callback) => {
    const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      return await callback();
    } finally {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  },
  eventWrapper: (callback) => {
    let result: unknown;
    act(() => {
      result = callback();
    });
    return result;
  },
});

const mounted: { root: Root; container: HTMLElement }[] = [];

export function render(ui: ReactElement): { container: HTMLElement } & BoundFunctions<typeof queries> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return { container, ...getQueriesForElement(container) };
}

export function cleanup(): void {
  for (const entry of mounted.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
}

/** Queries bound to the whole document, for anything rendered outside a test's own container. */
export const screen = getQueriesForElement(document.body);

/** Re-exported so a test imports its whole toolkit from one place. */
export { waitFor, within };
