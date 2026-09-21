const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('#email', 'owner@demo.amburax.test');
  await page.fill('#password', 'Passw0rd!123');
  await page.click('button[type="submit"]');

  // Wait for navigation after login
  await page.waitForURL(url => url.pathname !== '/auth/login', { timeout: 15000 });

  await page.goto('http://localhost:3000/sales');
  await page.waitForTimeout(3000);

  // Click first row to open inspector
  try {
    await page.click('table tbody tr:first-child');
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log("Could not click first row", e.message);
  }

  const sizes = [
    { width: 1536, height: 864, name: '1536px' },
    { width: 1280, height: 720, name: '1280px' },
    { width: 900, height: 800, name: '900px' },
    { width: 390, height: 844, name: '390px' }
  ];

  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(1000); // let layout settle
    await page.screenshot({ path: `screenshots/sales-F7.2-${size.name}.png` });
    console.log(`Saved screenshots/sales-F7.2-${size.name}.png`);
  }

  await browser.close();
}

run().catch(console.error);
