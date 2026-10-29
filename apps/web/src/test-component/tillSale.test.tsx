import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "./render";
import userEvent from "@testing-library/user-event";
import { TillWorkspace } from "@/app/(app)/till/_components/TillWorkspace";
import { stubApi, readyTillRoutes, SALE, SESSION, SHIRT, type ApiStub, type StubRoute } from "./apiStub";
import { refreshCalls, resetRefreshCalls } from "./nextNavigationStub";

/**
 * Customer, payment, and the command that moves money.
 *
 * The completion cases are the reason this suite exists. Its reducer is already covered in
 * isolation; what is checked here is that the surface built on it never tells a cashier a sale
 * failed when the server may have completed it, and never sends a second sale to find out.
 */

function renderTill() {
  return render(
    <TillWorkspace
      currentUserId="user-me"
      cashierName="Asha"
      roleLabel="Cashier"
      storeName="Linking Road"
      storeCode="LR-01"
      gstRegistered
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

/** Open till, one item on the bill, ready to take payment. */
async function billWithOneItem(stub: ApiStub) {
  renderTill();
  await waitFor(() => expect(scanField().disabled).toBe(false));
  const user = userEvent.setup();
  await user.type(scanField(), "8901234567890{Enter}");
  await waitFor(() => expect(stub.countFor("/api/v1/pos/scan")).toBe(1));
  await screen.findByLabelText(/^quantity of Cotton Shirt$/i);
  return user;
}

const payButton = () => screen.getByRole("button", { name: /take /i }) as HTMLButtonElement;

describe("the customer", () => {
  it("is optional, and a walk-in needs no action", async () => {
    const stub = stubApi(routes());
    await billWithOneItem(stub);

    const field = screen.getByLabelText(/search for a customer/i) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.placeholder).toMatch(/walk-in/i);
    expect(payButton().disabled).toBe(false);
  });

  it("attaches a searched customer and can be removed again", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/customers",
          replies: [
            { kind: "ok", body: { results: [{ id: "cust-1", name: "Asha Rao", phone: "+91 90000 00000" }] } },
          ],
        },
      ]),
    );
    const user = await billWithOneItem(stub);

    await user.type(screen.getByLabelText(/search for a customer/i), "Asha");
    await user.click(await screen.findByRole("button", { name: /Asha Rao/i }));

    expect(await screen.findByText(/\+91 90000 00000/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() =>
      expect((screen.getByLabelText(/search for a customer/i) as HTMLInputElement).value).toBe(""),
    );
  });
});

describe("taking payment", () => {
  it("sends what and how many, the shift, and no money", async () => {
    const stub = stubApi(
      routes([
        { path: "/api/v1/sales", method: "POST", replies: [{ kind: "ok", status: 201, body: { sale: SALE, duplicate: false } }] },
      ]),
    );
    const user = await billWithOneItem(stub);

    await user.click(payButton());
    await waitFor(() => expect(stub.countFor("/api/v1/sales")).toBe(1));

    const body = stub.calls.at(-1)?.body as Record<string, unknown>;
    expect(body.lines).toEqual([{ variantId: "var-1", quantity: 1, unitPriceMinor: 10000 }]);
    expect(body.posSessionId).toBe(SESSION.id);
    expect(body.payment).toEqual({ method: "CASH" });
    // The client names what is being sold and how it is paid for. Every figure that decides
    // what the customer is charged is read from the database inside the sale transaction.
    expect(body).not.toHaveProperty("totalMinor");
    expect(body).not.toHaveProperty("priceMinor");
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("storeId");
    expect(body).not.toHaveProperty("cashierUserId");
  });

  it("invalidates the server-rendered screens a sale makes stale", async () => {
    resetRefreshCalls();
    const stub = stubApi(
      routes([
        { path: "/api/v1/sales", method: "POST", replies: [{ kind: "ok", status: 201, body: { sale: SALE, duplicate: false } }] },
      ]),
    );
    const user = await billWithOneItem(stub);

    expect(refreshCalls()).toBe(0);
    await user.click(payButton());
    await screen.findByText(/sale complete/i);

    // Sales history, the dashboard and stock counts are server-rendered and now out of date.
    await waitFor(() => expect(refreshCalls()).toBeGreaterThan(0));
  });

  it("shows the completed sale", async () => {
    const stub = stubApi(
      routes([
        { path: "/api/v1/sales", method: "POST", replies: [{ kind: "ok", status: 201, body: { sale: SALE, duplicate: false } }] },
      ]),
    );
    const user = await billWithOneItem(stub);

    await user.click(payButton());

    expect(await screen.findByText(/sale complete/i)).toBeTruthy();
    expect(screen.getByText(/B-0001/)).toBeTruthy();
  });
});

describe("duplicate submission", () => {
  it("sends one sale however many times the button is pressed", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [{ kind: "ok", status: 201, body: { sale: SALE, duplicate: false } }],
        },
      ]),
    );
    const user = await billWithOneItem(stub);

    const button = payButton();
    await user.click(button);
    await user.click(button);
    await user.click(button);

    await screen.findByText(/sale complete/i);
    // The state machine drops a second submission while one is in flight, which is what also
    // covers the Enter key and a scanner's trailing newline — things no button state catches.
    expect(stub.countFor("/api/v1/sales")).toBe(1);
  });

  it("presents a replayed sale as a success that happened once", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [{ kind: "ok", status: 200, body: { sale: SALE, duplicate: true } }],
        },
      ]),
    );
    const user = await billWithOneItem(stub);

    await user.click(payButton());

    expect(await screen.findByText(/sale complete/i)).toBeTruthy();
    expect(screen.getByText(/already recorded/i)).toBeTruthy();
    expect(screen.getByText(/charged once/i)).toBeTruthy();
  });
});

