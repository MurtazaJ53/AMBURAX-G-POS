import { expect, type Page } from "@playwright/test";
import { db, demoTenant } from "./db";

/**
 * A paired terminal to run tests on, created once and then reused.
 *
 * Reuse matters more than it looks. A terminal is permanent — the product has no way to delete
 * one — so a suite that created a fresh terminal per test would leave a trail of dead tills in
 * the development database and, worse, grow the terminal picker on the till screen until it no
 * longer resembles what a merchant sees. Runs of this suite did exactly that before this helper
 * existed.
 *
 * The first run creates and pairs one through the real endpoints; every run after that finds it
 * again by code. Nothing is inserted directly, and the pairing code is used exactly as a person
 * would use it: once, to make the terminal sellable.
 */

export const E2E_TERMINAL_CODE = "E2E-TILL";
const E2E_TERMINAL_NAME = "E2E Test Till";

export interface Terminal {
  id: string;
  code: string;
  name: string;
}

export async function ensureTerminal(page: Page): Promise<Terminal> {
  const { tenant, store } = await demoTenant();

  const existing = await db.posDevice.findFirst({
    where: { tenantId: tenant.id, storeId: store.id, code: E2E_TERMINAL_CODE },
    select: { id: true, code: true, name: true, activatedAt: true, disabledAt: true },
  });

  if (existing && existing.activatedAt && !existing.disabledAt) {
    return { id: existing.id, code: existing.code, name: existing.name };
  }

  if (existing) {
    // Created but never paired, or disabled. Neither is something this suite may repair through
    // the database, and neither is something the product can fix from here.
    throw new Error(
      `Terminal ${E2E_TERMINAL_CODE} exists but is not usable (activated=${!!existing.activatedAt}, disabled=${!!existing.disabledAt}).`,
    );
  }

  const created = await page.request.post("/api/v1/pos/devices", {
    data: { name: E2E_TERMINAL_NAME, code: E2E_TERMINAL_CODE },
  });
  expect(created.status(), "creating the test terminal").toBe(201);
  const body = await created.json();

  const activated = await page.request.post("/api/v1/pos/devices/activate", {
    data: { pairingCode: body.pairingCode },
  });
  expect(activated.status(), "pairing the test terminal").toBe(200);

  return { id: body.device.id, code: body.device.code, name: body.device.name };
}

/**
 * Select the terminal on screen and make sure a shift is open on it.
 *
 * Both states have to be handled, because a shift outlives a test: the first test of a run opens
 * one, and every test after it finds that same shift already open and is *resumed* rather than
 * offered a button. Probing for the button and clicking it in two steps races the re-render that
 * selection triggers — the button can be gone by the time the click lands — so the outcome is
 * waited for rather than guessed at, and the click only happens when there is genuinely no shift.
 */
export async function openShift(page: Page, terminal: Terminal): Promise<void> {
  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();

  const shiftOpen = page.getByText(
    /your shift is open on this terminal|shift on this terminal was resumed/i,
  );
  const openButton = page.getByRole("button", {
    name: new RegExp(`Open shift on ${terminal.code}`, "i"),
  });
  const picker = page.getByRole("button", { name: `${terminal.code} ${terminal.name}` });

  // Nothing selects a terminal for the operator when a store has several, so this is the first
  // real action either way, and the shift is only knowable per terminal afterwards.
  //
  // Waited for rather than probed: the status rail renders before the terminal list has been
  // fetched, so asking "is the picker visible yet" the moment the page settles answers no, the
  // click is skipped, and nothing further ever appears.
  await expect(picker).toBeVisible();
  await picker.click();

  // Which branch to take is decided from the server, not from the screen.
  //
  // Reading it off the DOM cannot be made reliable here: the open-shift button appears while the
  // terminal's shift is still being fetched and vanishes the moment it arrives, so any check of
  // the form "is the button there?" is answering a question whose answer is already changing. The
  // database knows unambiguously whether this terminal carries an open shift, so that is what is
  // asked.
  const { tenant } = await demoTenant();
  const alreadyOpen = await db.posSession.findFirst({
    where: { tenantId: tenant.id, posDeviceId: terminal.id, closedAt: null },
    select: { id: true },
  });

  if (!alreadyOpen) {
    await expect(openButton).toBeVisible();
    await openButton.click();
  }

  await expect(shiftOpen).toBeVisible();
}
