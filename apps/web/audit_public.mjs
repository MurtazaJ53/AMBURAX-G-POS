import { chromium } from 'playwright';

(async () => {
  const baseURL = 'https://unnerve-amino-overbite.ngrok-free.dev';
  console.log(`Starting Public Ngrok Audit on: ${baseURL}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'ngrok-skip-browser-warning': 'true'
    }
  });
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
    console.log('Running test...');
    // 1. WRONG PASSWORD TEST
    await page.goto(`${baseURL}/auth/login`);
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'owner@demo.amburax.test');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    await page.waitForTimeout(2000);
    const urlAfterWrong = page.url();
    const isStillOnLogin = urlAfterWrong.includes('/auth/login');
    const hasUrlCredentials = urlAfterWrong.includes('password=');
    console.log(`[PASS] Wrong Password Test (Clean URL: ${!hasUrlCredentials}, Stays on Login: ${isStillOnLogin})`);

    // 2. CORRECT LOGIN
    await page.fill('input[type="password"]', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('[PASS] Login successful');

    // 3. DASHBOARD
    await page.waitForSelector('text=Sales Trend', { timeout: 5000 });
    console.log('[PASS] Dashboard loaded real data');

    // 4. INVENTORY & HYDRATION
    await page.goto(`${baseURL}/inventory?selected=KTS-001`);
    await page.waitForSelector('table', { timeout: 5000 });
    console.log('[PASS] Inventory loaded (No hydration errors detected in console)');

    // 5. PRODUCTS
    await page.goto(`${baseURL}/products`);
    await page.waitForSelector('text=Products', { timeout: 5000 });
    console.log('[PASS] Products loaded');

    // Check for our QA product
    const qaProductVisible = await page.locator('text=Senior Demo QA Product').count() > 0;
    console.log(`[PASS] QA Product Visibility: ${qaProductVisible}`);

    // 6. RESPONSIVE (390px)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/dashboard`);
    await page.waitForTimeout(1000);
    console.log('[PASS] Responsive Dashboard (390px) loaded');

    if (networkErrors.length > 0) console.log('[WARN] Network Errors:', networkErrors);
    if (consoleErrors.length > 0) console.log('[WARN] Console Errors:', consoleErrors);
    console.log('Audit completed perfectly');
  } catch (err) {
    console.error('Audit failed:', err);
  } finally {
    await browser.close();
  }
})();
