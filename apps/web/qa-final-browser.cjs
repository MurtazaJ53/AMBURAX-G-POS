const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  // Simulating 90% browser zoom for a 1536x1024 physical window.
  // 1536 / 0.9 = 1706.66 css pixels
  // 1024 / 0.9 = 1137.77 css pixels
  const context = await browser.newContext({ viewport: { width: Math.round(1536 / 0.9), height: Math.round(1024 / 0.9) }, deviceScaleFactor: 0.9 });
  await context.clearCookies();
  const page = await context.newPage();

  console.log("Navigating to login...");
  await page.goto('http://localhost:3000/auth/login');
  
  try {
    await page.waitForSelector('input[id="email"]', { timeout: 3000 });
    console.log("Logging in...");
    await page.fill('input[id="email"]', 'owner@demo.amburax.test');
    await page.fill('input[id="password"]', 'Passw0rd!123');
    await page.click('button[type="submit"]');
  } catch (e) {
    console.log("Already logged in or no login prompt.");
  }
  
  await page.waitForTimeout(1000);
  console.log("Navigating to POS...");
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('button:has-text("₹")');

  const stats = await page.evaluate(() => {
     let checkoutPanel = document.querySelector('.w-\\[390px\\]');
     let leftWorkspace = checkoutPanel ? checkoutPanel.previousElementSibling : null;
     
     // The top bar from layout.tsx
     let topHeader = document.querySelector('header');
     let topHeaderHeight = topHeader ? Math.round(topHeader.getBoundingClientRect().height) : 0;
     
     // The sidebar from layout.tsx
     let sidebar = document.querySelector('aside');
     let sidebarWidth = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0;
     
     // The product grid
     let grid = leftWorkspace ? leftWorkspace.querySelector('.grid.gap-4') : null;
     
     let productCards = grid ? Array.from(grid.children) : [];
     let cardsInFirstRow = 0;
     if (productCards.length > 0) {
        let firstTop = productCards[0].getBoundingClientRect().top;
        for (let card of productCards) {
           if (card.getBoundingClientRect().top === firstTop) {
               cardsInFirstRow++;
           }
        }
     }
     
     return {
        sidebarWidth,
        topHeaderHeight,
        leftWorkspaceWidth: leftWorkspace ? Math.round(leftWorkspace.getBoundingClientRect().width) : 0,
        checkoutWidth: checkoutPanel ? Math.round(checkoutPanel.getBoundingClientRect().width) : 0,
        cardsInFirstRow,
     }
  });

  console.log("Stats at 1536:", JSON.stringify(stats, null, 2));

  let failed = false;
  const fail = (msg) => { console.error("FAIL: " + msg); failed = true; }

  // Check left workspace
  if (stats.sidebarWidth < 230 || stats.sidebarWidth > 250) fail("Sidebar not 230-250: " + stats.sidebarWidth);
  if (stats.topHeaderHeight < 64 || stats.topHeaderHeight > 72) fail("Top Header not 64-72: " + stats.topHeaderHeight);
  if (stats.cardsInFirstRow !== 6) fail("Expected 6 cards per row, got " + stats.cardsInFirstRow);
  
  if (failed) {
    process.exit(1);
  } else {
    console.log("LEFT WORKSPACE GATES PASSED.");
  }
  
  await browser.close();
})();
