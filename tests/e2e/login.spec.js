const { test, expect } = require('@playwright/test');

test('user can reach the login form without contacting real services', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: [], machines: [], departments: [], lines: [] }) }));
  await page.goto('/');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.getByText('SFC Maintenance Service').first()).toBeVisible();
});
