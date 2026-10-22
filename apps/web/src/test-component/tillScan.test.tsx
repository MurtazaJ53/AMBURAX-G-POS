import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "./render";
import userEvent from "@testing-library/user-event";
import { TillWorkspace } from "@/app/(app)/till/_components/TillWorkspace";
import { stubApi, readyTillRoutes, SHIRT, type ApiStub } from "./apiStub";

/**
 * Scanning, and what the bill does with the result.
 *
 * The three outcomes a counter confuses — unknown barcode, withdrawn item, failed lookup — get
 * a test each, asserting on the words a cashier actually reads. If any two of them ever start
 * saying the same thing, one of these fails.
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

async function readyToScan(stub: ApiStub) {
  await waitFor(() => expect(scanField().disabled).toBe(false));
  return stub;
}

describe("scanning", () => {
  it("uses the exact barcode endpoint, never catalogue search", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        { path: "/api/v1/pos/scan", replies: [{ kind: "ok", body: { item: SHIRT } }] },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "8901234567890{Enter}");

    await waitFor(() => expect(stub.countFor("/api/v1/pos/scan")).toBe(1));
    // A fuzzy search would land on the wrong variant and nobody would notice until the
    // customer got home, so the till must never route a scan through it.
    expect(stub.countFor("/api/v1/catalog/search")).toBe(0);
    expect(stub.calls.at(-1)?.url).toContain("barcode=8901234567890");
  });

  it("finds an item by name and adds it only when the cashier picks it", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        { path: "/api/v1/catalog/search", replies: [{ kind: "ok", body: { results: [SHIRT] } }] },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "cotton");
    const option = await screen.findByRole("option", { name: /Cotton Shirt/i });
    // Suggestions alone never touch the bill.
    expect(screen.getByText(/nothing on this bill yet/i)).toBeTruthy();
    await user.click(option);

    expect(await screen.findByLabelText(/^quantity of Cotton Shirt$/i)).toBeTruthy();
    expect(scanField().value).toBe("");
    expect(stub.countFor("/api/v1/pos/scan")).toBe(0);
  });

  it("puts a scanned item on the bill and clears the field for the next scan", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        { path: "/api/v1/pos/scan", replies: [{ kind: "ok", body: { item: SHIRT } }] },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "8901234567890{Enter}");

    await waitFor(() => expect(screen.getAllByText(/Cotton Shirt/i).length).toBeGreaterThan(0));
    expect(scanField().value).toBe("");
  });

  it("merges a repeated scan into one line rather than a second row", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        {
          path: "/api/v1/pos/scan",
          replies: [
            { kind: "ok", body: { item: SHIRT } },
            { kind: "ok", body: { item: SHIRT } },
          ],
        },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "8901234567890{Enter}");
    await waitFor(() => expect(stub.countFor("/api/v1/pos/scan")).toBe(1));
    await user.type(scanField(), "8901234567890{Enter}");
    await waitFor(() => expect(stub.countFor("/api/v1/pos/scan")).toBe(2));

    const quantity = (await screen.findByLabelText(/^quantity of Cotton Shirt$/i)) as HTMLInputElement;
    await waitFor(() => expect(quantity.value).toBe("2"));
  });

  it("names a withdrawn item and refuses it, rather than reporting an unknown barcode", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        {
          path: "/api/v1/pos/scan",
          replies: [{ kind: "ok", body: { item: { ...SHIRT, isActive: false } } }],
        },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "8901234567890{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not for sale/i);
    expect(alert.textContent).toMatch(/Cotton Shirt/);
    expect(alert.textContent).not.toMatch(/not found/i);
    expect(screen.getByText(/nothing on this bill yet/i)).toBeTruthy();
  });
});

describe("scan failures kept apart", () => {
  it("reports a missing barcode only for a 404", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        {
          path: "/api/v1/pos/scan",
          replies: [
            {
              kind: "error",
              status: 404,
              code: "not_found",
              message: "No item matches that barcode.",
            },
          ],
        },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "0000000000000{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/barcode not found/i);
    expect(alert.textContent).toMatch(/0000000000000/);
  });

  it("does not call a failed lookup a missing barcode", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        {
          path: "/api/v1/pos/scan",
          replies: [
            {
              kind: "error",
              status: 503,
              code: "service_unavailable",
              message: "Lookup is temporarily unavailable.",
            },
          ],
        },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "8901234567890{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/temporarily unavailable/i);
    expect(alert.textContent).not.toMatch(/not found/i);
  });
});

describe("stock is shown, never used to refuse", () => {
  it("shows a never-counted figure as uncounted rather than as zero", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        {
          path: "/api/v1/pos/scan",
          replies: [{ kind: "ok", body: { item: { ...SHIRT, stockQuantity: null } } }],
        },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "8901234567890{Enter}");

    // Null means this store has never counted the variant (ADR-080). Rendering it as zero in
    // stock invents a count nobody took.
    expect((await screen.findAllByText(/not counted/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0 in stock/i)).toBeNull();
  });

  it("does not refuse a scan because stock is zero", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        {
          path: "/api/v1/pos/scan",
          replies: [{ kind: "ok", body: { item: { ...SHIRT, stockQuantity: 0 } } }],
        },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "8901234567890{Enter}");

    // The counter has the item in hand; a stock projection does not get to contradict that.
    await waitFor(() => expect(screen.getAllByText(/Cotton Shirt/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/nothing on this bill yet/i)).toBeNull();
  });
});

describe("editing quantities", () => {
  it("steps a quantity up and removes the line when it falls below one", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        { path: "/api/v1/pos/scan", replies: [{ kind: "ok", body: { item: SHIRT } }] },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "8901234567890{Enter}");
    const quantity = (await screen.findByLabelText(/^quantity of Cotton Shirt$/i)) as HTMLInputElement;

    await user.click(screen.getByRole("button", { name: /increase quantity of Cotton Shirt/i }));
    await waitFor(() => expect(quantity.value).toBe("2"));

    await user.click(screen.getByRole("button", { name: /reduce quantity of Cotton Shirt/i }));
    await waitFor(() => expect(quantity.value).toBe("1"));

    await user.click(screen.getByRole("button", { name: /reduce quantity of Cotton Shirt/i }));
    await waitFor(() => expect(screen.getByText(/nothing on this bill yet/i)).toBeTruthy());
  });

  it("removes a line outright", async () => {
    const user = userEvent.setup();
    const stub = stubApi(
      readyTillRoutes([
        { path: "/api/v1/pos/scan", replies: [{ kind: "ok", body: { item: SHIRT } }] },
      ]),
    );
    renderTill();
    await readyToScan(stub);

    await user.type(scanField(), "8901234567890{Enter}");
    await screen.findByLabelText(/^quantity of Cotton Shirt$/i);

    await user.click(screen.getByRole("button", { name: /remove Cotton Shirt from the bill/i }));
    await waitFor(() => expect(screen.getByText(/nothing on this bill yet/i)).toBeTruthy());
  });
});
