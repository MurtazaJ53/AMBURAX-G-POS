const { chromium } = require('playwright');
const fs = require('fs');

async function capture() {
  const browser = await chromium.launch({ headless: true });
  
  // Login first
  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  await loginPage.goto('http://localhost:3000/auth/login');
  try {
    await loginPage.waitForSelector('input[id="email"]', { timeout: 3000 });
    await loginPage.fill('input[id="email"]', 'owner@demo.amburax.test');
    await loginPage.fill('input[id="password"]', 'Passw0rd!123');
    await loginPage.click('button[type="submit"]');
    await loginPage.waitForURL('**/dashboard', { timeout: 5000 }).catch(()=>null);
  } catch (e) {
    console.log("Login not needed or failed");
  }
  const cookies = await loginContext.cookies();
  await loginContext.close();
  
  const sizes = [
    { w: 1536, h: 1024, name: '1536px' },
    { w: 1280, h: 1024, name: '1280px' },
    { w: 900, h: 1024, name: '900px' },
    { w: 390, h: 844, name: '390px' },
  ];

  for (const size of sizes) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h } });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    
    await page.goto('http://localhost:3000/pos');
    await page.waitForLoadState('networkidle');
    
    // Add 3 items
    const products = await page.$$('button:has-text("₹")');
    if (products.length > 0) {
      await products[0].click();
      if (products.length > 1) await products[1].click();
      if (products.length > 2) await products[2].click();
    }
    
    await page.waitForTimeout(500); // let UI settle
    await page.screenshot({ path: `pos-final-${size.name}.png` });
    console.log(`Saved pos-final-${size.name}.png`);
    await ctx.close();
  }

  // Also test ngrok
  console.log("Testing Ngrok...");
  const ngrokCtx = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  const ngrokPage = await ngrokCtx.newPage();
  
  // Set the specific header for ngrok free tier to bypass warning screen
  await ngrokCtx.setExtraHTTPHeaders({ 'ngrok-skip-browser-warning': 'true' });

  await ngrokPage.goto('https://unnerve-amino-overbite.ngrok-free.dev/auth/login');
  try {
    await ngrokPage.waitForSelector('input[id="email"]', { timeout: 3000 });
    await ngrokPage.fill('input[id="email"]', 'owner@demo.amburax.test');
    await ngrokPage.fill('input[id="password"]', 'Passw0rd!123');
    await ngrokPage.click('button[type="submit"]');
    await ngrokPage.waitForURL('**/dashboard', { timeout: 5000 }).catch(()=>null);
  } catch(e) {}

  await ngrokPage.goto('https://unnerve-amino-overbite.ngrok-free.dev/pos');
  await ngrokPage.waitForLoadState('networkidle');
  const nproducts = await ngrokPage.$$('button:has-text("₹")');
  if (nproducts.length > 0) {
    await nproducts[0].click();
  }
  await ngrokPage.waitForTimeout(500);
  await ngrokPage.screenshot({ path: 'ngrok-pos-final-1536px.png' });
  console.log("Saved ngrok-pos-final-1536px.png");
  
  // Complete a Sale on Localhost to verify Real Sale
  console.log("Completing Real Sale...");
  const saleCtx = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  await saleCtx.addCookies(cookies);
  const salePage = await saleCtx.newPage();
  await salePage.goto('http://localhost:3000/pos');
  await salePage.waitForLoadState('networkidle');
  const sproducts = await salePage.$$('button:has-text("₹")');
  if (sproducts.length > 0) {
    await sproducts[0].click();
  }
  await salePage.waitForTimeout(500);
  await salePage.click('#complete-sale-btn');
  await salePage.waitForTimeout(2000);
  await salePage.screenshot({ path: 'sale-completed.png' });
  console.log("Saved sale-completed.png");
  
  await browser.close();
}

capture().catch(console.error);
