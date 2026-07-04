import { test, expect } from '@playwright/test';
import { gotoAndLogin, clearFirestore, clearAuthAccounts } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearFirestore();
  await clearAuthAccounts();
  await gotoAndLogin(page);
});

async function addProduct(page, name, price) {
  await page.locator('.tab[data-target="products"]').click();
  await page.fill('#p-name', name);
  await page.fill('#p-price', String(price));
  await page.click('#product-form button[type="submit"]');
  await expect(page.locator('#product-list')).toContainText(name);
}

async function startOuting(page, name) {
  await page.locator('.tab[data-target="outing"]').click();
  await page.getByRole('button', { name: /開始新場次/ }).click();
  await page.fill('#o-name', name);
  await page.getByRole('button', { name: '開始場次' }).click();
  await expect(page.locator('#view-outing .active-outing')).toContainText(name);
}

test('多商品銷售:即時總額、完成存檔、今天累計更新', async ({ page }) => {
  await addProduct(page, '手鍊', 100);
  await addProduct(page, '耳環', 150);
  await startOuting(page, '測試場');
  await page.locator('.tab[data-target="sale"]').click();

  const bracelet = page.locator('.product-btn', { hasText: '手鍊' });
  await bracelet.click();
  await bracelet.click();
  await page.locator('.product-btn', { hasText: '耳環' }).click();

  await expect(page.locator('#cart-total')).toHaveText('$350');

  await page.click('#checkout-btn');
  await expect(page.locator('#today-total')).toHaveText('$350');
  await expect(page.locator('#today-count')).toHaveText('1 筆');
  await expect(page.locator('#cart-total')).toHaveText('$0');

  // 第二筆:轉帳
  await page.locator('.product-btn', { hasText: '耳環' }).click();
  await page.selectOption('#pay-method', 'transfer');
  await page.click('#checkout-btn');
  await expect(page.locator('#today-total')).toHaveText('$500');
  await expect(page.locator('#today-count')).toHaveText('2 筆');
});

test('購物車數量增減與移除,總額即時重算', async ({ page }) => {
  await addProduct(page, '貼紙', 30);
  await page.locator('.tab[data-target="sale"]').click();

  const btn = page.locator('.product-btn', { hasText: '貼紙' });
  await btn.click();
  await btn.click();
  await btn.click();
  await expect(page.locator('#cart-total')).toHaveText('$90');

  const row = page.locator('.cart-row', { hasText: '貼紙' });
  await row.getByRole('button', { name: '減少' }).click();
  await expect(page.locator('#cart-total')).toHaveText('$60');

  await row.getByRole('button', { name: '減少' }).click();
  await row.getByRole('button', { name: '減少' }).click();
  await expect(page.locator('#cart-total')).toHaveText('$0');
  await expect(page.locator('#cart')).toContainText('點上方商品');
});

test('停售商品不出現在記銷售商品格', async ({ page }) => {
  await addProduct(page, '絕版品', 100);
  await page.locator('.tab[data-target="products"]').click();
  await page.locator('#product-list li', { hasText: '絕版品' }).getByRole('button', { name: '停售' }).click();

  await page.locator('.tab[data-target="sale"]').click();
  await expect(page.locator('.product-btn', { hasText: '絕版品' })).toHaveCount(0);
});

test('現場新增商品立即可賣並存入清單', async ({ page }) => {
  await page.locator('.tab[data-target="sale"]').click();

  await page.click('#add-onfly-btn');
  await page.fill('#of-name', '限定小卡');
  await page.fill('#of-price', '80');
  await page.locator('.onfly button[type="submit"]').click();

  await expect(page.locator('.product-btn', { hasText: '限定小卡' })).toBeVisible();
  await expect(page.locator('#cart-total')).toHaveText('$80');

  await page.locator('.tab[data-target="products"]').click();
  await expect(page.locator('#product-list')).toContainText('限定小卡');
});
