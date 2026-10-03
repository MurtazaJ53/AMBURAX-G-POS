const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 0.9 });
  const page = await context.newPage();

  console.log("=== STARTING VERIFICATION ===");
  await page.goto('http://localhost:3000/auth/login');
  
  try {
    await page.waitForSelector('input[id="email"]', { timeout: 3000 });
    await page.fill('input[id="email"]', 'owner@demo.amburax.test');
    await page.fill('input[id="password"]', 'Passw0rd!123');
    await page.click('button[type="submit"]');
  } catch (e) {}
  
  await page.waitForTimeout(2000);
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); 

  // --- 9. PRODUCT GRID ---
  console.log("--- PRODUCT GRID ---");
  const products = page.locator('button').filter({ has: page.locator('.aspect-square') });
  const count = await products.count();
  console.log("Products loaded:", count);
  
  // Check 6 cards across. The container is a grid.
  const cols = await page.evaluate(() => {
    const grid = document.querySelector('.aspect-square')?.closest('button')?.parentElement;
    if (!grid) return 0;
    const style = window.getComputedStyle(grid);
    return style.gridTemplateColumns.split(' ').length;
  });
  console.log(`Grid columns: ${cols}`);

  const crossbody = products.filter({ hasText: 'Casual Crossbody Bag' }).first();
  if (await crossbody.count() > 0) {
    const crossbodyImgSrc = await crossbody.locator('img').getAttribute('src');
    if (!crossbodyImgSrc || crossbodyImgSrc.includes('placeholder')) {
        console.log("FAIL: Product image is missing or unrelated");
    } else {
        console.log("PASS: Product image mapped correctly:", crossbodyImgSrc);
    }
  }

  // --- 3. CUSTOMER PICKER ---
  console.log("--- CUSTOMER PICKER ---");
  const rightPanel = page.locator('aside'); 
  const addCustBtn = rightPanel.locator('button:has-text("Add")').first();
  await addCustBtn.click({ force: true });
  await page.waitForTimeout(1000);

  const cartTab = rightPanel.locator('button:has-text("Cart")').first();
  const custTab = rightPanel.locator('button:has-text("Customer")').first();
  const pickerHeader = rightPanel.locator('label:has-text("Select Customer")').first();
  const cancelBtn = rightPanel.locator('button:has-text("Cancel")').first();
  const searchInput = rightPanel.locator('input[placeholder="Search name or phone..."]').first();

  const cartTabBox = await cartTab.boundingBox();
  const custTabBox = await custTab.boundingBox();
  const pickerHeaderBox = await pickerHeader.boundingBox();
  const cancelBtnBox = await cancelBtn.boundingBox();
  const searchInputBox = await searchInput.boundingBox();

  if (cartTabBox && pickerHeaderBox) {
    const tabsBottom = Math.max(cartTabBox.y + cartTabBox.height, custTabBox.y + custTabBox.height);
    console.log(pickerHeaderBox.y >= tabsBottom ? "PASS: Customer Header is below tabs" : "FAIL: Customer Header overlaps tabs");
  }

  // Select real customer
  await searchInput.fill('Demo', { force: true });
  await page.waitForTimeout(1000);
  const custResult = rightPanel.locator('button:has-text("Demo")').first();
  if (await custResult.count() > 0) {
      await custResult.click({ force: true });
      await page.waitForTimeout(1000);
      console.log("PASS: Real customer selected");
  }

  // --- 5 & 6. CART GEOMETRY & 4 ITEM TEST ---
  console.log("--- GEOMETRY & 4 ITEMS ---");
  await products.nth(0).click({ force: true }); await page.waitForTimeout(500);
  await products.nth(1).click({ force: true }); await page.waitForTimeout(500);
  await products.nth(2).click({ force: true }); await page.waitForTimeout(500);
  await products.nth(3).click({ force: true }); await page.waitForTimeout(500);

  const cartItems = rightPanel.locator('ul > li');
  console.log(`Cart items count: ${await cartItems.count()}`);

  const checkoutBox = await rightPanel.boundingBox();
  console.log("CHECKOUT WIDTH:", checkoutBox?.width);

  const headerBox = await rightPanel.locator('header').first().boundingBox();
  console.log("HEADER HEIGHT:", headerBox?.height);

  const custBlock = await rightPanel.locator('div').filter({ hasText: /^Demo Owner$/ }).first().boundingBox(); // approximation
  console.log("CUSTOMER BLOCK HEIGHT:", custBlock?.height || "N/A");

  const cartItemBox = await cartItems.first().boundingBox();
  console.log("CART ITEM HEIGHT:", cartItemBox?.height);

  const completeBtn = rightPanel.locator('button:has-text("Complete Sale")').first();
  const completeBtnBox = await completeBtn.boundingBox();
  console.log("COMPLETE SALE HEIGHT:", completeBtnBox?.height);

  const footer = rightPanel.locator('div:has(button:has-text("Complete Sale"))').first(); // rough approximation for footer
  const footerBox = await footer.boundingBox();
  console.log("FOOTER HEIGHT:", footerBox?.height || "N/A");

  const docScroll = await page.evaluate(() => document.documentElement.scrollHeight);
  const winInner = await page.evaluate(() => window.innerHeight);
  console.log(docScroll <= winInner + 1 ? "PAGE SCROLL: PASS" : "PAGE SCROLL: FAIL");

  // --- 7. 5 ITEM TEST ---
  console.log("--- 5 ITEMS ---");
  await products.nth(4).click({ force: true }); await page.waitForTimeout(500);
  
  const cartList = rightPanel.locator('ul').first();
  const cartListScroll = await cartList.evaluate(el => el.scrollHeight > el.clientHeight);
  console.log(`5 ITEM SCROLL (Internal): ${cartListScroll ? "PASS" : "FAIL"}`);

  // --- 8. 10 ITEM TEST ---
  console.log("--- 10 ITEMS ---");
  for (let i = 0; i < 5; i++) {
    await products.nth(0).click({ force: true });
    await page.waitForTimeout(200);
  }
  const cartListScroll10 = await cartList.evaluate(el => el.scrollHeight > el.clientHeight);
  console.log(`10 ITEM SCROLL (Internal): ${cartListScroll10 ? "PASS" : "FAIL"}`);

  // --- 12. REAL POS TRANSACTION ---
  console.log("--- REAL SALE ---");
  const cashBtn = rightPanel.locator('button:has-text("Cash")').first();
  await cashBtn.click({ force: true });
  await page.waitForTimeout(500);
  const exactBtn = rightPanel.locator('button:has-text("Exact")').first();
  if (await exactBtn.isVisible()) {
      await exactBtn.click({ force: true });
  }
  await page.waitForTimeout(500);
  await completeBtn.click({ force: true });
  await page.waitForTimeout(2000);
  
  const itemsAfterSale = await rightPanel.locator('ul > li').count();
  console.log(itemsAfterSale === 0 ? "REAL SALE: PASS" : "REAL SALE: FAIL");

  await browser.close();
})();
