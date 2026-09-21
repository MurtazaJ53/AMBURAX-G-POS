import { chromium } from '@playwright/test';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to login...");
  await page.goto('http://localhost:3000/auth/login');
  
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', 'owner@demo.amburax.test');
  await page.fill('input[type="password"]', 'Passw0rd!123');
  await page.click('button:has-text("Sign In")');
  
  console.log("Waiting for login to complete...");
  await page.waitForNavigation();
  
  console.log("Going to products...");
  await page.goto('http://localhost:3000/products');
  await page.waitForLoadState('networkidle');

  const sizes = [
    { width: 1536, height: 864, name: '1536' },
    { width: 1280, height: 800, name: '1280' },
    { width: 1024, height: 768, name: '1024' },
    { width: 768, height: 1024, name: '768' },
    { width: 390, height: 844, name: '390' }
  ];

  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(2000); // let layout settle
    await page.screenshot({ path: `screenshot_${size.name}.png` });
    console.log(`Captured ${size.name}`);
  }

  // Desktop Inspector
  console.log("Testing Inspector at 1536...");
  await page.setViewportSize({ width: 1536, height: 864 });
  // Click first product card
  const productCards = page.locator('a[href^="/products?product="]');
  if (await productCards.count() > 0) {
    await productCards.first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `screenshot_1536_inspector.png` });
    console.log("Captured 1536 Inspector");
  } else {
    console.log("No product cards found!");
  }

  // Mobile Inspector
  console.log("Testing Inspector at 390...");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `screenshot_390_inspector.png` });
  console.log("Captured 390 Inspector");
  
  // Mobile Filter Drawer
  await page.goto('http://localhost:3000/products');
  await page.waitForLoadState('networkidle');
  console.log("Testing Filter Drawer at 390...");
  await page.setViewportSize({ width: 390, height: 844 });
  const filterBtn = page.locator('button', { hasText: 'Filter' });
  if (await filterBtn.count() > 0) {
    await filterBtn.first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `screenshot_390_filters.png` });
    console.log("Captured 390 Filters");
  } else {
    console.log("Filter button not found");
  }

  // Interaction Tests
  console.log("Running Interaction Tests...");
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('http://localhost:3000/products');
  await page.waitForLoadState('networkidle');

  // Search
  await page.fill('input[type="search"]', 'TestSearch');
  await page.waitForTimeout(1000);
  console.log("Search URL:", page.url());
  
  await browser.close();
})();
