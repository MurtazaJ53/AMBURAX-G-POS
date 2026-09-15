import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "./render";
import userEvent from "@testing-library/user-event";
import { computeAccessibleName } from "dom-accessibility-api";
import { TillWorkspace } from "@/app/(app)/till/_components/TillWorkspace";
import { stubApi, readyTillRoutes, SALE, SHIRT, type ApiStub, type StubRoute } from "./apiStub";

/**
 * The till from the keyboard, and from a screen reader.
 *
 * These are not a compliance afterthought on this surface. A till is operated by someone whose
 * hands are on a scanner and whose eyes are on a customer, so focus order, accessible names and
 * announcements are how the screen works at all — a control a keyboard cannot reach is a
 * control the primary operator cannot use.
 */

function renderTill() {
  return render(
    <TillWorkspace
      currentUserId="user-me"
      cashierName="Asha"
      roleLabel="Cashier"
      storeName="Linking Road"
      storeCode="LR-01"
    />,
  );
}

const scanField = () => screen.getByLabelText(/scan or type a barcode/i) as HTMLInputElement;

function routes(extra: StubRoute[] = []): StubRoute[] {
  return readyTillRoutes([
    { path: "/api/v1/pos/scan", replies: [{ kind: "ok", body: { item: SHIRT } }] },
    ...extra,
  ]);
}

async function readyTill(stub: ApiStub) {
  renderTill();
  await waitFor(() => expect(scanField().disabled).toBe(false));
  return stub;
}

describe("accessible names", () => {
  it("gives every control a name a screen reader can announce", async () => {
    const stub = stubApi(routes());
    const user = userEvent.setup();
    await readyTill(stub);
    await user.type(scanField(), "8901234567890{Enter}");
    await screen.findByLabelText(/^quantity of Cotton Shirt$/i);

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]"),
    );
    expect(controls.length).toBeGreaterThan(5);

    const unnamed = controls.filter((node) => computeAccessibleName(node).trim().length === 0);
    expect(unnamed.map((node) => node.outerHTML.slice(0, 120))).toEqual([]);
  });

  it("does not announce a keyboard hint as part of a control name", async () => {
    const stub = stubApi(routes());
    await readyTill(stub);

    // The shortcut is a visual reminder, not part of what the control is called. A screen
    // reader announcing "Take payment F9" reads the hint as if it were the label.
    const pay = screen.getByRole("button", { name: /take /i });
    expect(computeAccessibleName(pay)).not.toMatch(/F9/);
  });

  it("names the regions a cashier navigates between", async () => {
    const stub = stubApi(routes());
    await readyTill(stub);

    expect(screen.getByRole("region", { name: /till status/i })).toBeTruthy();
    expect(screen.getByRole("region", { name: /keyboard shortcuts/i })).toBeTruthy();
  });

  it("gives the bill a caption and real column headers", async () => {
    const stub = stubApi(routes());
    const user = userEvent.setup();
    await readyTill(stub);
    await user.type(scanField(), "8901234567890{Enter}");
    await screen.findByLabelText(/^quantity of Cotton Shirt$/i);

    const table = screen.getByRole("table");
    expect(table.querySelector("caption")?.textContent).toMatch(/items on the current bill/i);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/item/i), expect.stringMatching(/quantity/i)]),
    );
  });

  it("never overrides the natural tab order", async () => {
    const stub = stubApi(routes());
    await readyTill(stub);

    const positive = Array.from(document.querySelectorAll<HTMLElement>("[tabindex]")).filter(
      (node) => Number(node.getAttribute("tabindex")) > 0,
    );
    expect(positive).toEqual([]);
  });
});

