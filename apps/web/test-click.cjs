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
  
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter(b => b.querySelector('img'));
    if(btns.length > 0) {
      btns[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
  });

  await page.waitForTimeout(1000);
  const cartItems = await page.evaluate(() => document.querySelectorAll('ul > li').length);
  console.log("Cart items:", cartItems);
  await browser.close();
})();
