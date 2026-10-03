const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 900, height: 1024 } });
  const page = await context.newPage();
  
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('input[id="email"]', 'owner@demo.amburax.test');
  await page.fill('input[id="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
  
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  const res = await page.evaluate(() => {
     const left = document.querySelector('.flex-1.flex-col.min-w-0');
     const completeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Complete Sale'));
     const right = completeBtn.parentElement.parentElement.parentElement;
     return {
         leftClasses: left ? left.className : '',
         rightClasses: right ? right.className : ''
     };
  });
  console.log(`leftClasses: ${res.leftClasses}`);
  console.log(`rightClasses: ${res.rightClasses}`);

  await browser.close();
})();
