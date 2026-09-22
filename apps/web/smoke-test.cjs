const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let has404 = false;
  let hasErrors = false;

  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.error(`Network Error: ${response.status()} ${response.url()}`);
      has404 = true;
    }
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error(`Console Error: ${msg.text()}`);
      hasErrors = true;
    }
  });

  page.on('pageerror', err => {
    console.error(`Page Runtime Error: ${err.message}`);
    hasErrors = true;
  });

  console.log("Navigating to login...");
  await page.goto('http://localhost:3000/auth/login');
  await page.waitForLoadState('networkidle');

  console.log("Logging in...");
  await page.fill('input[type="email"]', 'owner@demo.amburax.test');
  await page.fill('input[type="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');

  await page.waitForURL('http://localhost:3000/dashboard');
  await page.waitForLoadState('networkidle');

  if (!fs.existsSync('screenshots')) fs.mkdirSync('screenshots');

  // Dashboard 1536
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/smoke-dashboard-1536px.png' });
  console.log("Dashboard 1536 captured");

  // Dashboard 390
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/smoke-dashboard-390px.png' });
  console.log("Dashboard 390 captured");

  // Sales 1536
  await page.goto('http://localhost:3000/sales');
  await page.waitForLoadState('networkidle');
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/smoke-sales-1536px.png' });
  console.log("Sales 1536 captured");

  // Sales 390
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/smoke-sales-390px.png' });
  console.log("Sales 390 captured");

  await browser.close();

  console.log(`\nResults:`);
  console.log(`404s detected: ${has404}`);
  console.log(`Console/Runtime Errors: ${hasErrors}`);
})();
