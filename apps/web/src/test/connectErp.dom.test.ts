// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("lucide-react", () => ({ PlugZap: () => null }));
vi.mock("@/app/(app)/_components/ui", async () => {
  const { createElement: h } = await import("react");
  return {
    buttonClass: () => "",
    StatusBadge: ({ children }: { children: unknown }) => h("span", { "data-badge": "" }, children as never),
  };
});
const connectErpAction = vi.fn();
vi.mock("@/app/(app)/settings/company/actions", () => ({ connectErpAction }));

const { ConnectErp } = await import("@/app/(app)/settings/company/ConnectErp");

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

const badge = () => container.querySelector("[data-badge]")?.textContent;

describe("Connect to Backend (bug 17)", () => {
  it("says Connecting… once the request is queued, though the tenant is still NOT_PROVISIONED", async () => {
    connectErpAction.mockResolvedValue({ status: "success", message: "Connecting. This page updates when it's done." });
    await act(async () => {
      root.render(createElement(ConnectErp, { status: "NOT_PROVISIONED", error: null }));
    });
    expect(badge()).toBe("Not connected");
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    expect(connectErpAction).toHaveBeenCalled();
    expect(badge()).toBe("Connecting…");
    expect(container.querySelector("button[type=submit]")).toBeNull();
  });

  it("keeps Not connected when the request was refused", async () => {
    connectErpAction.mockResolvedValue({ status: "error", message: "Only the owner can connect the business." });
    await act(async () => {
      root.render(createElement(ConnectErp, { status: "NOT_PROVISIONED", error: null }));
    });
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });
    expect(badge()).toBe("Not connected");
  });
});
