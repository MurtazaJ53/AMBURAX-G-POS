import { chromium } from "playwright";
import fs from "fs";
import path from "path";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to login...");
  await page.goto("http://localhost:3000/auth/login");
  
  await page.fill('input[name="email"]', "owner@demo.amburax.test");
  await page.fill('input[name="password"]', "Passw0rd!123");
  await page.click('button[type="submit"]');

  console.log("Waiting for login to complete...");
  await page.waitForURL("**/dashboard*");
  
  // Set viewport to 1536x900
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshot_dashboard_1536.png", fullPage: true });

  await browser.close();
}

run().catch(console.error);
