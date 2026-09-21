import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();

  console.log('Navigating to login...');
  await page.goto('http://localhost:3000/auth/login');
  
  await page.fill('input[name="email"]', 'demo@amburax.com');
  await page.fill('input[name="password"]', 'demo123');
  
  console.log('Clicking login...');
  await page.click('button[type="submit"]');

  console.log('On dashboard, taking screenshot...');
  await page.waitForURL('http://localhost:3000/dashboard', { timeout: 60000 });
  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({ path: 'screenshot_dashboard_390.png', fullPage: true });

  await browser.close();
  console.log('Done');
})();
