const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
  });
  const page = await context.newPage();

  console.log('Logging in...');
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('input[name="email"]', 'admin@amburax.com');
  await page.fill('input[name="password"]', 'admin');
  await page.click('button[type="submit"]');
  
  await page.waitForURL('**/dashboard**');

  console.log('Navigating to inventory...');
  await page.goto('http://localhost:3000/inventory');
  await page.waitForSelector('text=Stock Overview', { timeout: 10000 });

  // Check horizontal overflow
  const layout = await page.evaluate(() => {
    const w = document.documentElement.scrollWidth;
    const cw = document.documentElement.clientWidth;
    return { w, cw };
  });
  console.log('Mobile Layout:', layout);

  if (layout.w > layout.cw) {
    console.log('ERROR: Horizontal overflow detected!');
  } else {
    console.log('SUCCESS: No horizontal overflow.');
  }

  await page.screenshot({ path: 'inventory_mobile.png' });
  console.log('Screenshot saved to inventory_mobile.png');

  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
