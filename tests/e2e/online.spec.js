// online.spec.js — M3「線上」分頁(檢視/編輯/刪除)。
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

function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 記一筆線上銷售(無場次時記帳目標本就預設線上)。
async function sellOnline(page, name, { date, note, type } = {}) {
  await page.locator('.tab[data-target="sale"]').click();
  await page.locator('.product-btn', { hasText: name }).click();
  if (date) await page.fill('#online-date', date);
  if (note) await page.fill('#online-note', note);
  if (type) await page.selectOption('#sale-type', type);
  await page.click('#checkout-btn');
  await expect(page.locator('#sale-msg')).toContainText('已記錄');
}

test('點「線上」tab 切換到線上分頁', async ({ page }) => {
  await page.locator('.tab[data-target="online"]').click();
  await expect(page.locator('#view-online')).toBeVisible();
  await expect(page.locator('#view-online h2')).toHaveText('線上');
});

test('線上分頁月分組與月營收只計正常銷售', async ({ page }) => {
  await addProduct(page, '貼紙', 30);
  const today = localDateStr(new Date());
  await sellOnline(page, '貼紙', { date: today });
  await sellOnline(page, '貼紙', { date: today, type: 'gift' });

  await page.locator('.tab[data-target="online"]').click();
  const month = today.slice(0, 7);
  const card = page.locator('#view-online .card', { hasText: month });
  await expect(card).toContainText('月營收 $30'); // 只算正常銷售那一筆
  await expect(card.locator('.sale-row')).toHaveCount(2);
});

test('線上筆編輯備註與日期,改到新月份後從舊分組消失、出現在新分組', async ({ page }) => {
  await addProduct(page, '手鍊', 100);
  const today = localDateStr(new Date());
  await sellOnline(page, '手鍊', { date: today, note: 'IG @foo' });

  await page.locator('.tab[data-target="online"]').click();
  const oldMonth = today.slice(0, 7);
  await expect(page.locator('#view-online .card', { hasText: oldMonth })).toContainText('IG @foo');

  await page.locator('#view-online .sale-row').getByRole('button', { name: '編輯' }).click();
  await page.locator('.edit-note').fill('IG @bar');
  const newDate = new Date(2020, 0, 15); // 固定挪到過去的月份,確保與今天不同月
  const newMonth = localDateStr(newDate).slice(0, 7);
  await page.locator('.edit-date').fill(localDateStr(newDate));
  await page.getByRole('button', { name: '儲存' }).click();

  const newCard = page.locator('#view-online .card', { hasText: newMonth });
  await expect(newCard).toContainText('IG @bar');
  await expect(page.locator('#view-online .card', { hasText: oldMonth })).toHaveCount(0);
});

test('線上筆刪除', async ({ page }) => {
  await addProduct(page, '耳環', 150);
  const today = localDateStr(new Date());
  await sellOnline(page, '耳環', { date: today });

  await page.locator('.tab[data-target="online"]').click();
  await expect(page.locator('#view-online .sale-row')).toHaveCount(1);
  await page.locator('#view-online .sale-row').getByRole('button', { name: '刪除' }).click();
  await expect(page.locator('#view-online .sale-row')).toHaveCount(0);
  await expect(page.locator('#view-online')).toContainText('還沒有線上銷售紀錄');
});
