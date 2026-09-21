import { chromium } from 'playwright';

async function runTest(baseURL, isNgrok = false) {
  console.log(`\n--- STARTING AUTH AUDIT ON ${baseURL} ---`);
  
  const browser = await chromium.launch({ headless: true });
  const contextOptions = { ignoreHTTPSErrors: true };
  if (isNgrok) {
    contextOptions.extraHTTPHeaders = { 'ngrok-skip-browser-warning': 'true' };
  }
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  
  let networkErrors = 0;
  let consoleErrors = 0;

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors++;
      console.log(`[CONSOLE ERROR] ${msg.text()}`);
    }
  });

  page.on('response', response => {
    if (response.status() >= 500) {
      networkErrors++;
      console.log(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
    }
  });

  try {
    // Navigate to Login
    await page.goto(`${baseURL}/auth/login`);
    await page.waitForSelector('input[type="email"]');
    
    // 1. Empty Email & Password
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);
    const emptyValidation = await page.locator('text=Please enter your email and password.').count();
    console.log(`[TEST] Empty Fields: ${emptyValidation > 0 ? 'PASS' : 'FAIL'}`);

    // 2. Empty Password
    await page.fill('input[type="email"]', 'owner@demo.amburax.test');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);
    const emptyPwdValidation = await page.locator('text=Please enter your password.').count();
    console.log(`[TEST] Empty Password: ${emptyPwdValidation > 0 ? 'PASS' : 'FAIL'}`);

    // 3. Malformed Email
    await page.fill('input[type="email"]', 'owner demo');
    await page.fill('input[type="password"]', 'pass');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);
    const malformedEmailValidation = await page.locator('text=Please enter a valid email address.').count();
    console.log(`[TEST] Malformed Email: ${malformedEmailValidation > 0 ? 'PASS' : 'FAIL'}`);

    // 4. Wrong Credentials
    await page.fill('input[type="email"]', 'owner@demo.amburax.test');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    const urlAfterWrong = page.url();
    const isStillOnLogin = urlAfterWrong.includes('/auth/login');
    const hasUrlCredentials = urlAfterWrong.includes('password=');
    const authError = await page.locator('text=The email or password you entered is incorrect').count();
    console.log(`[TEST] Wrong Credentials - Stays on Login: ${isStillOnLogin ? 'PASS' : 'FAIL'}`);
    console.log(`[TEST] Wrong Credentials - No URL Leak: ${!hasUrlCredentials ? 'PASS' : 'FAIL'}`);
    console.log(`[TEST] Wrong Credentials - Auth Error Shown: ${authError > 0 ? 'PASS' : 'FAIL'}`);

    // 5. Correct Login
    await page.fill('input[type="password"]', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('[TEST] Correct Login: PASS');

    // 6. Access Protected Route (Inventory)
    await page.goto(`${baseURL}/inventory`);
    await page.waitForSelector('text=Stock Overview');
    console.log('[TEST] Protected Route Access: PASS');

    // 7. Logout
    await page.goto(`${baseURL}/dashboard`);
    await page.waitForTimeout(1000); // Wait for the page to settle
    
    // Find the UserMenu button which contains the roleLabel (e.g. Owner)
    const userMenuButton = page.locator('button[aria-haspopup="menu"]').last();
    await userMenuButton.click();
    
    const logoutBtn = page.locator('text=Sign out');
    await logoutBtn.click();
    await page.waitForURL('**/auth/login', { timeout: 10000 });
    console.log('[TEST] Logout Redirect to Login: PASS');

    // 8. Reject Post-Logout Access
    await page.goto(`${baseURL}/dashboard`);
    await page.waitForURL('**/auth/login', { timeout: 10000 });
    console.log('[TEST] Post-Logout Dashboard Rejection: PASS');

    await page.goto(`${baseURL}/inventory`);
    await page.waitForURL('**/auth/login', { timeout: 10000 });
    console.log('[TEST] Post-Logout Inventory Rejection: PASS');

  } catch (e) {
    console.error('[FATAL] Script failed:', e.message);
  } finally {
    await browser.close();
    console.log(`--- FINISHED ${baseURL} ---`);
    console.log(`Network Errors: ${networkErrors}`);
    console.log(`Console Errors: ${consoleErrors}`);
  }
}

(async () => {
  await runTest('http://localhost:3000', false);
  await runTest('https://unnerve-amino-overbite.ngrok-free.dev', true);
})();
