import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Browser audit of the seeded 18-month shop (prisma/seedRealShop.ts).
 *
 * Signs in through the real login form as the shop's owner, then opens every screen on a desktop
 * and a phone viewport and records what a person would hit: HTTP errors, browser console errors,
 * uncaught page errors, horizontal scrolling on a phone, and serious/critical accessibility issues
 * (axe-core). Screenshots and a JSON report go to AUDIT_OUT. Credentials come from the environment.
 */

const EMAIL = process.env.SKF_EMAIL ?? "";
const PASSWORD = process.env.SKF_PASSWORD ?? "";
const OUT = process.env.AUDIT_OUT ?? path.resolve("e2e-audit");

const ROUTES = [
  "/dashboard",
  "/operations",
  "/stores",
  "/pos",
  "/till",
  "/sales",
  "/sales/imported",
  "/inventory",
  "/products",
  "/products/gst",
  "/customers",
  "/staff",
  "/cash",
  "/khata",
  "/suppliers",
  "/purchases",
  "/purchases/new",
  "/offers",
  "/reports",
  "/settings",
  "/settings/company",
  "/settings/import",
  "/settings/terminals",
  "/settings/system-health",
  "/ai",
];

type Finding = {
  route: string;
  viewport: string;
  status: number | null;
  ms: number;
  consoleErrors: string[];
  pageErrors: string[];
  overflowPx: number;
  axe: { id: string; impact: string; nodes: number }[];
};

async function signIn(page: Page) {
  await page.goto("/auth/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log ?in/i }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 20_000 });
}

async function axe(page: Page) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () => {
    // @ts-expect-error injected by addScriptTag
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
    return (r.violations as { id: string; impact: string; nodes: unknown[] }[])
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  });
}

test.describe.configure({ mode: "serial" });
test.setTimeout(15 * 60_000);

test("every screen of the seeded shop, desktop and phone", async ({ browser }) => {
  test.skip(!EMAIL || !PASSWORD, "SKF_EMAIL / SKF_PASSWORD not set");
  fs.mkdirSync(OUT, { recursive: true });
  const findings: Finding[] = [];
  for (const vp of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await signIn(page);
    for (const route of ROUTES) {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.removeAllListeners("console");
      page.removeAllListeners("pageerror");
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
      });
      page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
      const t0 = Date.now();
      const res = await page.goto(route, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => null);
      const ms = Date.now() - t0;
      await page.waitForTimeout(400);
      const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const violations = await axe(page).catch(() => []);
      await page.screenshot({ path: path.join(OUT, `${vp.name}${route.replaceAll("/", "_")}.png`), fullPage: vp.name === "desktop" });
      findings.push({ route, viewport: vp.name, status: res?.status() ?? null, ms, consoleErrors, pageErrors, overflowPx, axe: violations });
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(findings, null, 2));
  const broken = findings.filter((f) => (f.status ?? 500) >= 400 || f.pageErrors.length > 0);
  expect(broken.map((f) => `${f.viewport} ${f.route} ${f.status} ${f.pageErrors[0] ?? ""}`)).toEqual([]);
});

test("a cashier's day on the Till: open shift with opening cash, sell by name, take payment", async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, "SKF_EMAIL / SKF_PASSWORD not set");
  fs.mkdirSync(OUT, { recursive: true });
  await signIn(page);
  await page.goto("/till");
  // Two counters: pick the main one, as the cashier would on first use of this computer.
  const counter = page.getByRole("button", { name: /C1\s*Main Counter/i });
  await page.waitForTimeout(4000);
  if (await counter.isVisible({ timeout: 10_000 }).catch(() => false)) await counter.click();
  await page.waitForTimeout(1500);
  const openBtn = page.getByRole("button", { name: /open shift on/i });
  if (await openBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await page.getByLabel(/opening cash in drawer/i).fill("5000");
    await openBtn.click();
  }
  await page.screenshot({ path: path.join(OUT, "flow_till_start.png") });
  await expect(page.getByLabel(/scan or type a barcode/i)).toBeEnabled({ timeout: 20_000 });
  await page.getByLabel(/scan or type a barcode/i).fill("kurti");
  await page.getByRole("option").first().click({ timeout: 15_000 });
  await expect(page.getByLabel(/^quantity of /i).first()).toBeVisible();
  await page.getByRole("button", { name: /take /i }).click();
  await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(OUT, "flow_till_sale_complete.png") });
});

test("New purchase: find a product by name and fill sizes from the grid", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!EMAIL || !PASSWORD, "SKF_EMAIL / SKF_PASSWORD not set");
  fs.mkdirSync(OUT, { recursive: true });
  await signIn(page);
  await page.goto("/purchases/new");
  await page.getByLabel(/find a product by name/i).fill("Cotton Leggings");
  await page.getByRole("button", { name: /^Cotton Leggings/i }).first().click({ timeout: 15_000 });
  await page.getByLabel(/^Quantity of Cotton Leggings/i).first().fill("6");
  await page.getByRole("button", { name: /to the bill/i }).click();
  await expect(page.getByText("Cotton Leggings").first()).toBeVisible();
  await page.screenshot({ path: path.join(OUT, "flow_purchase_size_grid.png"), fullPage: true });
});
