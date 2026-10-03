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
  console.log("5. PRODUCT IMAGE — INDEPENDENT SOURCE CHECK");
  
  const dbProduct = await prisma.product.findFirst({ where: { imageUrl: { not: null } } });
  const targetName = dbProduct.name;
  console.log("Target product:", targetName);
  
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  const products = await page.locator('button').filter({ has: page.locator('.aspect-square') }).all();
  if (products.length > 0) {
      await products[0].click({ force: true });
      await page.waitForTimeout(500);
  }
  
  const productCardImageUrl = await page.evaluate((name) => {
      const p = Array.from(document.querySelectorAll('p')).find(p => p.textContent === name);
      if (p) {
         const card = p.closest('button');
         const img = card.querySelector('img');
         return img ? new URL(img.src).pathname : "No image";
      }
      return "No product card";
  }, targetName);
  
  const cartItemImageUrl = await page.evaluate((name) => {
      const p = Array.from(document.querySelectorAll('p')).find(p => p.textContent === name);
      if (p) {
         const rightPanel = document.querySelector('.w-\\[380px\\], .w-96, .w-\\[360px\\]') || document.querySelector('.bg-slate-50\\/50').parentElement;
         const pCart = Array.from(rightPanel.querySelectorAll('p')).find(p => p.textContent === name);
         if (pCart) {
             const img = pCart.parentElement.parentElement.parentElement.querySelector('img');
             return img ? new URL(img.src).pathname : "No image in cart";
         }
      }
      return "No cart item";
  }, targetName);
  
  const dbImageUrl = dbProduct.imageUrl;
  
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
  
  console.log(`DB imageUrl == /pos image URL: ${dbImageUrl === extractUrl(productCardImageUrl)}`);
  console.log(`DB imageUrl == cart image URL: ${dbImageUrl === extractUrl(cartItemImageUrl)}`);
  console.log(`DB imageUrl == /products image URL: ${dbImageUrl === extractUrl(productsPageImageUrl)}`);

  console.log("\n==================================================");
  console.log("4. CUSTOMER PICKER FIX");
  await page.goto('http://localhost:3000/pos');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  const overlapAndTabs = await page.evaluate(() => {
    // Click "Add customer"
    const buttons = Array.from(document.querySelectorAll('button'));
    const addCustomer = buttons.find(b => b.textContent === 'Add' && b.closest('.bg-blue-50'));
    if (addCustomer) addCustomer.click();
    return new Promise(resolve => {
        setTimeout(() => {
            const customerTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Customer' && b.closest('.bg-white.shadow-sm'));
            const customerTabActive = customerTab && customerTab.classList.contains('text-blue-600');
            
            const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Cancel');
            if (cancelBtn) cancelBtn.click();
            
            setTimeout(() => {
               const cartTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Cart') && b.closest('.bg-white.shadow-sm'));
               const cancelReturnsToCart = cartTab && cartTab.classList.contains('text-blue-600');
               resolve({ customerTabActive, cancelReturnsToCart });
            }, 500);
        }, 500);
    });
  });
  console.log(`Customer tab active state: ${overlapAndTabs.customerTabActive}`);
  console.log(`Cancel returns to cart: ${overlapAndTabs.cancelReturnsToCart}`);
  
  await browser.close();
  await prisma.$disconnect();
})();
