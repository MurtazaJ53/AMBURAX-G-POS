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
  
  const products = await page.$$('button:has-text("₹")');

  async function measure(itemCount) {
    const trashButtons = await page.$$('button:has(svg.lucide-trash2)');
    for (const btn of trashButtons) {
      await btn.click();
    }
    await page.waitForTimeout(500);
    
    for (let i = 0; i < itemCount; i++) {
      if (products[i]) {
        await products[i].click();
      } else {
        await products[0].click();
      }
    }
    
    await page.waitForTimeout(500);

    return await page.evaluate(() => {
      const checkoutPanel = document.querySelector('.w-\\[390px\\]');
      if (!checkoutPanel) return { error: "Checkout panel not found" };

      const header = checkoutPanel.children[0];
      const customer = checkoutPanel.children[1];
      const cartRegion = checkoutPanel.children[2];
      const footer = checkoutPanel.children[3];
      
      const cartItems = Array.from(cartRegion.querySelectorAll('.group'));
      const completeSale = footer.querySelector('#complete-sale-btn');
      
      let visibleCartItems = 0;
      const cartRect = cartRegion.getBoundingClientRect();
      
      const itemHeights = cartItems.map(item => {
         const rect = item.getBoundingClientRect();
         const isVisible = rect.top >= cartRect.top && Math.round(rect.bottom) <= Math.round(cartRect.bottom) + 2;
         if (isVisible) visibleCartItems++;
         return Math.round(rect.height);
      });

      return {
        checkoutWidth: Math.round(checkoutPanel.getBoundingClientRect().width),
        checkoutHeight: Math.round(checkoutPanel.getBoundingClientRect().height),
        headerHeight: Math.round(header.getBoundingClientRect().height),
        customerHeight: Math.round(customer.getBoundingClientRect().height),
        cartViewportHeight: Math.round(cartRegion.getBoundingClientRect().height),
        footerHeight: Math.round(footer.getBoundingClientRect().height),
        cartItemHeights: itemHeights,
        visibleCartItems,
        completeSaleHeight: completeSale ? Math.round(completeSale.getBoundingClientRect().height) : 0,
        pageScrollHeight: document.documentElement.scrollHeight,
        pageClientHeight: window.innerHeight,
        cartScrollHeight: cartRegion.scrollHeight,
        cartClientHeight: cartRegion.clientHeight
      };
    });
  }

  const m4 = await measure(4);
  console.log("m4 = " + JSON.stringify(m4, null, 2));
  const m5 = await measure(5);
  console.log("m5 = " + JSON.stringify(m5, null, 2));
  const m10 = await measure(10);
  console.log("m10 = " + JSON.stringify(m10, null, 2));
  
  await browser.close();

  let failed = false;
  const fail = (msg) => { console.error("FAIL: " + msg); failed = true; }

  if (m4.checkoutWidth < 380 || m4.checkoutWidth > 400) fail("Checkout width not in 380-400: " + m4.checkoutWidth);
  if (m4.headerHeight < 48 || m4.headerHeight > 54) fail("Header not in 48-54: " + m4.headerHeight);
  if (m4.customerHeight < 76 || m4.customerHeight > 90) fail("Customer not in 76-90: " + m4.customerHeight);
  if (m4.footerHeight > 460) fail("Footer height too tall! " + m4.footerHeight + " > 460");
  if (m4.completeSaleHeight < 46 || m4.completeSaleHeight > 52) fail("Complete Sale not in 46-52: " + m4.completeSaleHeight);
  
  for (const h of m4.cartItemHeights) {
    if (h > 100) fail("Cart item height > 100: " + h);
  }

  if (m4.visibleCartItems < 4) fail("Expected 4 items visible, got " + m4.visibleCartItems);
  if (m4.pageScrollHeight > m4.pageClientHeight + 1) fail("Page scrolled! " + m4.pageScrollHeight + " > " + m4.pageClientHeight);

  if (m5.cartScrollHeight <= m5.cartClientHeight) fail("Cart region did not scroll internally for 5 items");
  if (m5.pageScrollHeight > m5.pageClientHeight + 1) fail("Page scrolled for 5 items!");

  if (m10.cartScrollHeight <= m10.cartClientHeight) fail("Cart region did not scroll internally for 10 items");
  if (m10.pageScrollHeight > m10.pageClientHeight + 1) fail("Page scrolled for 10 items!");

  if (failed) {
    process.exit(1);
  } else {
    console.log("ALL MANDATORY GATES PASSED.");
  }
})();
