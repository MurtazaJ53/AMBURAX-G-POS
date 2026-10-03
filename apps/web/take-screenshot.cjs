const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: Math.round(1536 / 0.9), height: Math.round(1024 / 0.9) }, deviceScaleFactor: 0.9 });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/auth/login');
  try {
    await page.waitForSelector('input[id="email"]', { timeout: 3000 });
    await page.fill('input[id="email"]', 'owner@demo.amburax.test');
    await page.fill('input[id="password"]', 'Passw0rd!123');
    await page.click('button[type="submit"]');
  } catch(e){}
  
  await page.waitForTimeout(1000);
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('button:has-text("₹1")');
  
  const products = await page.$$('button:has-text("₹1")');
  for (let i=0; i<8; i++) {
    if (products[i]) await products[i].click();
    else await products[0].click();
  }
  
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:/Users/rashi/.gemini/antigravity/brain/89e92217-79d1-43a6-be3f-cf6c14a454d6/ultra-compact-pos.png' });
  await browser.close();
})();
