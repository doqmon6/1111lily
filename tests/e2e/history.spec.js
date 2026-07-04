// history.spec.js — M4 修改歷史 UI(AC7)。
// 模式:auth-mock + emulator Firestore(同其他 spec)。
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

async function recordSale(page, name, qty = 1) {
  await page.locator('.tab[data-target="sale"]').click();
  const btn = page.locator('.product-btn', { hasText: name });
  for (let i = 0; i < qty; i++) await btn.click();
  await page.click('#checkout-btn');
}

async function openHistoryExpanded(page) {
  await page.locator('.tab[data-target="export"]').click();
  const toggleBtn = page.locator('.card', { hasText: '修改歷史' }).getByRole('button', { name: '查看' });
  await toggleBtn.click();
  // 等待載入完成(消失「載入中」)
  await page.waitForFunction(() => {
    const body = document.querySelector('.history-body');
    return body && !body.hidden && !body.textContent.includes('載入中');
  }, { timeout: 10000 });
}

test('記一筆再編輯類型為贈送 — 歷史出現「新增」與「編輯」列,編輯列含類型變更描述', async ({ page }) => {
  await addProduct(page, '耳環', 150);
  await startOuting(page, '一日場');
  await recordSale(page, '耳環', 1);

  // 到場次分頁編輯類型為贈送
  await page.locator('.tab[data-target="outing"]').click();
  await page.locator('#sales-list .sale-row').getByRole('button', { name: '編輯' }).click();
  await page.locator('.edit-type').selectOption('gift');
  await page.locator('#sales-list').getByRole('button', { name: '儲存' }).click();

  // 開修改歷史
  await openHistoryExpanded(page);

  const historyList = page.locator('.history-list');
  await expect(historyList).toContainText('新增');
  await expect(historyList).toContainText('編輯');
  // 編輯列有類型變更描述(正常銷售 → 贈送)
  await expect(historyList).toContainText('正常銷售');
  await expect(historyList).toContainText('贈送');
});

test('刪除一筆 — 歷史出現「刪除」列', async ({ page }) => {
  await addProduct(page, '貼紙', 30);
  await startOuting(page, '一日場');
  await recordSale(page, '貼紙', 1);

  await page.locator('.tab[data-target="outing"]').click();
  await page.locator('#sales-list .sale-row').getByRole('button', { name: '刪除' }).click();

  await openHistoryExpanded(page);

  const historyList = page.locator('.history-list');
  await expect(historyList).toContainText('刪除');
});

test('歷史區無編輯/刪除按鈕(唯讀)', async ({ page }) => {
  await addProduct(page, '手鍊', 100);
  await startOuting(page, '一日場');
  await recordSale(page, '手鍊', 1);

  await openHistoryExpanded(page);

  const historyBody = page.locator('.history-body');
  // 歷史清單內無任何「編輯」或「刪除」按鈕
  await expect(historyBody.getByRole('button', { name: '編輯' })).toHaveCount(0);
  await expect(historyBody.getByRole('button', { name: '刪除' })).toHaveCount(0);
});

test('歷史預設收起,點查看展開,再點收起', async ({ page }) => {
  await page.locator('.tab[data-target="export"]').click();
  const card = page.locator('.card', { hasText: '修改歷史' });
  const body = card.locator('.history-body');

  // 預設收起
  await expect(body).toBeHidden();

  // 展開
  await card.getByRole('button', { name: '查看' }).click();
  await expect(body).toBeVisible();

  // 收起
  await card.getByRole('button', { name: '收起' }).click();
  await expect(body).toBeHidden();
});
