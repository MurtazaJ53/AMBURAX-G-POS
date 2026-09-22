const { chromium } = require('playwright');
async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('#email', 'owner@demo.amburax.test');
  await page.fill('#password', 'Passw0rd!123');
  await page.click('button[type=\"submit\"]');
  await page.waitForURL(url => url.pathname !== '/auth/login', { timeout: 15000 });
  await page.goto('http://localhost:3000/dashboard');
  await page.waitForTimeout(3000);
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.screenshot({ path: 'screenshots/dashboard-current.png', fullPage: true });
  await browser.close();
}
run().catch(console.error);
