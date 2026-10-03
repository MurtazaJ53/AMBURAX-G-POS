const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('response', response => console.log('RESPONSE:', response.url(), response.status()));

  await page.goto('http://localhost:3000/auth/login');
  await page.fill('input[id="email"]', 'owner@demo.amburax.test');
  await page.fill('input[id="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  
  console.log('Navigating to /pos...');
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  console.log('Clicking product...');
  const firstProd = page.locator('button').filter({ has: page.locator('.aspect-square') }).first();
  await firstProd.click({ force: true });
  await page.waitForTimeout(2000);
  
  const cartItems = await page.evaluate(() => document.querySelectorAll('ul > li').length);
  console.log("Cart items after click:", cartItems);
  
  await browser.close();
})();
