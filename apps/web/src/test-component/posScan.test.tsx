import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "./render";

// Same convention as the other component suites: icons are irrelevant here, and the real
import userEvent from "@testing-library/user-event";
import { PosTerminal } from "@/app/(app)/pos/PosTerminal";
import { stubApi, SHIRT, SALE, type StubRoute } from "./apiStub";

/**
 * Barcode scanning on the POS screen: Enter in the search box asks the exact-barcode endpoint.
 * Mirrors tillScan.test.tsx — each outcome is asserted on the words a cashier reads.
 */

const SCANNED = { ...SHIRT, taxTreatment: "TAXABLE", imageUrl: null };

function posRoutes(scanReplies: StubRoute["replies"], extra: StubRoute[] = []): StubRoute[] {
  return [
    { path: "/api/v1/catalog/search", replies: [{ kind: "ok", body: { results: [] } }] },
    { path: "/api/v1/catalog/facets", replies: [{ kind: "ok", body: { categories: [], brands: [], sizes: [], colours: [] } }] },
    { path: "/api/v1/pos/scan", replies: scanReplies },
    ...extra,
  ];
}

function renderPos() {
  return render(<PosTerminal storeName="Linking Road" storeCode="LR-01" cashierName="Asha" gstRegistered />);
}

const searchBox = () => screen.getByLabelText(/^search products$/i) as HTMLInputElement;
/** One "Remove … from cart" button per cart line. */
const cartLines = () => screen.queryAllByRole("button", { name: /^remove cotton shirt from cart$/i });
/** The quantity shown between the decrease and increase buttons of the shirt's line. */
const shirtQuantity = () =>
  screen.getByRole("button", { name: /^decrease quantity of cotton shirt$/i }).nextElementSibling?.textContent?.trim();

