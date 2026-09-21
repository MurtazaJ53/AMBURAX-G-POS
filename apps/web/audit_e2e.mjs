import { chromium } from 'playwright';

(async () => {
  let hasErrors = false;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const networkErrors = [];
  const consoleErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/api/v1/auth/login')) {
      networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    console.log('--- STARTING AUDIT ---');

    // 1. LOGIN
    await page.goto('http://localhost:3000/auth/login');
    await page.fill('input[type="email"]', 'owner@demo.amburax.test');
    await page.fill('input[type="password"]', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('[PASS] Login successful');

    // 2. DASHBOARD
    await page.waitForSelector('text=Sales Trend', { timeout: 5000 });
    await page.waitForSelector('text=Top Categories', { timeout: 5000 });
    await page.waitForSelector('text=Recent Sales', { timeout: 5000 });
    console.log('[PASS] Dashboard widgets loaded');

    // 3. INVENTORY
    await page.goto('http://localhost:3000/inventory');
    await page.waitForSelector('text=Stock Overview', { timeout: 5000 });
    await page.waitForSelector('table', { timeout: 5000 });
    console.log('[PASS] Inventory loaded');

    // 4. PRODUCTS
    await page.goto('http://localhost:3000/products');
    await page.waitForSelector('text=Products', { timeout: 5000 });
    console.log('[PASS] Products loaded');

    // 5. ADD PRODUCT (If available)
    try {
      const addBtn = await page.locator('a[href="/products/new"], button:has-text("Add Product"), button:has-text("New Product")');
      if (await addBtn.count() > 0) {
        await addBtn.first().click();
        await page.waitForURL('**/products/new', { timeout: 5000 });
        console.log('[PASS] Add Product route accessible');
        
        // Fill form
        const testProductName = `Senior Demo QA Product ${Date.now()}`;
        await page.fill('input[name="name"], input[placeholder*="name" i], input#name', testProductName);
        await page.click('button[type="submit"]:has-text("Save"), button[type="submit"]:has-text("Create")');
        await page.waitForURL('**/products*', { timeout: 5000 });
        console.log(`[PASS] Product created: ${testProductName}`);
      } else {
        console.log('[SKIP] Add Product not found or implemented');
      }
    } catch (e) {
      console.log('[FAIL] Add Product flow failed or timed out:', e.message);
    }

    if (networkErrors.length > 0) console.log('[WARN] Network Errors:', networkErrors);
    if (consoleErrors.length > 0) console.log('[WARN] Console Errors:', consoleErrors);

  } catch (err) {
    console.error('Audit failed:', err);
    hasErrors = true;
  } finally {
    await browser.close();
  }
})();
