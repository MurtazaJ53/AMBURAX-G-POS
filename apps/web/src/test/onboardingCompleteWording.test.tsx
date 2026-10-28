import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { OnboardingReadiness } from "@/server/onboarding/readiness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children: unknown }) => h("a", { href, ...rest }, children as never) };
});

const { OnboardingCompleteView } = await import("@/app/onboarding/complete/OnboardingCompleteView");

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

describe("onboarding completion: Still to do (bug 18)", () => {
  // Lowercasing every label turned "POS terminal" into "pos terminal". Labels are already
  // written the way they should read, so the list shows them as they are.
  it("keeps each label's own capitals", async () => {
    const readiness: OnboardingReadiness = {
      onboardingStep: "TEAM",
      onboardingComplete: false,
      operationalReady: false,
      canComplete: true,
      items: [
        { key: "pos", label: "POS terminal", level: "NOT_CONFIGURED", detail: "No terminal yet.", blocksSale: true, action: { label: "Set up a terminal", href: "/settings/terminals" } },
      ],
    } as OnboardingReadiness;
    await act(async () => {
      root.render(createElement(OnboardingCompleteView, { readiness }));
    });
    const stillToDo = Array.from(container.querySelectorAll("p")).find((p) => p.textContent?.startsWith("Still to do"));
    expect(stillToDo?.textContent).toBe("Still to do: POS terminal");
  });
});
