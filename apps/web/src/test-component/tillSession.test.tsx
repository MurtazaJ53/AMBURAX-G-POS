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

  it("offers no cash, float or drawer control", async () => {
    stubApi([
      { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
      { path: "/api/v1/pos/sessions", replies: [{ kind: "ok", body: { session: SESSION } }] },
    ]);
    renderTill();
    await screen.findByText(/was resumed/i);

    // The backend does not model cash balancing. A field here would produce a figure nobody
    // reconciles, which is worse than no figure at all.
    expect(screen.queryByLabelText(/opening float/i)).toBeNull();
    expect(screen.queryByLabelText(/cash counted/i)).toBeNull();
    expect(screen.queryByLabelText(/drawer amount/i)).toBeNull();
    expect(screen.queryByLabelText(/variance/i)).toBeNull();

    // Nothing in the shift area takes a number, which is the structural version of the same
    // claim: there is no money input to mistake for a counted one.
    const shiftInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("input"),
    ).filter((input) => input.type === "number");
    expect(shiftInputs).toHaveLength(0);

    // And the one free-text field says what it is not.
    expect(screen.getByText(/not a cash count/i)).toBeTruthy();
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
