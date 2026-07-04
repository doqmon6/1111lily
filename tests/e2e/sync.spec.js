// M5「N 筆尚未上雲」提醒:離線寫入 → 顯示 pending 筆數;恢復連線 → 自動歸零。
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

test('線上記帳 → 已上雲;離線記帳 → N 筆尚未上雲;恢復連線 → 歸零', async ({ page, context }) => {
  await addProduct(page, '貼紙', 30);
  await startOuting(page, '一日場');

  // 線上記一筆 → ack 後 banner 顯示已上雲
  await page.locator('.tab[data-target="sale"]').click();
  await page.locator('.product-btn', { hasText: '貼紙' }).click();
  await page.click('#checkout-btn');
  await page.locator('.tab[data-target="export"]').click();
  await expect(page.locator('#backup-reminder')).toContainText('已上雲');

  // 離線記一筆 → 尚未上雲 1 筆
  await context.setOffline(true);
  await page.locator('.tab[data-target="sale"]').click();
  await page.locator('.product-btn', { hasText: '貼紙' }).click();
  await page.click('#checkout-btn');
  await expect(page.locator('#sale-msg')).toContainText('已記錄'); // 離線寫入不擋 UI
  await page.locator('.tab[data-target="export"]').click();
  await expect(page.locator('#backup-reminder')).toContainText('1 筆尚未上雲');

  // 恢復連線 → 自動上傳、banner 歸零(auto refresh,無需操作)
  await context.setOffline(false);
  await expect(page.locator('#backup-reminder')).toContainText('已上雲', { timeout: 15000 });
});
