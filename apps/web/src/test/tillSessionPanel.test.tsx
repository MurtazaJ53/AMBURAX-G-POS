import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children: unknown }) => h("a", { href, ...rest }, children as never) };
});

const { SessionPanel } = await import("@/app/(app)/till/_components/SessionPanel");
type Props = Parameters<typeof SessionPanel>[0];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(devices: Props["devices"]) {
  const props = {
    devices,
    selectedDevice: null,
    onSelectDevice: vi.fn(),
    session: { phase: "no_session" },
    opening: { phase: "idle", lastClosedMinor: null, fromClosedAt: null, recordedMinor: null, saving: false, error: null },
    onOpen: vi.fn(),
    onRecordOpening: vi.fn(),
    onClose: vi.fn(),
    onDismiss: vi.fn(),
  } as unknown as Props;
  await act(async () => {
    root.render(createElement(SessionPanel, props));
  });
}

function setupLink() {
  return Array.from(container.querySelectorAll("a")).find((a) => /set up a terminal/i.test(a.textContent ?? ""));
}

describe("till with no terminal (bug 15)", () => {
  it("offers a way forward while terminals are still loading", async () => {
    await render({ phase: "loading", devices: [], error: null });
    expect(setupLink()?.getAttribute("href")).toBe("/settings/terminals");
  });

  it("offers a 'Set up a terminal' button when the store has none", async () => {
    await render({ phase: "ready", devices: [], error: null });
    expect(setupLink()?.getAttribute("href")).toBe("/settings/terminals");
  });

  it("offers it when the terminal list could not be loaded", async () => {
    await render({
      phase: "error",
      devices: [],
      error: { title: "Couldn't load terminals", detail: "", recovery: "", severity: "recoverable", correlationId: null },
    } as Props["devices"]);
    expect(setupLink()?.getAttribute("href")).toBe("/settings/terminals");
  });
});
