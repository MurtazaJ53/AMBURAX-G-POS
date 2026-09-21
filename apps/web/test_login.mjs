import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Route to catch network requests
  let loginPostFired = false;
  page.on('request', request => {
    if (request.url().includes('/api/v1/auth/login') && request.method() === 'POST') {
      loginPostFired = true;
      console.log('Intercepted POST to /api/v1/auth/login');
      console.log('Payload:', request.postDataJSON());
    }
  });

  // Navigate to login
  await page.goto('http://localhost:3000/auth/login');
  
  // Fill the form
  await page.fill('input#email', 'owner@demo.amburax.test');
  await page.fill('input#password', 'wrongpassword');

  // Click submit
  await page.click('button[type="submit"]');

  // Wait for the UI error to appear (testing wrong password handling)
  try {
    await page.waitForSelector('text=Sign-in failed', { timeout: 5000 });
    console.log('SUCCESS: Friendly error appeared on screen.');
  } catch (e) {
    console.error('FAIL: Friendly error did not appear.');
  }

  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);
  if (currentUrl.includes('?email') || currentUrl.includes('?password')) {
    console.error('FAIL: URL contains credentials');
  } else {
    console.log('SUCCESS: URL is clean.');
  }

  if (loginPostFired) {
    console.log('SUCCESS: POST request fired.');
  } else {
    console.error('FAIL: POST request did not fire.');
  }

  // Now test correct password
  await page.fill('input#password', 'Passw0rd!123');
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL('**/dashboard', { timeout: 5000 });
    console.log('SUCCESS: Redirected to /dashboard');
  } catch (e) {
    console.error('FAIL: Did not redirect to /dashboard', page.url());
  }

  await browser.close();
})();
