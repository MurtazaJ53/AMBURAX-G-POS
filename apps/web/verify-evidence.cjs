const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1.0 });
  const page = await context.newPage();
  const results = {};

  console.log("Navigating to login...");
  await page.goto('http://localhost:3000/auth/login');
  try {
    await page.waitForSelector('input[id="email"]', { timeout: 3000 });
    await page.fill('input[id="email"]', 'owner@demo.amburax.test');
    await page.fill('input[id="password"]', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 5000 });
  } catch (e) {
    console.log("Already logged in or login skipped.");
  }

  // IMAGE INTEGRITY: /products
  console.log("Navigating to /products...");
  await page.goto('http://localhost:3000/products');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  results.productsUrl = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('tr'));
    const bagTr = trs.find(tr => tr.textContent.includes('Casual Crossbody Bag'));
    if (!bagTr) return null;
    const img = bagTr.querySelector('img');
    return img ? img.src : null;
  });
  console.log("Products URL:", results.productsUrl);

  // Nav to /pos
  console.log("Navigating to /pos...");
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // IMAGE INTEGRITY: /pos product card
  results.posCardUrl = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const bagBtn = btns.find(b => b.textContent.includes('Casual Crossbody Bag'));
    if (!bagBtn) return null;
    const img = bagBtn.querySelector('img');
    return img ? img.src : null;
  });
  console.log("POS Card URL:", results.posCardUrl);

  // CUSTOMER PICKER & GEOMETRY
  console.log("Running Customer Picker interactions...");
  const pickerMetrics = await page.evaluate(async () => {
    const getRect = (el) => el ? JSON.parse(JSON.stringify(el.getBoundingClientRect())) : null;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const btns = Array.from(document.querySelectorAll('button'));
    const completeSale = btns.find(b => b.textContent.includes('Complete Sale'));
    const rightPanel = completeSale.closest('.flex.flex-col.h-full') || completeSale.parentElement.parentElement.parentElement;
    
    // Switch to Customer tab / Add
    const addBtn = Array.from(rightPanel.querySelectorAll('button')).find(b => b.textContent.trim() === 'Add');
    if(addBtn) addBtn.click();
    await sleep(500);

    const rBtns = Array.from(rightPanel.querySelectorAll('button'));
    const rLabels = Array.from(rightPanel.querySelectorAll('label'));
    const rInputs = Array.from(rightPanel.querySelectorAll('input'));

    const cartTab = rBtns.find(b => b.textContent.includes('Cart'));
    const custTab = rBtns.find(b => b.textContent.trim() === 'Customer');
    const pickerHeader = rLabels.find(l => l.textContent.includes('Select Customer'));
    const cancelBtn = rBtns.find(b => b.textContent.includes('Cancel'));
    const searchInput = rInputs.find(i => i.placeholder.includes('Search'));

    const metrics = {
      cartTabBox: getRect(cartTab),
      custTabBox: getRect(custTab),
      pickerHeaderBox: getRect(pickerHeader),
      cancelBtnBox: getRect(cancelBtn),
      searchInputBox: getRect(searchInput),
    };

    if(metrics.cartTabBox && metrics.pickerHeaderBox) {
      metrics.tabsBottom = Math.max(metrics.cartTabBox.bottom, metrics.custTabBox.bottom);
      metrics.pickerHeaderTop = metrics.pickerHeaderBox.top;
      metrics.overlap = metrics.pickerHeaderTop < metrics.tabsBottom;
    }

    // select demo customer
    if(searchInput) {
      // Simulate input event
      searchInput.value = 'Demo';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(1000);
      const demoBtn = Array.from(rightPanel.querySelectorAll('button')).find(b => b.textContent.includes('Demo'));
      if(demoBtn) demoBtn.click();
      await sleep(1000);
    }
    
    // Add 4 items
    const prodBtns = Array.from(document.querySelectorAll('button')).filter(b => b.querySelector('img'));
    if(prodBtns.length >= 4) {
      prodBtns[0].click(); await sleep(200);
      prodBtns[1].click(); await sleep(200);
      prodBtns[2].click(); await sleep(200);
      prodBtns[3].click(); await sleep(500);
    }

    // Geometry 4 items
    const cartItems = rightPanel.querySelectorAll('ul > li');
    metrics.cartItemCount = cartItems.length;
    metrics.checkoutPanelWidth = rightPanel.getBoundingClientRect().width;
    const header = rightPanel.querySelector('header');
    metrics.checkoutHeaderHeight = header ? getRect(header).height : null;
    const custBlock = Array.from(rightPanel.querySelectorAll('div')).find(d => d.textContent.includes('Demo Owner'));
    metrics.customerBlockHeight = custBlock ? getRect(custBlock).height : null;
    metrics.cartItemHeight = cartItems.length > 0 ? getRect(cartItems[0]).height : null;
    const ul = rightPanel.querySelector('ul');
    metrics.cartViewportHeight = ul ? getRect(ul).height : null;
    const footer = completeSale.parentElement;
    metrics.footerHeight = getRect(footer).height;
    metrics.completeSaleHeight = getRect(completeSale).height;
    metrics.docScrollHeight4 = document.documentElement.scrollHeight;
    metrics.winInnerHeight4 = window.innerHeight;

    // 5 Items
    if(prodBtns.length >= 5) {
      prodBtns[4].click(); await sleep(500);
    }
    metrics.cartScrollHeight5 = ul ? ul.scrollHeight : null;
    metrics.cartClientHeight5 = ul ? ul.clientHeight : null;
    metrics.docScrollHeight5 = document.documentElement.scrollHeight;

    // 10 Items
    for(let i=0; i<5; i++) { prodBtns[0].click(); await sleep(200); }
    metrics.cartScrollHeight10 = ul ? ul.scrollHeight : null;
    metrics.cartClientHeight10 = ul ? ul.clientHeight : null;
    metrics.docScrollHeight10 = document.documentElement.scrollHeight;

    // IMAGE INTEGRITY: /pos cart
    const bagLi = Array.from(cartItems).find(li => li.textContent.includes('Casual Crossbody Bag'));
    metrics.posCartUrl = bagLi && bagLi.querySelector('img') ? bagLi.querySelector('img').src : null;

    // Complete Transaction
    const cashBtn = Array.from(rightPanel.querySelectorAll('button')).find(b => b.textContent.includes('Cash'));
    if(cashBtn) cashBtn.click();
    await sleep(500);
    const exactBtn = Array.from(rightPanel.querySelectorAll('button')).find(b => b.textContent.includes('Exact'));
    if(exactBtn) exactBtn.click();
    await sleep(500);
    completeSale.click();
    await sleep(2000);

    metrics.cartItemsAfterSale = rightPanel.querySelectorAll('ul > li').length;

    return metrics;
  });

  results.metrics = pickerMetrics;
  console.log("Metrics collected:", JSON.stringify(results.metrics, null, 2));

  // Capture 1536
  await page.screenshot({ path: 'verify-1536.png' });
  
  // Responsive
  await page.setViewportSize({ width: 1280, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'verify-1280.png' });

  await page.setViewportSize({ width: 900, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'verify-900.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'verify-390.png' });

  fs.writeFileSync('verify-results.json', JSON.stringify(results, null, 2));
  await browser.close();
  console.log("Playwright complete.");
})();
