const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('input[id="email"]', 'owner@demo.amburax.test');
  await page.fill('input[id="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  
  const shiftBtn = page.locator('button', { hasText: 'No shift' }).first();
  if (await shiftBtn.isVisible()) {
    console.log("Clicking No shift");
    await shiftBtn.click();
    await page.waitForTimeout(1000);
    // Is there a Start Shift button now?
    const startBtn = page.locator('button', { hasText: 'Start Shift' }).first();
    if (await startBtn.count() > 0) {
      await startBtn.click();
      console.log("Started shift!");
      await page.waitForTimeout(1000);
    }
  }

  const firstProd = page.locator('button').filter({ has: page.locator('.aspect-square') }).first();
  await firstProd.click({ force: true });
  await page.waitForTimeout(1000);
  const cartItems = await page.evaluate(() => document.querySelectorAll('ul > li').length);
  console.log("Cart items after starting shift:", cartItems);
  await browser.close();
})();
