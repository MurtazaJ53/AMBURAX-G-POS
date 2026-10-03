const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('input[id="email"]', 'owner@demo.amburax.test');
  await page.fill('input[id="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');
  await page.waitForURL('http://localhost:3000/');
  await page.waitForTimeout(1000);
  
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
  
  const cartInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const completeSale = btns.find(b => b.textContent.includes('Complete Sale'));
    if (!completeSale) return "No complete sale button";
    const rightPanel = completeSale.closest('.flex.flex-col.h-full') || completeSale.parentElement.parentElement.parentElement;
    
    // Find the cart list container which has bg-slate-50/50
    const listContainer = rightPanel.querySelector('.bg-slate-50\\/50');
    if (!listContainer) return "No list container";
    
    const items = Array.from(listContainer.children).filter(child => child.classList.contains('flex') && child.classList.contains('items-center') && child.classList.contains('gap-2'));
    
    return items.map(item => {
        // extract name from p tag with truncate
        const nameP = item.querySelector('p.font-bold.truncate');
        return {
            name: nameP ? nameP.textContent : "Unknown"
        };
    });
  });
  
  console.log("Actual cart items rendered:", cartInfo);

  await page.screenshot({ path: 'pos-check3.png' });
  await browser.close();
})();
