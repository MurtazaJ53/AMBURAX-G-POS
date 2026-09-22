const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to login...");
  await page.goto('http://localhost:3000/auth/login');
  
  await page.fill('input[type="email"]', 'owner@demo.amburax.test');
  await page.fill('input[type="password"]', 'Passw0rd!123');
  await page.click('button[type="submit"]');

  console.log("Waiting for dashboard...");
  await page.waitForURL('**/dashboard');

  console.log("Navigating to POS...");
  await page.goto('http://localhost:3000/pos');
  // wait for it to load
  await page.waitForTimeout(3000);

  // Add items
  console.log("Adding items...");
  try {
     const products = await page.$$('.grid.grid-cols-2 button, .grid.grid-cols-3 button, .grid.grid-cols-6 button');
     if (products.length >= 3) {
       await products[0].click();
       await page.waitForTimeout(300);
       await products[1].click();
       await page.waitForTimeout(300);
       await products[2].click();
       await page.waitForTimeout(500);
     }
  } catch (e) {
     console.log("Could not add items");
  }

  const viewports = [
    { width: 1536, height: 1024, name: '1536px' },
    { width: 1280, height: 800, name: '1280px' },
    { width: 900, height: 1200, name: '900px' },
    { width: 390, height: 844, name: '390px' }
  ];

  const artifactDir = process.env.ARTIFACT_DIR || path.join(process.env.USERPROFILE, '.gemini/antigravity/brain/89e92217-79d1-43a6-be3f-cf6c14a454d6');

  for (const vp of viewports) {
    console.log(`Capturing ${vp.name}...`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(artifactDir, `pos-${vp.name}.png`), fullPage: false });
  }

  await browser.close();
  console.log("Done");
})();
