const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let has404 = false;
  let hasErrors = false;

  page.on('response', (response) => {
    // Ignore 404s for favicon or other common unrelated stuff if necessary, 
    // but we'll log all 400+ to be safe
    if (response.status() >= 400) {
      console.error(`Ngrok Network Error: ${response.status()} ${response.url()}`);
      has404 = true;
    }
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error(`Ngrok Console Error: ${msg.text()}`);
      hasErrors = true;
    }
  });

  page.on('pageerror', err => {
    console.error(`Ngrok Page Runtime Error: ${err.message}`);
    hasErrors = true;
  });

  console.log("Navigating to ngrok login...");
  // Bypass ngrok warning if any by setting headers or visiting it normally
  await page.goto('https://unnerve-amino-overbite.ngrok-free.dev/auth/login', { waitUntil: 'networkidle' });
  
  // If there's an ngrok warning page, click continue
  if (await page.isVisible('button:has-text("Visit Site")')) {
    await page.click('button:has-text("Visit Site")');
    await page.waitForLoadState('networkidle');
  }

  console.log("Logging in via Ngrok...");
  await page.fill('input[type="email"]', 'owner@demo.amburax.test');
  await page.fill('input[type="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');

  await page.waitForURL('**/dashboard');
  await page.waitForLoadState('networkidle');

  if (!fs.existsSync('screenshots')) fs.mkdirSync('screenshots');

  // Dashboard 1536
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/ngrok-smoke-dashboard-1536px.png' });
  console.log("Ngrok Dashboard 1536 captured");

  // Sales 1536
  await page.goto('https://unnerve-amino-overbite.ngrok-free.dev/sales', { waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/ngrok-smoke-sales-1536px.png' });
  console.log("Ngrok Sales 1536 captured");

  await browser.close();

  console.log(`\nNgrok Results:`);
  console.log(`404s detected: ${has404}`);
  console.log(`Console/Runtime Errors: ${hasErrors}`);
})();
