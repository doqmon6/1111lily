import { test, expect } from '@playwright/test';

async function gotoProducts(page) {
  await page.goto('/index.html');
  await page.locator('.tab[data-target="products"]').click();
  await expect(page.locator('#product-form')).toBeVisible();
}

test('新增商品並在重載後仍存在', async ({ page }) => {
  await gotoProducts(page);
  await page.fill('#p-name', '手鍊');
  await page.fill('#p-price', '150');
  await page.click('#product-form button[type="submit"]');
  await expect(page.locator('#product-list')).toContainText('手鍊');
  await expect(page.locator('#product-list')).toContainText('$150');

  await page.reload();
  await page.locator('.tab[data-target="products"]').click();
  await expect(page.locator('#product-list')).toContainText('手鍊');
});

test('單價需為正整數(0 被拒)', async ({ page }) => {
  await gotoProducts(page);
  await page.fill('#p-name', '測試');
  await page.fill('#p-price', '0');
  await page.click('#product-form button[type="submit"]');
  await expect(page.locator('#p-error')).toBeVisible();
  await expect(page.locator('#product-list')).not.toContainText('測試');
});

test('停售後顯示已停售,可恢復', async ({ page }) => {
  await gotoProducts(page);
  await page.fill('#p-name', '耳環');
  await page.fill('#p-price', '200');
  await page.click('#product-form button[type="submit"]');

  const row = page.locator('#product-list li', { hasText: '耳環' });
  await row.getByRole('button', { name: '停售' }).click();
  await expect(row).toContainText('已停售');
  await row.getByRole('button', { name: '恢復' }).click();
  await expect(row).not.toContainText('已停售');
});

test('成本可記錄、可編輯,列表顯示', async ({ page }) => {
  await gotoProducts(page);
  await page.fill('#p-name', '手鍊');
  await page.fill('#p-price', '150');
  await page.fill('#p-cost', '60');
  await page.click('#product-form button[type="submit"]');
  await expect(page.locator('#product-list li', { hasText: '手鍊' })).toContainText('成本 $60');

  await page.locator('#product-list li', { hasText: '手鍊' }).getByRole('button', { name: '編輯' }).click();
  await page.locator('#product-list .e-cost').fill('70');
  await page.locator('#product-list').getByRole('button', { name: '儲存' }).click();
  await expect(page.locator('#product-list')).toContainText('成本 $70');
});

test('成本選填,留空存為 $0', async ({ page }) => {
  await gotoProducts(page);
  await page.fill('#p-name', '貼紙');
  await page.fill('#p-price', '30');
  await page.click('#product-form button[type="submit"]');
  await expect(page.locator('#product-list li', { hasText: '貼紙' })).toContainText('成本 $0');
});

test('編輯商品名稱與價格', async ({ page }) => {
  await gotoProducts(page);
  await page.fill('#p-name', '手鍊');
  await page.fill('#p-price', '150');
  await page.click('#product-form button[type="submit"]');

  await page.locator('#product-list li', { hasText: '手鍊' }).getByRole('button', { name: '編輯' }).click();
  await page.locator('#product-list .e-name').fill('銀手鍊');
  await page.locator('#product-list .e-price').fill('180');
  await page.locator('#product-list').getByRole('button', { name: '儲存' }).click();

  await expect(page.locator('#product-list')).toContainText('銀手鍊');
  await expect(page.locator('#product-list')).toContainText('$180');
});