describe("POS barcode scanning", () => {
  it("adds a scanned item through the exact barcode endpoint, clears the box and keeps focus", async () => {
    const user = userEvent.setup();
    const stub = stubApi(posRoutes([{ kind: "ok", body: { item: SCANNED } }]));
    renderPos();

    await user.type(searchBox(), "8901234567890{Enter}");

    await waitFor(() => expect(cartLines()).toHaveLength(1));
    expect(stub.countFor("/api/v1/pos/scan")).toBe(1);
    expect(stub.calls.find((c) => c.url.startsWith("/api/v1/pos/scan"))?.url).toContain("barcode=8901234567890");
    expect(shirtQuantity()).toBe("1");
    expect(searchBox().value).toBe("");
    expect(document.activeElement).toBe(searchBox());
  });

  it("a repeated scan increments the existing line instead of adding a second one", async () => {
    const user = userEvent.setup();
    const stub = stubApi(posRoutes([{ kind: "ok", body: { item: SCANNED } }, { kind: "ok", body: { item: SCANNED } }]));
    renderPos();

    await user.type(searchBox(), "8901234567890{Enter}");
    await waitFor(() => expect(cartLines()).toHaveLength(1));
    await user.type(searchBox(), "8901234567890{Enter}");
    await waitFor(() => expect(stub.countFor("/api/v1/pos/scan")).toBe(2));

    await waitFor(() => expect(shirtQuantity()).toBe("2"));
    expect(cartLines()).toHaveLength(1);
  });

  it("names a withdrawn item and leaves the cart empty", async () => {
    const user = userEvent.setup();
    stubApi(posRoutes([{ kind: "ok", body: { item: { ...SCANNED, isActive: false } } }]));
    renderPos();

    await user.type(searchBox(), "8901234567890{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/withdrawn from sale/i);
    expect(alert.textContent).toMatch(/Cotton Shirt/);
    expect(alert.textContent).not.toMatch(/not found/i);
    expect(cartLines()).toHaveLength(0);
  });

  it("reports an unknown barcode, keeps the typed text for name search, and leaves the cart empty", async () => {
    const user = userEvent.setup();
    stubApi(posRoutes([{ kind: "error", status: 404, code: "not_found", message: "No item matches that barcode." }]));
    renderPos();

    await user.type(searchBox(), "0000000000000{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/barcode not found/i);
    expect(alert.textContent).toContain("0000000000000");
    expect(searchBox().value).toBe("0000000000000");
    expect(cartLines()).toHaveLength(0);
  });

  it("an ordinary name search still uses catalogue search; Enter on it adds nothing", async () => {
    const user = userEvent.setup();
    const stub = stubApi(posRoutes([{ kind: "error", status: 404, code: "not_found", message: "No item matches that barcode." }]));
    renderPos();

    await user.type(searchBox(), "cotton");
    await waitFor(() => expect(stub.calls.some((c) => c.url.startsWith("/api/v1/catalog/search?q=cotton"))).toBe(true));
    expect(stub.countFor("/api/v1/pos/scan")).toBe(0);

    await user.type(searchBox(), "{Enter}");
    await waitFor(() => expect(stub.countFor("/api/v1/pos/scan")).toBe(1));
    expect(searchBox().value).toBe("cotton");
    expect(cartLines()).toHaveLength(0);
  });

  it("does nothing on an empty Enter", async () => {
    const user = userEvent.setup();
    const stub = stubApi(posRoutes([{ kind: "ok", body: { item: SCANNED } }]));
    renderPos();

    await user.type(searchBox(), "   {Enter}");
    await user.clear(searchBox());
    await user.type(searchBox(), "{Enter}");

    expect(stub.countFor("/api/v1/pos/scan")).toBe(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cartLines()).toHaveLength(0);
  });

  it("shows an error on a network failure, leaves the cart empty and keeps focus", async () => {
    const user = userEvent.setup();
    stubApi(posRoutes([{ kind: "offline" }]));
    renderPos();

    await user.type(searchBox(), "8901234567890{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/barcode not found/i);
    expect(alert.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(cartLines()).toHaveLength(0);
    expect(document.activeElement).toBe(searchBox());
  });

  it("shows a server failure as an error, not as an unknown barcode", async () => {
    const user = userEvent.setup();
    stubApi(posRoutes([{ kind: "error", status: 503, code: "service_unavailable", message: "Try again." }]));
    renderPos();

    await user.type(searchBox(), "8901234567890{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/barcode not found/i);
    expect(cartLines()).toHaveLength(0);
  });

  it("checkout sends variant, quantity and only a batch-price hint; the server prices the line", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      posRoutes([{ kind: "ok", body: { item: { ...SCANNED, priceMinor: 1 } } }], [
        { path: "/api/v1/sales", method: "POST", replies: [{ kind: "ok", body: { sale: SALE, duplicate: false } }] },
      ]),
    );
    renderPos();

    await user.type(searchBox(), "8901234567890{Enter}");
    await waitFor(() => expect(cartLines()).toHaveLength(1));

    const complete = screen.getByRole("button", { name: /complete sale/i }) as HTMLButtonElement;
    await waitFor(() => expect(complete.disabled).toBe(false));
    await user.click(complete);

    await waitFor(() => expect(stub.calls.some((c) => c.url === "/api/v1/sales" && c.method === "POST")).toBe(true));
    const body = stub.calls.find((c) => c.url === "/api/v1/sales" && c.method === "POST")!.body as {
      lines: Record<string, unknown>[];
    };
    // `unitPriceMinor` is the restock batch selector (old vs new price). createSale only matches
    // it against the variant's own price and its pending price changes and always charges a
    // server-held price (saleService.ts), so it is a hint, never the amount.
    expect(body.lines).toEqual([{ variantId: SHIRT.variantId, quantity: 1, unitPriceMinor: 1 }]);
    expect(JSON.stringify(body)).not.toMatch(/"priceMinor"|mrpMinor|taxRateBp|taxRateMode|totalMinor/);
  });
  it("a price changed while the bill was open: offers a one-tap update, then checks out at the new price", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      posRoutes([{ kind: "ok", body: { item: { ...SCANNED, priceMinor: 99_900 } } }], [
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [
            {
              kind: "ok",
              status: 409,
              body: {
                error: {
                  code: "price_mismatch",
                  message: "An item's price changed while the bill was open.",
                  variantId: SHIRT.variantId,
                  sentPriceMinor: 99_900,
                  currentPriceMinor: 119_900,
                },
              },
            },
            { kind: "ok", body: { sale: SALE, duplicate: false } },
          ],
        },
      ]),
    );
    renderPos();

    await user.type(searchBox(), "8901234567890{Enter}");
    await waitFor(() => expect(cartLines()).toHaveLength(1));
    const complete = () => screen.getByRole("button", { name: /complete sale/i }) as HTMLButtonElement;
    await waitFor(() => expect(complete().disabled).toBe(false));
    await user.click(complete());

    const prompt = await screen.findByText(/Price of Cotton Shirt changed to .*1,199.*Update the bill\?/);
    expect(prompt).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    expect(screen.queryByText(/Update the bill\?/)).toBeNull();

    await waitFor(() => expect(complete().disabled).toBe(false));
    await user.click(complete());
    await waitFor(() =>
      expect(stub.calls.filter((c) => c.url === "/api/v1/sales" && c.method === "POST")).toHaveLength(2),
    );
    const posts = stub.calls.filter((c) => c.url === "/api/v1/sales" && c.method === "POST");
    const first = posts[0]!.body as { idempotencyKey: string; lines: Record<string, unknown>[] };
    const second = posts[1]!.body as { idempotencyKey: string; lines: Record<string, unknown>[] };
    expect(first.lines[0]).toMatchObject({ unitPriceMinor: 99_900 });
    expect(second.lines[0]).toMatchObject({ variantId: SHIRT.variantId, quantity: 1, unitPriceMinor: 119_900 });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});
