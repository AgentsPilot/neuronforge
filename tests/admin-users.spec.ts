import { test, expect } from '@playwright/test';

test('Admin Users page loads without error', async ({ page }) => {
  await page.goto('http://localhost:3000/admin/users');
  await expect(page.locator('h1')).toHaveText('User Management');
  await expect(page.locator('text=User management UI coming soon...')).toBeVisible();
});