describe("announcements", () => {
  it("interrupts with an alert for something the cashier must act on", async () => {
    const stub = stubApi(
      readyTillRoutes([
        {
          path: "/api/v1/pos/scan",
          replies: [{ kind: "ok", body: { item: { ...SHIRT, isActive: false } } }],
        },
      ]),
    );
    const user = userEvent.setup();
    await readyTill(stub);

    await user.type(scanField(), "8901234567890{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
  });

  it("uses a polite status, not an alert, when nobody knows what happened", async () => {
    const stub = stubApi(
      readyTillRoutes([
        { path: "/api/v1/pos/scan", replies: [{ kind: "ok", body: { item: SHIRT } }] },
        { path: "/api/v1/sales", method: "POST", replies: [{ kind: "offline" }] },
      ]),
    );
    const user = userEvent.setup();
    await readyTill(stub);
    await user.type(scanField(), "8901234567890{Enter}");
    await screen.findByLabelText(/^quantity of Cotton Shirt$/i);

    await user.click(screen.getByRole("button", { name: /take /i }));

    // An unanswered sale is announced as a status. Calling it an alert tells the cashier
    // something failed, which is the one thing nobody yet knows.
    const status = await screen.findByText(/sale not confirmed/i, {}, { timeout: 5000 });
    const region = status.closest("[role]");
    expect(region?.getAttribute("role")).toBe("status");
  });
});

describe("the keyboard path through a sale", () => {
  it("puts focus in the scan field as soon as the till can sell", async () => {
    const stub = stubApi(routes());
    await readyTill(stub);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
  });

  it("returns to the scan field from anywhere with F2", async () => {
    const stub = stubApi(routes());
    const user = userEvent.setup();
    await readyTill(stub);

    const customer = screen.getByLabelText(/search for a customer/i);
    customer.focus();
    expect(document.activeElement).toBe(customer);

    await user.keyboard("{F2}");
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
  });

  it("jumps to the customer field with F4", async () => {
    const stub = stubApi(routes());
    const user = userEvent.setup();
    await readyTill(stub);

    await user.keyboard("{F4}");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/search for a customer/i)),
    );
  });

  it("runs scan, pay and next bill without a mouse", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [{ kind: "ok", status: 201, body: { sale: SALE, duplicate: false } }],
        },
      ]),
    );
    const user = userEvent.setup();
    await readyTill(stub);

    // Scan: a hardware scanner is a keyboard that types fast and presses Enter, so this is
    // the same path the hardware takes.
    await user.keyboard("8901234567890{Enter}");
    await screen.findByLabelText(/^quantity of Cotton Shirt$/i);

    await user.keyboard("{F9}");
    expect(await screen.findByText(/sale complete/i)).toBeTruthy();
    expect(stub.countFor("/api/v1/sales")).toBe(1);

    await user.keyboard("{F9}");
    await waitFor(() => expect(screen.getByText(/nothing on this bill yet/i)).toBeTruthy());
    // And the next bill starts with a fresh idempotency key, so it cannot replay the last one.
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
  });

  it("clears the last scan message with Escape", async () => {
    const stub = stubApi(
      readyTillRoutes([
        {
          path: "/api/v1/pos/scan",
          replies: [
            { kind: "error", status: 404, code: "not_found", message: "No item matches that barcode." },
          ],
        },
      ]),
    );
    const user = userEvent.setup();
    await readyTill(stub);

    await user.keyboard("0000000000000{Enter}");
    await screen.findByRole("alert");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("takes a fresh idempotency key for the bill after a completed sale", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [
            { kind: "ok", status: 201, body: { sale: SALE, duplicate: false } },
            { kind: "ok", status: 201, body: { sale: { ...SALE, id: "sale-2", billNumber: "B-0002" }, duplicate: false } },
          ],
        },
        {
          path: "/api/v1/pos/scan",
          replies: [
            { kind: "ok", body: { item: SHIRT } },
            { kind: "ok", body: { item: SHIRT } },
          ],
        },
      ]),
    );
    const user = userEvent.setup();
    await readyTill(stub);

    await user.keyboard("8901234567890{Enter}");
    await screen.findByLabelText(/^quantity of Cotton Shirt$/i);
    await user.keyboard("{F9}");
    await screen.findByText(/sale complete/i);
    await user.keyboard("{F9}");

    await waitFor(() => expect(screen.getByText(/nothing on this bill yet/i)).toBeTruthy());
    await user.keyboard("8901234567890{Enter}");
    await screen.findByLabelText(/^quantity of Cotton Shirt$/i);
    await user.keyboard("{F9}");
    await screen.findByText(/B-0002/);

    const sales = stub.calls.filter((call) => call.url.includes("/api/v1/sales"));
    const first = sales[0]?.body as { idempotencyKey: string };
    const second = sales[1]?.body as { idempotencyKey: string };
    // A new basket must be a new key, or the server would replay the previous sale and the
    // second customer would never be charged.
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
