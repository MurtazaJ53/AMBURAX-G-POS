const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1706, height: 1137 }, deviceScaleFactor: 0.9 });
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

  // Wait for network/hydration
  await page.waitForLoadState('networkidle');
  console.log("Waiting for POS...");
  await page.waitForTimeout(4000);

  // 2. Open Customer Picker 
  const addButton = page.getByRole('button', { name: 'Add', exact: true }).first();
  await addButton.click({ force: true });
  await page.waitForTimeout(1000);

  // 3. Take 1536 screenshot
  await page.screenshot({ path: 'pos-picker-1536px.png' });
  console.log("Screenshot 1536 taken.");

  // 4. Dom Overlap Test
  const cartTab = page.getByRole('button', { name: /Cart/, exact: false });
  const custTab = page.getByRole('button', { name: 'Customer', exact: true }).first(); // The tab
  const pickerHeader = page.locator('label:has-text("Select Customer")');
  const cancelBtn = page.getByRole('button', { name: 'Cancel', exact: true });
  const searchInput = page.locator('input[placeholder="Search name or phone..."]');

  const cartTabBox = await cartTab.boundingBox();
  const custTabBox = await custTab.boundingBox();
  const pickerHeaderBox = await pickerHeader.boundingBox();
  const cancelBtnBox = await cancelBtn.boundingBox();
  const searchInputBox = await searchInput.boundingBox();

  console.log("--- BOUNDING BOXES ---");
  console.log("Cart Tab:", cartTabBox);
  console.log("Cust Tab:", custTabBox);
  console.log("Picker Header:", pickerHeaderBox);
  console.log("Cancel Btn:", cancelBtnBox);
  console.log("Search Input:", searchInputBox);

  // Verifications
  if (cartTabBox && custTabBox && pickerHeaderBox) {
    const tabsBottom = Math.max(cartTabBox.y + cartTabBox.height, custTabBox.y + custTabBox.height);
    console.log("Tabs Bottom:", tabsBottom);
    console.log("Picker Header Top:", pickerHeaderBox.y);
    if (pickerHeaderBox.y >= tabsBottom) {
      console.log("PASS: Picker Header is BELOW tabs");
    } else {
      console.log("FAIL: Picker Header OVERLAPS tabs");
    }
  }

  if (pickerHeaderBox && cancelBtnBox && searchInputBox) {
    const headerBottom = Math.max(pickerHeaderBox.y + pickerHeaderBox.height, cancelBtnBox.y + cancelBtnBox.height);
    console.log("Header Bottom:", headerBottom);
    console.log("Search Input Top:", searchInputBox.y);
    if (searchInputBox.y >= headerBottom) {
      console.log("PASS: Search Input is BELOW Picker Header");
    } else {
      console.log("FAIL: Search Input OVERLAPS Picker Header");
    }
  }

  // 5. Tab State
  const cartTabClass = await cartTab.getAttribute('class');
  const custTabClass = await custTab.getAttribute('class');
  console.log("Cart Tab Class:", cartTabClass);
  console.log("Cust Tab Class:", custTabClass);

  // 6. Scroll Height
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const bodyScrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const innerHeight = await page.evaluate(() => window.innerHeight);
  console.log(`Scroll: doc=${scrollHeight}, body=${bodyScrollHeight}, inner=${innerHeight}`);

  // 7. Test interaction
  await searchInput.fill('John', { force: true });
  await page.waitForTimeout(1000);
  const results = page.locator('button', { hasText: 'John' });
  const resultCount = await results.count();
  console.log(`Search Results for 'John': ${resultCount}`);

  if (resultCount > 0) {
      await results.first().click({ force: true });
      await page.waitForTimeout(500);
      const isPickerGone = await searchInput.isVisible() === false;
      console.log(`Picker closed after selection: ${isPickerGone}`);
  } else {
      console.log("No mock/real customers found for 'John', checking Cancel instead");
      await cancelBtn.click({ force: true });
      await page.waitForTimeout(500);
      const isPickerGone = await searchInput.isVisible() === false;
      console.log(`Picker closed after cancel: ${isPickerGone}`);
  }

  // Re-open picker for more screenshots
  const newAddButton = page.locator('button:has-text("Add"), button:has-text("Change")').first();
  await newAddButton.click({ force: true });
  await page.waitForTimeout(500);

  // Screenshots at other resolutions
  await page.setViewportSize({ width: Math.round(1280/0.9), height: Math.round(1024/0.9) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'pos-picker-1280px.png' });

  await page.setViewportSize({ width: Math.round(900/0.9), height: Math.round(1024/0.9) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'pos-picker-900px.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'pos-picker-390px.png' });

  await browser.close();
})();
