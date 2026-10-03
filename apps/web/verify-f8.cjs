const { chromium } = require('playwright');
const fs = require('fs');

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
  } catch (e) {
    console.log("Already logged in.");
  }
  
  await page.waitForTimeout(2000);
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); // allow product grid to load

  // --- 9. PRODUCT GRID ---
  console.log("--- PRODUCT GRID ---");
  const products = page.locator('article');
  const count = await products.count();
  console.log("Products loaded:", count);
  
  // Check 6 cards across. The container is a grid.
  const gridContainer = page.locator('main > div > div').nth(2); // approximate, let's just evaluate
  const cols = await page.evaluate(() => {
    const grid = document.querySelector('article')?.parentElement;
    if (!grid) return 0;
    const style = window.getComputedStyle(grid);
    return style.gridTemplateColumns.split(' ').length;
  });
  console.log(`Grid columns: ${cols}`);

  // Check Casual Crossbody Bag image
  const crossbody = page.locator('article', { hasText: 'Casual Crossbody Bag' }).first();
  let crossbodyImgSrc = null;
  if (await crossbody.count() > 0) {
    crossbodyImgSrc = await crossbody.locator('img').getAttribute('src');
    console.log("Casual Crossbody Bag image src:", crossbodyImgSrc);
    if (!crossbodyImgSrc || crossbodyImgSrc.includes('placeholder')) {
        console.log("FAIL: Product image is missing or unrelated");
    } else {
        console.log("PASS: Product image mapped correctly");
    }
  }

  // Categories/Search check
  const searchVisible = await page.locator('input[placeholder*="Search"]').count() > 0;
  console.log("Search visible:", searchVisible);

  // --- 3. CUSTOMER PICKER ---
  console.log("--- CUSTOMER PICKER ---");
  // Find the Customer Add button (it's in the right panel, has text "Add")
  // Instead of text which failed, let's find the customer panel by "Customer" heading, then the button.
  const rightPanel = page.locator('aside'); 
  const addCustBtn = rightPanel.locator('button', { hasText: /^Add$/ }).first();
  await addCustBtn.click({ force: true });
  await page.waitForTimeout(1000);

  const cartTab = rightPanel.locator('button', { hasText: /Cart/ }).first();
  const custTab = rightPanel.locator('button', { hasText: 'Customer' }).first();
  const pickerHeader = rightPanel.locator('label', { hasText: 'Select Customer' }).first();
  const cancelBtn = rightPanel.locator('button', { hasText: 'Cancel' }).first();
  const searchInput = rightPanel.locator('input[placeholder="Search name or phone..."]').first();

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
    console.log("Tabs Bottom:", tabsBottom, "Picker Header Top:", pickerHeaderBox.y);
    console.log(pickerHeaderBox.y >= tabsBottom ? "PASS: Customer Header is below tabs" : "FAIL: Customer Header overlaps tabs");
  }

  // Select real customer
  await searchInput.fill('Demo', { force: true });
  await page.waitForTimeout(1000);
  const custResult = rightPanel.locator('button', { hasText: 'Demo' }).first();
  if (await custResult.count() > 0) {
      await custResult.click({ force: true });
      await page.waitForTimeout(1000);
      console.log("PASS: Real customer selected");
  } else {
      console.log("FAIL: Customer search failed");
      await cancelBtn.click({ force: true });
  }

  // --- 5 & 6. CART GEOMETRY & 4 ITEM TEST ---
  console.log("--- GEOMETRY & 4 ITEMS ---");
  const firstProd = products.nth(0);
  const secondProd = products.nth(1);
  const thirdProd = products.nth(2);
  const fourthProd = products.nth(3);

  await firstProd.click({ force: true }); await page.waitForTimeout(500);
  await secondProd.click({ force: true }); await page.waitForTimeout(500);
  await thirdProd.click({ force: true }); await page.waitForTimeout(500);
  await fourthProd.click({ force: true }); await page.waitForTimeout(500);

  const cartItems = rightPanel.locator('ul > li');
  console.log(`Cart items count: ${await cartItems.count()}`);

  const checkoutBox = await rightPanel.boundingBox();
  console.log("CHECKOUT WIDTH:", checkoutBox?.width);

  // The header contains the cart/customer tabs
  const headerBox = await rightPanel.locator('header').first().boundingBox();
  console.log("HEADER HEIGHT:", headerBox?.height);

  const cartItemBox = await cartItems.first().boundingBox();
  console.log("CART ITEM HEIGHT:", cartItemBox?.height);

  const completeBtn = rightPanel.locator('button', { hasText: 'Complete Sale' }).first();
  const completeBtnBox = await completeBtn.boundingBox();
  console.log("COMPLETE SALE HEIGHT:", completeBtnBox?.height);

  const docScroll = await page.evaluate(() => document.documentElement.scrollHeight);
  const winInner = await page.evaluate(() => window.innerHeight);
  console.log(`Page scrollHeight: ${docScroll}, innerHeight: ${winInner}`);
  console.log(docScroll <= winInner + 1 ? "PAGE SCROLL: PASS" : "PAGE SCROLL: FAIL");

  // --- 7. 5 ITEM TEST ---
  console.log("--- 5 ITEMS ---");
  await products.nth(4).click({ force: true }); await page.waitForTimeout(500);
  
  // Cart internal scroll check
  const cartList = rightPanel.locator('ul').first();
  const cartListScroll = await cartList.evaluate(el => el.scrollHeight > el.clientHeight);
  console.log(`5 ITEM SCROLL (Internal): ${cartListScroll ? "PASS" : "FAIL"}`);
  
  const docScroll5 = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(docScroll5 <= winInner + 1 ? "PAGE SCROLL (5): PASS" : "PAGE SCROLL (5): FAIL");

  // --- 8. 10 ITEM TEST ---
  console.log("--- 10 ITEMS ---");
  for (let i = 0; i < 5; i++) {
    await products.nth(0).click({ force: true });
    await page.waitForTimeout(200);
  }
  const cartListScroll10 = await cartList.evaluate(el => el.scrollHeight > el.clientHeight);
  console.log(`10 ITEM SCROLL (Internal): ${cartListScroll10 ? "PASS" : "FAIL"}`);
  
  const docScroll10 = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(docScroll10 <= winInner + 1 ? "PAGE SCROLL (10): PASS" : "PAGE SCROLL (10): FAIL");

  // --- 12. REAL POS TRANSACTION ---
  console.log("--- REAL SALE ---");
  // Pay with cash
  const cashBtn = rightPanel.locator('button', { hasText: 'Cash' }).first();
  await cashBtn.click({ force: true });
  await page.waitForTimeout(500);
  const exactBtn = rightPanel.locator('button', { hasText: 'Exact' }).first();
  if (await exactBtn.isVisible()) {
      await exactBtn.click({ force: true });
  }
  await page.waitForTimeout(500);
  await completeBtn.click({ force: true });
  await page.waitForTimeout(2000);
  
  // Check if cart is empty indicating successful sale
  const itemsAfterSale = await rightPanel.locator('ul > li').count();
  console.log(`Items in cart after sale: ${itemsAfterSale}`);
  console.log(itemsAfterSale === 0 ? "REAL SALE: PASS" : "REAL SALE: FAIL");

  // --- 14. SCREENSHOTS ---
  console.log("Taking screenshots...");
  await page.setViewportSize({ width: Math.round(1536/0.9), height: Math.round(1024/0.9) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'pos-1536px-verify.png' });

  await page.setViewportSize({ width: Math.round(1280/0.9), height: Math.round(1024/0.9) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'pos-1280px-verify.png' });

  await page.setViewportSize({ width: Math.round(900/0.9), height: Math.round(1024/0.9) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'pos-900px-verify.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'pos-390px-verify.png' });
  console.log("Screenshots done.");

  await browser.close();
})();
