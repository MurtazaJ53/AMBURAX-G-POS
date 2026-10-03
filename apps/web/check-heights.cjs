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
  
  const viewports = [
    { w: 900,  h: 1024 },
    { w: 390,  h: 844  }
  ];
  
  for (const vp of viewports) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(500);
      const res = await page.evaluate(() => {
         const left = document.querySelector('.flex-1.flex-col.min-w-0');
         const completeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Complete Sale'));
         const right = completeBtn.parentElement.parentElement.parentElement;
         return {
             leftHeight: left ? left.getBoundingClientRect().height : 0,
             rightHeight: right ? right.getBoundingClientRect().height : 0,
             containerHeight: left ? left.parentElement.getBoundingClientRect().height : 0,
             containerScrollHeight: left ? left.parentElement.scrollHeight : 0
         };
      });
      console.log(`${vp.w}x${vp.h}: leftHeight=${res.leftHeight}, rightHeight=${res.rightHeight}, containerHeight=${res.containerHeight}, containerScrollHeight=${res.containerScrollHeight}`);
  }

  await browser.close();
})();
