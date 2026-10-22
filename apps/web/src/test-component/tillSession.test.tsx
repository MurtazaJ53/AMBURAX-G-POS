import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "./render";
import userEvent from "@testing-library/user-event";
import { TillWorkspace } from "@/app/(app)/till/_components/TillWorkspace";
import { stubApi, DEVICE, SESSION } from "./apiStub";

/**
 * The shift, on screen.
 *
 * Each case is one of the states the backend can actually be in. They are tested through the
 * rendered surface rather than through the reducer — the reducer has its own suite, and what
 * is being checked here is that a cashier can *see* which state they are in and what to do
 * about it.
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

describe("shift states", () => {
  it("shows the cashier, store and terminal at all times", async () => {
    stubApi([
      { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
      { path: "/api/v1/pos/sessions", replies: [{ kind: "ok", body: { session: null } }] },
    ]);
    renderTill();

    const rail = await screen.findByRole("region", { name: /till status/i });
    expect(rail.textContent).toMatch(/Asha/);
    expect(rail.textContent).toMatch(/Linking Road/);
    await waitFor(() => expect(rail.textContent).toMatch(/POS-01/));
  });

  it("offers to open a shift when the terminal has none", async () => {
    stubApi([
      { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
      { path: "/api/v1/pos/sessions", replies: [{ kind: "ok", body: { session: null } }] },
    ]);
    renderTill();

    const open = (await screen.findByRole("button", {
      name: /open shift on POS-01/i,
    })) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    // Scanning is impossible without a shift, and the field says so rather than silently
    // swallowing keystrokes.
    expect(scanField().disabled).toBe(true);
  });

  it("resumes the cashier's own open shift without calling it a new one", async () => {
    stubApi([
      { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
      { path: "/api/v1/pos/sessions", replies: [{ kind: "ok", body: { session: SESSION } }] },
    ]);
    renderTill();

    expect(await screen.findByText(/was resumed/i)).toBeTruthy();
    expect(screen.getByText(/same shift, not a new one/i)).toBeTruthy();
    await waitFor(() => expect(scanField().disabled).toBe(false));
  });

  it("names another cashier's shift as a conflict rather than a failure", async () => {
    stubApi([
      { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
      {
        path: "/api/v1/pos/sessions",
        replies: [{ kind: "ok", body: { session: { ...SESSION, cashierUserId: "user-them" } } }],
      },
    ]);
    renderTill();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/another cashier/i);
    expect(alert.textContent).toMatch(/close their shift/i);
  });

  it("says a terminal is not paired instead of calling it unavailable", async () => {
    stubApi([
      {
        path: "/api/v1/pos/devices",
        replies: [
          {
            kind: "ok",
            body: { devices: [{ ...DEVICE, status: "PENDING_ACTIVATION", id: "dev-2" }] },
          },
        ],
      },
      { path: "/api/v1/pos/sessions", replies: [{ kind: "ok", body: { session: null } }] },
    ]);
    renderTill();

    expect(await screen.findByText(/not paired/i)).toBeTruthy();
  });

  it("opens a shift and reports a 201 as a new one", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
      { path: "/api/v1/pos/sessions", replies: [{ kind: "ok", body: { session: null } }] },
      {
        path: "/api/v1/pos/sessions",
        method: "POST",
        replies: [{ kind: "ok", status: 201, body: { session: SESSION, resumed: false } }],
      },
    ]);
    renderTill();

    await user.click(await screen.findByRole("button", { name: /open shift on POS-01/i }));
    expect(await screen.findByText(/your shift is open on this terminal/i)).toBeTruthy();
  });

  it("refuses to open when another shift already holds the terminal", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
      { path: "/api/v1/pos/sessions", replies: [{ kind: "ok", body: { session: null } }] },
      {
        path: "/api/v1/pos/sessions",
        method: "POST",
        replies: [
          {
            kind: "error",
            status: 409,
            code: "conflict",
            message: "Another shift is already open on this terminal.",
          },
        ],
      },
    ]);
    renderTill();

    await user.click(await screen.findByRole("button", { name: /open shift on POS-01/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/terminal busy/i);
  });

  it("pre-fills the opening cash from the last close and records it when the shift opens", async () => {
    const user = userEvent.setup();
    const stub = stubApi([
      { path: "/api/v1/pos/devices/dev-1/opening-cash", replies: [{ kind: "ok", body: { suggestedMinor: 250000, fromClosedAt: "2026-09-14T17:00:00.000Z", sessionFloatMinor: null } }] },
      { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
      { path: "/api/v1/pos/sessions?", replies: [{ kind: "ok", body: { session: null } }] },
      {
        path: "/api/v1/pos/sessions/sess-1/opening-cash",
        method: "POST",
        replies: [{ kind: "ok", body: { status: "ok" } }],
      },
      {
        path: "/api/v1/pos/sessions",
        method: "POST",
        replies: [{ kind: "ok", status: 201, body: { session: SESSION, resumed: false } }],
      },
    ]);
    renderTill();

    const cash = (await screen.findByLabelText(/opening cash in drawer/i)) as HTMLInputElement;
    await waitFor(() => expect(cash.value).toBe("2500"));
    expect(screen.getByText(/last close/i)).toBeTruthy();
    await user.clear(cash);
    await user.type(cash, "1800");
    await user.click(screen.getByRole("button", { name: /open shift on POS-01/i }));

    expect(await screen.findByText(/your shift is open on this terminal/i)).toBeTruthy();
    await waitFor(() =>
      expect(stub.calls.find((c) => c.url.endsWith("/sess-1/opening-cash"))?.body).toEqual({ amountMinor: 180000 }),
    );
    // The count itself is done in Cash & Day Close, one click away.
    expect(screen.getAllByRole("link", { name: /count cash/i })[0]!.getAttribute("href")).toBe("/cash/sess-1");
  });

  it("closes a shift and stops selling", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
      { path: "/api/v1/pos/sessions?", replies: [{ kind: "ok", body: { session: SESSION } }] },
      {
        path: "/api/v1/pos/sessions/sess-1",
        method: "POST",
        replies: [
          {
            kind: "ok",
            body: { session: { ...SESSION, isOpen: false, closedAt: "2026-09-15T17:00:00.000Z" } },
          },
        ],
      },
    ]);
    renderTill();

    await user.click(await screen.findByRole("button", { name: /close shift/i }));
    expect(await screen.findByText(/this shift is closed/i)).toBeTruthy();
    expect(scanField().disabled).toBe(true);
  });
});
