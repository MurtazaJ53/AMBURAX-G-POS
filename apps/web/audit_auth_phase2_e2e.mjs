import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';

async function cleanupTestTenant() {
  const prisma = new PrismaClient();
  try {
    const tenants = await prisma.tenant.findMany({
      where: { name: 'E2E Test Auth Business' },
    });
    for (const tenant of tenants) {
      // Delete cascading dependencies manually if needed
      await prisma.session.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.onboardingSession.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenantCapability.deleteMany({ where: { tenantId: tenant.id } });
      
      await prisma.user.deleteMany({ where: { email: 'owner.e2e@amburax.test' } });
      // Also delete any users in this tenant
      await prisma.user.deleteMany({ where: { memberships: { some: { tenantId: tenant.id } } } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
      console.log('[CLEANUP] Deleted E2E test tenant.');
    }
  } catch (e) {
    console.error(`[CLEANUP] Failed to delete test tenant:`, e);
  } finally {
    await prisma.$disconnect();
  }
}

const TARGET_URLS = [
  { url: 'http://localhost:3000', isNgrok: false },
  { url: 'https://unnerve-amino-overbite.ngrok-free.dev', isNgrok: true },
];

async function runTest(baseURL, isNgrok = false) {
  console.log(`\n--- STARTING AUTH PHASE 2 AUDIT ON ${baseURL} ---`);
  
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
    if (msg.type() === 'error' && !msg.text().includes('401') && !msg.text().includes('404')) {
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
    // ==========================================
    // FORGOT PASSWORD
    // ==========================================
    await page.goto(`${baseURL}/auth/forgot-password`);
    await page.waitForSelector('input[type="email"]');
    
    // Empty email
    await page.click('button[type="submit"]');
    let errCount = await page.locator('text=Enter your email address.').count();
    console.log(`[TEST] Forgot Password Empty Field: ${errCount > 0 ? 'PASS' : 'FAIL'}`);

    // Malformed email
    await page.fill('input[type="email"]', 'notanemail');
    await page.click('button[type="submit"]');
    errCount = await page.locator('text=Please enter a valid email address.').count();
    console.log(`[TEST] Forgot Password Malformed: ${errCount > 0 ? 'PASS' : 'FAIL'}`);

    // Valid email (will hit generic safe response)
    await page.fill('input[type="email"]', 'owner@demo.amburax.test');
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=If an account exists for that email'); 
    console.log(`[TEST] Forgot Password Success (Safe Generic): PASS`);

    // ==========================================
    // RESET PASSWORD
    // ==========================================
    await page.goto(`${baseURL}/auth/reset-password`);
    // Without token, should redirect or show no token error.
    await page.waitForTimeout(500);
    errCount = await page.locator('text=This reset link is invalid.').count();
    console.log(`[TEST] Reset Password No Token Rejected: ${errCount > 0 ? 'PASS' : 'FAIL'}`);

    // ==========================================
    // ONBOARDING (REGISTRATION)
    // ==========================================
    await page.goto(`${baseURL}/onboarding/business`);
    await page.waitForSelector('#businessName');
    
    // Fill out business to get to owner screen
    await page.fill('#businessName', 'E2E Test Auth Business');
    await page.fill('#country', 'US');
    await page.fill('#contactEmail', 'e2e@amburax.test');
    await page.fill('#contactPhone', '+15550100');
    // accept terms
    await page.click('input[type="checkbox"]');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('**/onboarding/owner', { timeout: 10000 });
    console.log(`[TEST] Tenant Registration Success: PASS`);

    // Owner Account Validations
    await page.waitForSelector('#name');
    await page.click('button[type="submit"]');
    errCount = await page.locator('text=Please enter your name.').count();
    console.log(`[TEST] Owner Reg Empty Name: ${errCount > 0 ? 'PASS' : 'FAIL'}`);

    await page.fill('#name', 'E2E Owner');
    await page.click('button[type="submit"]');
    errCount = await page.locator('text=Please enter your email address.').count();
    console.log(`[TEST] Owner Reg Empty Email: ${errCount > 0 ? 'PASS' : 'FAIL'}`);

    await page.fill('#email', 'malformed');
    await page.click('button[type="submit"]');
    errCount = await page.locator('text=Please enter a valid email address.').count();
    console.log(`[TEST] Owner Reg Malformed Email: ${errCount > 0 ? 'PASS' : 'FAIL'}`);

    await page.fill('#email', 'owner.e2e@amburax.test');
    await page.click('button[type="submit"]');
    errCount = await page.locator('text=Please enter a password.').count();
    console.log(`[TEST] Owner Reg Empty Password: ${errCount > 0 ? 'PASS' : 'FAIL'}`);

    await page.fill('#password', 'P@ssword123');
    await page.fill('#confirmPassword', 'P@ssword321');
    await page.click('button[type="submit"]');
    errCount = await page.locator('text=Passwords do not match.').count();
    console.log(`[TEST] Owner Reg Password Mismatch: ${errCount > 0 ? 'PASS' : 'FAIL'}`);

    // Wait, the client-side validatePasswordStrength might be needed if they have weak passwords.
    
    await page.fill('#password', 'P@ssw0rd!Secure');
    await page.fill('#confirmPassword', 'P@ssw0rd!Secure');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/onboarding/store', { timeout: 10000 });
    console.log(`[TEST] Owner Account Created (Auth Established): PASS`);

    // ==========================================
    // MULTI-TAB SESSION INVALIDATION
    // ==========================================
    // After onboarding finishes, user is logged in. Let's clear cookies to force a clean slate.
    await context.clearCookies();
    await page.goto(`${baseURL}/auth/login`);
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'owner@demo.amburax.test');
    await page.fill('input[type="password"]', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    const tabA = page;
    const tabB = await context.newPage();
    await tabB.goto(`${baseURL}/dashboard`);
    await tabB.waitForSelector('text=Owner');
    console.log(`[TEST] Session Sharing Across Tabs: PASS`);

      // Logout from Tab A
      await tabA.evaluate(async () => { await fetch('/api/v1/auth/logout', { method: 'POST' }); });
      await tabA.goto(`${baseURL}/auth/login`);
    await tabA.waitForURL('**/auth/login', { timeout: 10000 });
    
    // Tab B attempts to navigate to Inventory
    await tabB.goto(`${baseURL}/inventory`);
    await tabB.waitForURL('**/auth/login', { timeout: 10000 });
    console.log(`[TEST] Multi-Tab Session Revocation Respected: PASS`);

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
  await cleanupTestTenant(); // Cleanup before running
  await runTest('http://localhost:3000', false);
  await cleanupTestTenant(); // Cleanup between tests
  await runTest('https://unnerve-amino-overbite.ngrok-free.dev', true);
  await cleanupTestTenant(); // Cleanup after running
})();