describe("an unanswered sale", () => {
  it("never reports a failure, and repeats the identical request under the same key", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [
            { kind: "offline" },
            { kind: "ok", status: 200, body: { sale: SALE, duplicate: true } },
          ],
        },
      ]),
    );
    const user = await billWithOneItem(stub);

    await user.click(payButton());

    // What the cashier reads while the till finds out. Never the word failed.
    const status = await screen.findByText(/checking with the server/i);
    expect(status.textContent).toBeTruthy();
    expect(screen.queryByText(/sale failed/i)).toBeNull();

    expect(await screen.findByText(/sale complete/i)).toBeTruthy();

    const attempts = stub.calls.filter((call) => call.url.includes("/api/v1/sales"));
    expect(attempts).toHaveLength(2);
    const first = attempts[0]?.body as { idempotencyKey: string };
    const second = attempts[1]?.body as { idempotencyKey: string };
    // The retry is safe only because the key is identical: the same key returns the sale that
    // already happened rather than creating a second one.
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(attempts[0]?.body).toEqual(attempts[1]?.body);
  });

  it("ends undetermined, sending the cashier to look rather than to ring it up again", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [{ kind: "offline" }],
        },
      ]),
    );
    const user = await billWithOneItem(stub);

    await user.click(payButton());

    const notice = await screen.findByText(/sale not confirmed/i, {}, { timeout: 5000 });
    expect(notice).toBeTruthy();
    expect(screen.getByRole("link", { name: /check today/i })).toBeTruthy();
    // Bounded: the till stops repeating rather than hammering the counter.
    expect(stub.countFor("/api/v1/sales")).toBeLessThanOrEqual(3);
  });
});

describe("a refusal the server actually made", () => {
  it("explains a withdrawn line in counter language and keeps the bill", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [
            {
              kind: "error",
              status: 409,
              code: "inactive_variant",
              message: "One of the items is no longer for sale. Remove it and try again.",
            },
          ],
        },
      ]),
    );
    const user = await billWithOneItem(stub);

    await user.click(payButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/item not for sale/i);
    expect(alert.textContent).toMatch(/remove that line/i);
  });

  it("never volunteers which business module is switched off", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [{ kind: "error", status: 404, code: "not_found", message: "Not found." }],
        },
      ]),
    );
    const user = await billWithOneItem(stub);

    await user.click(payButton());

    const alert = await screen.findByRole("alert");
    // The API answers a disabled capability with a plain not-found so its surface is not an
    // oracle for which modules a tenant has. The UI must not undo that.
    expect(alert.textContent).not.toMatch(/retail/i);
    expect(alert.textContent).not.toMatch(/capability/i);
    expect(alert.textContent).toMatch(/not available/i);
  });

  it("shows no raw server or database text", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [
            {
              kind: "error",
              status: 500,
              code: "prisma_error",
              message: "PrismaClientKnownRequestError: relation sales does not exist",
            },
          ],
        },
      ]),
    );
    const user = await billWithOneItem(stub);

    await user.click(payButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/prisma/i);
    expect(alert.textContent).not.toMatch(/relation/i);
    expect(alert.textContent).toMatch(/something went wrong/i);
    // The correlation id is the one internal detail worth showing: it identifies a log line,
    // not a tenant, a table or a query.
    expect(alert.textContent).toMatch(/cid-test/);
  });
  it("offers a one-tap update when an item price changed, then checks out at the new price", async () => {
    const stub = stubApi(
      routes([
        {
          path: "/api/v1/sales",
          method: "POST",
          replies: [
            {
              kind: "error",
              status: 409,
              code: "price_mismatch",
              message: "An item's price changed while the bill was open.",
              extra: {
                variantId: SHIRT.variantId,
                sentPriceMinor: 10000,
                currentPriceMinor: 12000,
              },
            },
            {
              kind: "ok",
              body: { sale: { ...SALE, totalMinor: 12000, subtotalMinor: 11429, taxMinor: 571 }, duplicate: false },
            },
          ],
        },
      ]),
    );
    const user = await billWithOneItem(stub);

    // First attempt at taking payment
    await user.click(payButton());

    // Should see prompt: "Price of Cotton Shirt changed to ₹120. Update the bill?"
    const prompt = await screen.findByText(/Price of Cotton Shirt changed to .*120.*Update the bill\?/);
    expect(prompt).toBeTruthy();

    // Click Update
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    expect(screen.queryByText(/Update the bill\?/)).toBeNull();

    // Line total and take payment button reflect the new price
    await waitFor(() => expect(payButton().disabled).toBe(false));
    await user.click(payButton());

    await waitFor(() =>
      expect(stub.calls.filter((c) => c.url === "/api/v1/sales" && c.method === "POST")).toHaveLength(2),
    );
    const posts = stub.calls.filter((c) => c.url === "/api/v1/sales" && c.method === "POST");
    const first = posts[0]!.body as { idempotencyKey: string; lines: Record<string, unknown>[] };
    const second = posts[1]!.body as { idempotencyKey: string; lines: Record<string, unknown>[] };

    expect(first.lines[0]).toMatchObject({ variantId: SHIRT.variantId, quantity: 1, unitPriceMinor: 10000 });
    expect(second.lines[0]).toMatchObject({ variantId: SHIRT.variantId, quantity: 1, unitPriceMinor: 12000 });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);

    // Completed sale panel appears
    await screen.findByText(/sale complete/i);
  });
});
