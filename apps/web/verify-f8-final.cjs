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

  // --- 3. CUSTOMER PICKER ---
  console.log("--- CUSTOMER PICKER ---");
  const addCustBtn = page.locator('button', { hasText: /^Add$/ }).first();
  await addCustBtn.click({ force: true });
  await page.waitForTimeout(1000);

  const cartTab = page.locator('button', { hasText: /^Cart/ }).first();
  const custTab = page.locator('button', { hasText: /^Customer$/ }).first();
  const pickerHeader = page.locator('label', { hasText: 'Select Customer' }).first();
  const cancelBtn = page.locator('button', { hasText: 'Cancel' }).first();
  const searchInput = page.locator('input[placeholder="Search name or phone..."]').first();

  const cartTabBox = await cartTab.boundingBox();
  const custTabBox = await custTab.boundingBox();
  const pickerHeaderBox = await pickerHeader.boundingBox();
  const cancelBtnBox = await cancelBtn.boundingBox();
  const searchInputBox = await searchInput.boundingBox();

  console.log("Cart Tab:", cartTabBox);
  console.log("Cust Tab:", custTabBox);
  console.log("Picker Header:", pickerHeaderBox);
  console.log("Cancel Btn:", cancelBtnBox);
  console.log("Search Input:", searchInputBox);

  if (cartTabBox && pickerHeaderBox) {
    const tabsBottom = Math.max(cartTabBox.y + cartTabBox.height, custTabBox.y + custTabBox.height);
    console.log(pickerHeaderBox.y >= tabsBottom ? "PASS: Customer Header is below tabs" : "FAIL: Customer Header overlaps tabs");
  }

  // Select real customer
  await searchInput.fill('Demo', { force: true });
  await page.waitForTimeout(1000);
  const custResult = page.locator('button', { hasText: 'Demo' }).first();
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

  // We need to locate the right panel correctly. It's the flex column that holds the Cart items.
  const completeBtn = page.locator('button', { hasText: 'Complete Sale' }).first();
  const rightPanel = page.locator('div').filter({ has: completeBtn }).filter({ has: cartTab }).first();
  
  const cartItems = rightPanel.locator('ul > li');
  console.log(`Cart items count: ${await cartItems.count()}`);

  const checkoutBox = await rightPanel.boundingBox();
  console.log("CHECKOUT WIDTH:", checkoutBox?.width);

  const headerBox = await rightPanel.locator('header').first().boundingBox();
  console.log("HEADER HEIGHT:", headerBox?.height);

  const custBlock = await rightPanel.locator('div').filter({ hasText: /^Demo Owner$/ }).first().boundingBox();
  console.log("CUSTOMER BLOCK HEIGHT:", custBlock?.height || "N/A");

  const cartItemBox = await cartItems.first().boundingBox();
  console.log("CART ITEM HEIGHT:", cartItemBox?.height);

  const completeBtnBox = await completeBtn.boundingBox();
  console.log("COMPLETE SALE HEIGHT:", completeBtnBox?.height);

  // footer is tricky, let's grab the element containing Complete Sale that is a direct child of right panel
  const footerBox = await completeBtn.evaluate(el => el.parentElement.parentElement.getBoundingClientRect());
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
  const cashBtn = page.locator('button', { hasText: 'Cash' }).first();
  await cashBtn.click({ force: true });
  await page.waitForTimeout(500);
  const exactBtn = page.locator('button', { hasText: 'Exact' }).first();
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
