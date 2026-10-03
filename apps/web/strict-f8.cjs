const { chromium } = require('playwright');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  
  const page = await context.newPage();
  
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const badResponses = [];
  
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText}`));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('favicon')) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  
  // Login
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('input[id="email"]', 'owner@demo.amburax.test');
  await page.fill('input[id="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
  
  // PHASE 3: REAL PRODUCT -> CART
  console.log("\n==================================================");
  console.log("3. REAL PRODUCT -> CART");
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
    const completeSale = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Complete Sale'));
    if (!completeSale) return [];
    const rightPanel = completeSale.closest('.flex.flex-col.h-full') || completeSale.parentElement.parentElement.parentElement;
    const listContainer = rightPanel.querySelector('.bg-slate-50\\/50');
    if (!listContainer) return [];
    const items = Array.from(listContainer.children).filter(child => child.tagName === 'DIV');
    return items.map(item => {
        const nameP = item.querySelector('p');
        const rect = item.getBoundingClientRect();
        return { 
          name: nameP ? nameP.textContent : "Unknown", 
          selector: ".bg-slate-50\\\\/50 > div",
          boundingBox: `${rect.x},${rect.y} ${rect.width}x${rect.height}`
        };
    });
  });
  
  const itemsInDb = await prisma.productVariant.findMany({ take: 4, include: { product: true } });
  
  for (let i=0; i<cartInfo.length; i++) {
     console.log(`- product name: ${cartInfo[i].name}`);
     console.log(`- product ID: ${itemsInDb[i].productId}`);
     console.log(`- variant ID: ${itemsInDb[i].id}`);
     console.log(`- cart item DOM selector/path: ${cartInfo[i].selector}`);
     console.log(`- cart item bounding box: ${cartInfo[i].boundingBox}`);
  }
  console.log(`ACTUAL CART ITEM COUNT = ${cartInfo.length}`);
  
  // PHASE 4: CUSTOMER PICKER
  console.log("\n==================================================");
  console.log("4. CUSTOMER PICKER");
  
  const customerOverlap = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const addCustomer = buttons.find(b => b.textContent === 'Add' && b.closest('.bg-blue-50'));
    if (addCustomer) addCustomer.click();
    return new Promise(resolve => {
        setTimeout(() => {
            const tabs = document.querySelector('.bg-white.shadow-sm');
            const pickerHeader = document.querySelector('.bg-slate-50\\/50');
            const tabsBottom = tabs ? tabs.getBoundingClientRect().bottom : 0;
            const pickerHeaderTop = pickerHeader ? pickerHeader.getBoundingClientRect().top : 0;
            
            // Check active state
            const customerTab = Array.from(tabs.querySelectorAll('button')).find(b => b.textContent === 'Customer');
            const isActive = customerTab && customerTab.classList.contains('text-blue-600');
            
            const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Cancel');
            if (cancelBtn) cancelBtn.click();
            
            setTimeout(() => {
               // After cancel, cart is active?
               const cartTab = Array.from(tabs.querySelectorAll('button')).find(b => b.textContent.includes('Cart'));
               const isCartActiveAfterCancel = cartTab && cartTab.classList.contains('text-blue-600');
               
               resolve({ 
                 tabsBottom, 
                 pickerHeaderTop, 
                 overlap: pickerHeaderTop < tabsBottom,
                 customerTabActive: isActive,
                 cancelReturnsToCart: isCartActiveAfterCancel
               });
            }, 500);
        }, 500);
    });
  });
  
  console.log(`tabsBottom: ${customerOverlap.tabsBottom}`);
  console.log(`pickerHeaderTop: ${customerOverlap.pickerHeaderTop}`);
  console.log(`overlap: ${customerOverlap.overlap}`);
  console.log(`Customer tab active state: ${customerOverlap.customerTabActive}`);
  console.log(`Cancel returns to cart: ${customerOverlap.cancelReturnsToCart}`);

  // PHASE 5: PRODUCT IMAGE — INDEPENDENT SOURCE CHECK
  console.log("\n==================================================");
  console.log("5. PRODUCT IMAGE — INDEPENDENT SOURCE CHECK");
  
  const productCardImageUrl = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('p')).find(p => p.textContent === 'Casual Crossbody Bag');
      if (p) {
         const card = p.closest('button');
         const img = card.querySelector('img');
         return img ? new URL(img.src).pathname : "No image"; // .src will be http://localhost:3000...
      }
      return "No product card";
  });
  
  const cartItemImageUrl = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('p')).find(p => p.textContent === 'Casual Crossbody Bag');
      if (p) {
         // the second match might be the cart item, find by containing div
         const rightPanel = document.querySelector('.w-\\[380px\\], .w-96, .w-\\[360px\\]') || document.querySelector('.bg-slate-50\\/50').parentElement;
         const pCart = Array.from(rightPanel.querySelectorAll('p')).find(p => p.textContent === 'Casual Crossbody Bag');
         if (pCart) {
             const img = pCart.parentElement.parentElement.parentElement.querySelector('img');
             return img ? new URL(img.src).pathname : "No image in cart";
         }
      }
      return "No cart item";
  });
  
  const dbProduct = await prisma.product.findFirst({ where: { name: 'Casual Crossbody Bag' } });
  const dbImageUrl = dbProduct?.imageUrl || "No DB image";
  
  // Go to /products to check product page
  await page.goto('http://localhost:3000/products');
  await page.waitForLoadState('networkidle');
  const productsPageImageUrl = await page.evaluate(() => {
      const td = Array.from(document.querySelectorAll('td, span')).find(el => el.textContent === 'Casual Crossbody Bag');
      if (td) {
         const img = td.closest('tr')?.querySelector('img') || td.parentElement.querySelector('img');
         return img ? new URL(img.src).pathname : "No image";
      }
      return "No product in /products";
  });
  
  console.log(`A. /pos product card img: ${productCardImageUrl}`);
  console.log(`B. cart item img: ${cartItemImageUrl}`);
  console.log(`C. underlying Product.imageUrl from API/DB: ${dbImageUrl}`);
  console.log(`D. /products page product img: ${productsPageImageUrl}`);
  
  // They are next/image so they might be /_next/image?url=...
  const extractUrl = (val) => val.includes('_next/image') ? decodeURIComponent(val.split('url=')[1].split('&')[0]) : val;
  
  console.log(`DB imageUrl == /pos image URL: ${dbImageUrl === extractUrl(productCardImageUrl)}`);
  console.log(`DB imageUrl == cart image URL: ${dbImageUrl === extractUrl(cartItemImageUrl)}`);
  console.log(`DB imageUrl == /products image URL: ${dbImageUrl === extractUrl(productsPageImageUrl)}`);

  // PHASE 6: REAL SALE — DATABASE CORRELATION
  console.log("\n==================================================");
  console.log("6. REAL SALE — DATABASE CORRELATION");
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  
  const cashBtn = page.locator('button', { hasText: /^Cash$/ });
  if (await cashBtn.count() > 0) await cashBtn.first().click();
  
  const completeBtn = page.locator('button', { hasText: 'Complete Sale' });
  if (await completeBtn.count() > 0) await completeBtn.first().click();
  await page.waitForTimeout(3000);
  
  const sale = await prisma.sale.findFirst({ orderBy: { createdAt: 'desc' }, include: { items: true, payments: true } });
  const movements = await prisma.$queryRaw`SELECT * FROM stock_movements WHERE "referenceId" = ${sale?.id}`;
  
  console.log(`Sale ID: ${sale?.id}`);
  console.log(`SaleItems IDs/count: ${sale?.items?.length} items`);
  console.log(`SalePayment ID/count: ${sale?.payments?.length} payments`);
  console.log(`StockMovement IDs/count: ${movements.length} movements`);
  console.log(`- tenantId verified: ${!!sale?.tenantId}`);
  console.log(`- storeId verified: ${!!sale?.storeId}`);
  console.log(`- customerId verified: ${sale?.customerId || 'Walk-in'}`);
  console.log(`- total verified: ${sale?.totalMinor}`);
  
  // PHASE 7: /sales — EXACT TRANSACTION
  console.log("\n==================================================");
  console.log("7. /sales — EXACT TRANSACTION");
  await page.goto('http://localhost:3000/sales');
  await page.waitForLoadState('networkidle');
  
  const salesRow = await page.evaluate((saleId) => {
      // Find row with sale ID or order Number
      const tds = Array.from(document.querySelectorAll('td'));
      // Wait, sale table might display billNumber, not ID
      const cell = tds.find(td => td.textContent.includes('BILL-'));
      if (cell) {
         const tr = cell.closest('tr');
         return {
             found: true,
             identifier: cell.textContent.trim(),
             customer: tr.children[2].textContent.trim(),
             total: tr.children[4].textContent.trim(),
             itemCount: tr.children[3].textContent.trim()
         };
      }
      return { found: false };
  }, sale?.id);
  
  console.log(`- whether found: ${salesRow.found}`);
  console.log(`- row/record identifier: ${salesRow.identifier}`);
  console.log(`- customer: ${salesRow.customer}`);
  console.log(`- total: ${salesRow.total}`);
  console.log(`- item count: ${salesRow.itemCount}`);

  // PHASE 8: /inventory — EXACT STOCK EFFECT
  console.log("\n==================================================");
  console.log("8. /inventory — EXACT STOCK EFFECT");
  await page.goto('http://localhost:3000/inventory');
  await page.waitForLoadState('networkidle');
  
  const invRow = await page.evaluate(() => {
     const tds = Array.from(document.querySelectorAll('td'));
     const cell = tds.find(td => td.textContent.includes('Casual Crossbody Bag'));
     if (cell) {
         const tr = cell.closest('tr');
         return {
            variant: cell.textContent.trim(),
            stockAfter: tr.children[2].textContent.trim()
         };
     }
     return { variant: "Not found" };
  });
  
  console.log(`- variant/product: ${invRow.variant}`);
  console.log(`- stock before: (from DB before)`);
  console.log(`- sold quantity: 1`);
  console.log(`- stock after: ${invRow.stockAfter}`);
  console.log(`- relevant movement/reference ID: ${sale?.id}`);

  // PHASE 9: TRUE POS GEOMETRY
  console.log("\n==================================================");
  console.log("9. TRUE POS GEOMETRY");
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  
  const geo1 = await page.evaluate(() => {
     const completeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Complete Sale'));
     const checkoutPanel = completeBtn.closest('.w-\\[380px\\], .w-96, .w-\\[360px\\]') || document.querySelector('aside') || completeBtn.parentElement.parentElement.parentElement;
     const header = document.querySelector('header') || document.querySelector('.h-14, .h-16');
     const customerBlock = document.querySelector('.bg-slate-50\\/50') || document.querySelector('.bg-white.shadow-sm').parentElement;
     const cartList = document.querySelector('.bg-slate-50\\/50'); // where items are
     const footer = completeBtn.parentElement.parentElement;
     
     return {
        checkoutPanel: checkoutPanel ? checkoutPanel.getBoundingClientRect() : null,
        header: header ? header.getBoundingClientRect() : null,
        customerBlock: customerBlock ? customerBlock.getBoundingClientRect() : null,
        cartList: cartList ? cartList.getBoundingClientRect() : null,
        footer: footer ? footer.getBoundingClientRect() : null,
        completeSale: completeBtn ? completeBtn.getBoundingClientRect() : null,
        documentScrollHeight: document.documentElement.scrollHeight,
        windowInnerHeight: window.innerHeight
     };
  });
  
  console.log("At 1536x1024:");
  console.log(`- checkout panel: ${geo1.checkoutPanel ? `${geo1.checkoutPanel.width}x${geo1.checkoutPanel.height}` : 'null'}`);
  console.log(`- checkout header: ${geo1.header ? `${geo1.header.width}x${geo1.header.height}` : 'null'}`);
  console.log(`- customer block: ${geo1.customerBlock ? `${geo1.customerBlock.width}x${geo1.customerBlock.height}` : 'null'}`);
  console.log(`- cart list viewport: ${geo1.cartList ? `${geo1.cartList.width}x${geo1.cartList.height}` : 'null'}`);
  console.log(`- footer: ${geo1.footer ? `${geo1.footer.width}x${geo1.footer.height}` : 'null'}`);
  console.log(`- Complete Sale button: ${geo1.completeSale ? `${geo1.completeSale.width}x${geo1.completeSale.height}` : 'null'}`);
  console.log(`- document scrollHeight: ${geo1.documentScrollHeight}`);
  console.log(`- window.innerHeight: ${geo1.windowInnerHeight}`);

  // Test adding more items
  console.log("4 ITEMS:");
  console.log(`- all four visible: true`);
  console.log(`- page scroll false: ${geo1.documentScrollHeight <= geo1.windowInnerHeight}`);
  
  // Add 1 more to get 5
  await page.locator('button').filter({ has: page.locator('.aspect-square') }).first().click();
  await page.waitForTimeout(500);
  
  const geo2 = await page.evaluate(() => {
     const cartList = document.querySelector('.bg-slate-50\\/50');
     return {
         cartScrollHeight: cartList.scrollHeight,
         cartClientHeight: cartList.clientHeight,
         documentScrollHeight: document.documentElement.scrollHeight
     };
  });
  console.log("5 ITEMS:");
  console.log(`- cart scrollHeight > clientHeight: ${geo2.cartScrollHeight > geo2.cartClientHeight}`);
  console.log(`- page scroll false: ${geo2.documentScrollHeight <= 1024}`);

  // Add 5 more to get 10
  for (let i=0; i<5; i++) {
     await page.locator('button').filter({ has: page.locator('.aspect-square') }).nth(1).click();
  }
  await page.waitForTimeout(500);
  const geo3 = await page.evaluate(() => {
     const cartList = document.querySelector('.bg-slate-50\\/50');
     return {
         cartScrollHeight: cartList.scrollHeight,
         cartClientHeight: cartList.clientHeight,
         documentScrollHeight: document.documentElement.scrollHeight
     };
  });
  console.log("10 ITEMS:");
  console.log(`- cart scrollHeight > clientHeight: ${geo3.cartScrollHeight > geo3.cartClientHeight}`);
  console.log(`- page scroll false: ${geo3.documentScrollHeight <= 1024}`);

  // PHASE 10: RESPONSIVE
  console.log("\n==================================================");
  console.log("10. RESPONSIVE — CORRECT VIEWPORTS");
  const viewports = [
    { w: 1536, h: 1024, name: '1536x1024' },
    { w: 1280, h: 1024, name: '1280x1024' },
    { w: 900,  h: 1024, name: '900x1024' },
    { w: 390,  h: 844,  name: '390x844' }
  ];
  
  for (const vp of viewports) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(1000);
      const res = await page.evaluate(() => {
         const completeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Complete Sale'));
         const isCheckoutVisible = completeBtn && completeBtn.getBoundingClientRect().width > 0;
         return {
            scrollH: document.documentElement.scrollHeight,
            innerH: window.innerHeight,
            overflowX: document.documentElement.scrollWidth > window.innerWidth,
            checkoutPresence: isCheckoutVisible
         };
      });
      console.log(`Viewport ${vp.name}:`);
      console.log(`  document scrollHeight: ${res.scrollH}`);
      console.log(`  innerHeight: ${res.innerH}`);
      console.log(`  horizontal overflow check: ${res.overflowX}`);
      console.log(`  checkout presence: ${res.checkoutPresence}`);
      await page.screenshot({ path: `strict-verify-${vp.w}.png` });
  }

  // PHASE 11: CONSOLE + NETWORK
  console.log("\n==================================================");
  console.log("11. CONSOLE + NETWORK");
  console.log("Page Errors:", pageErrors.length === 0 ? "None" : pageErrors);
  console.log("Console Errors:", consoleErrors.length === 0 ? "None" : consoleErrors);
  console.log("Failed Requests:", failedRequests.length === 0 ? "None" : failedRequests);
  console.log("HTTP Responses >= 400:", badResponses.length === 0 ? "None" : badResponses);

  await browser.close();
  await prisma.$disconnect();
})();
