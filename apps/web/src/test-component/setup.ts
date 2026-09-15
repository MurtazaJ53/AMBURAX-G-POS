import { afterEach, vi } from "vitest";
import { cleanup } from "./render";

/**
 * The DOM suite's ground rules.
 *
 * No custom matcher library. The assertions in these tests are plain reads of the DOM —
 * `element.textContent`, `input.disabled` — which is a little more verbose and has the
 * compensating property that what is asserted is exactly what a browser exposes, with no
 * matcher semantics in between.
 *
 * `fetch` is left unstubbed here on purpose. Each test installs the exact envelope it needs, so
 * a test that forgets to stub a call fails loudly on a missing stub rather than quietly hitting
 * whatever a shared default happened to return.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
