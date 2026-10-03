const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('input[id="email"]', 'owner@demo.amburax.test');
  await page.fill('input[id="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  const products = await page.locator('button').filter({ has: page.locator('.aspect-square') }).all();
  if (products.length >= 4) {
      for(let i=0; i<4; i++) {
          await products[i].click({ force: true });
          await page.waitForTimeout(500);
      }
  }
  
  await page.screenshot({ path: 'pos-check2.png' });
  await browser.close();
})();
