const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: Math.round(1536 / 0.9), height: Math.round(1024 / 0.9) }, deviceScaleFactor: 0.9 });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/auth/login');
  try {
    await page.waitForSelector('input[id=\"email\"]', { timeout: 3000 });
    await page.fill('input[id=\"email\"]', 'owner@demo.amburax.test');
    await page.fill('input[id=\"password\"]', 'Passw0rd!123');
    await page.click('button[type=\"submit\"]');
  } catch (e) {
  }
  await page.waitForTimeout(1000);
  await page.goto('http://localhost:3000/pos');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'pos-screenshot-fixed.png' });
  
  await page.click('button:has-text(\"Add\")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'pos-picker-open-fixed.png' });
  
  await browser.close();
})();
