import { chromium } from '@playwright/test';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/products');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `screenshot_initial.png` });
  console.log("Captured initial state, url:", page.url());
  await browser.close();
})();
