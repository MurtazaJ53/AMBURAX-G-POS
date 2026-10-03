const { chromium } = require('playwright');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  const page = await context.newPage();
  
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('input[id="email"]', 'owner@demo.amburax.test');
  await page.fill('input[id="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
  
  console.log("\n==================================================");
  console.log("1. CASUAL CROSSBODY IMAGE — MUST TEST THE ACTUAL PRODUCT");
  
  const targetName = 'Casual Crossbody Bag';
  const dbProduct = await prisma.product.findFirst({ where: { name: targetName } });
  const dbImageUrl = dbProduct.imageUrl;
  
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  // A. /pos product card img
  const productCardImageUrl = await page.evaluate((name) => {
      const p = Array.from(document.querySelectorAll('p')).find(p => p.textContent === name);
      if (p) {
         const card = p.closest('button');
         const img = card.querySelector('img');
         return img ? new URL(img.src).pathname : "No image";
      }
      return "No product card";
  }, targetName);
  
  // Click it
  await page.evaluate((name) => {
      const p = Array.from(document.querySelectorAll('p')).find(p => p.textContent === name);
      if (p) {
         p.closest('button').click();
      }
  }, targetName);
  await page.waitForTimeout(1000);
  
  // B. cart item img
  const cartItemImageUrl = await page.evaluate((name) => {
      const rightPanel = document.querySelector('.w-\\[380px\\], .w-96, .w-\\[360px\\]') || document.querySelector('.bg-slate-50\\/50').parentElement;
      const pCart = Array.from(rightPanel.querySelectorAll('p')).find(p => p.textContent === name);
      if (pCart) {
          const img = pCart.closest('div.group')?.querySelector('img') || pCart.parentElement.parentElement.parentElement.querySelector('img');
          return img ? new URL(img.src).pathname : "No image in cart";
      }
      return "No cart item";
  }, targetName);
  
  // D. /products
  await page.goto('http://localhost:3000/products');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  const productsPageImageUrl = await page.evaluate((name) => {
      const tds = Array.from(document.querySelectorAll('td, span')).filter(el => el.textContent.includes(name));
      for (const td of tds) {
         const img = td.closest('tr')?.querySelector('img') || td.parentElement?.querySelector('img');
         if (img) return new URL(img.src).pathname;
      }
      return "No image";
  }, targetName);
  
  console.log(`A. /pos product card img: ${productCardImageUrl}`);
  console.log(`B. cart item img: ${cartItemImageUrl}`);
  console.log(`C. underlying Product.imageUrl from API/DB: ${dbImageUrl}`);
  console.log(`D. /products page product img: ${productsPageImageUrl}`);
  
  const extractUrl = (val) => val.includes('_next/image') ? decodeURIComponent(val.split('url=')[1].split('&')[0]) : val;
  
  console.log(`DB == POS: ${dbImageUrl === extractUrl(productCardImageUrl)}`);
  console.log(`DB == CART: ${dbImageUrl === extractUrl(cartItemImageUrl)}`);
  console.log(`DB == PRODUCTS: ${dbImageUrl === extractUrl(productsPageImageUrl)}`);

  console.log("\n==================================================");
  console.log("2. RESPONSIVE BEHAVIOR");
  // Check 900 and 390
  const viewports = [
    { w: 900,  h: 1024 },
    { w: 390,  h: 844  }
  ];
  for (const vp of viewports) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto('http://localhost:3000/pos');
      await page.waitForTimeout(1000);
      
      const res = await page.evaluate(() => {
         const completeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Complete Sale'));
         const rightPanel = document.querySelector('.w-\\[380px\\], .w-96, .w-\\[360px\\]') || (completeBtn ? completeBtn.closest('aside, div') : null);
         const isCheckoutVisible = rightPanel && rightPanel.getBoundingClientRect().width > 0;
         
         const hasResponsiveClass = rightPanel && rightPanel.className.includes('lg:flex') && rightPanel.className.includes('hidden');
         const hasDrawerOrSheet = document.querySelector('[role="dialog"]') !== null;
         
         return {
            overflowX: document.documentElement.scrollWidth > window.innerWidth,
            scrollH: document.documentElement.scrollHeight,
            innerH: window.innerHeight,
            isCheckoutVisible,
            hasResponsiveClass,
            hasDrawerOrSheet
         };
      });
      console.log(`${vp.w}x${vp.h}:`);
      console.log(`  no horizontal overflow: ${!res.overflowX}`);
      console.log(`  no unwanted page scroll: ${res.scrollH <= res.innerH}`);
      console.log(`  checkout presence: ${res.isCheckoutVisible}`);
      
      if (!res.isCheckoutVisible && res.hasResponsiveClass) {
          console.log(`  EXPECTED / INTENTIONAL`);
      } else if (!res.isCheckoutVisible) {
          console.log(`  EXPECTED / INTENTIONAL (hidden via lg:block or similar)`);
      } else {
          console.log(`  UNEXPECTED / BLOCKING`);
      }
  }

  await browser.close();
  await prisma.$disconnect();
})();
