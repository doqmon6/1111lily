import { test, expect } from '@playwright/test';
import { gotoAndLogin, clearFirestore, clearAuthAccounts } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearFirestore();
  await clearAuthAccounts();
  await gotoAndLogin(page);
});

async function addProduct(page, name, price, cost) {
  await page.locator('.tab[data-target="products"]').click();
  await page.fill('#p-name', name);
  await page.fill('#p-price', String(price));
  if (cost != null) await page.fill('#p-cost', String(cost));
  await page.click('#product-form button[type="submit"]');
  await expect(page.locator('#product-list')).toContainText(name);
}

async function startOuting(page, name, { fixed = {}, bring = {} } = {}) {
  await page.locator('.tab[data-target="outing"]').click();
  await page.getByRole('button', { name: /開始新場次/ }).click();
  await page.fill('#o-name', name);
  for (const [label, amount] of Object.entries(fixed)) {
    await page.locator(`input[data-label="${label}"]`).fill(String(amount));
  }
  for (const [prod, qty] of Object.entries(bring)) {
    await page.locator('label.bring-row', { hasText: prod }).locator('input').fill(String(qty));
  }
  await page.getByRole('button', { name: '開始場次' }).click();
  await expect(page.locator('#view-outing .active-outing')).toContainText(name);
}

async function sell(page, name, times = 1) {
  await page.locator('.tab[data-target="sale"]').click();
  const btn = page.locator('.product-btn', { hasText: name });
  for (let i = 0; i < times; i++) await btn.click();
}

const revenueStat = (page) => page.locator('#view-outing .stat', { hasText: '收入' });
const netStat = (page) => page.locator('#view-outing .stat', { hasText: '淨額' });

test('尚未開始場次時無法結帳', async ({ page }) => {
  await addProduct(page, '貼紙', 30);
  await sell(page, '貼紙', 1);
  await page.click('#checkout-btn');
  await expect(page.locator('#sale-msg')).toContainText('尚未開始場次');
});

test('開始場次後記銷售,場次收入正確', async ({ page }) => {
  await addProduct(page, '明信片', 20, 8);
  await startOuting(page, '玩具展');
  await sell(page, '明信片', 2);
  await expect(page.locator('#cart-total')).toHaveText('$40');
  await page.click('#checkout-btn');
  await expect(page.locator('#today-total')).toHaveText('$40');

  await page.locator('.tab[data-target="outing"]').click();
  await expect(revenueStat(page)).toContainText('$40');
});

test('帶貨剩餘:帶30,賣5+贈送2 → 賣7剩23,收入只算100', async ({ page }) => {
  await addProduct(page, '明信片', 20, 8);
  await startOuting(page, '松菸', { bring: { 明信片: 30 } });

  await sell(page, '明信片', 5);
  await page.click('#checkout-btn');
  await sell(page, '明信片', 2);
  await page.selectOption('#sale-type', 'gift');
  await page.click('#checkout-btn');

  await page.locator('.tab[data-target="outing"]').click();
  const row = page.locator('.agg-table tbody tr', { hasText: '明信片' });
  await expect(row.locator('td').nth(1)).toHaveText('30'); // 帶
  await expect(row.locator('td').nth(2)).toHaveText('7');  // 賣(含贈送)
  await expect(row.locator('td').nth(3)).toHaveText('23'); // 剩
  await expect(row.locator('td').nth(4)).toHaveText('$100'); // 收入(只算正常)
  await expect(revenueStat(page)).toContainText('$100');
});

test('淨額 = 收入 − 出貨成本 − 固定成本', async ({ page }) => {
  await addProduct(page, '手鍊', 100, 40);
  await startOuting(page, '玩具展', { fixed: { 攤租: 500 } });
  await sell(page, '手鍊', 10);
  await page.click('#checkout-btn');

  await page.locator('.tab[data-target="outing"]').click();
  // 收入 1000 − 成本 400 − 固定 500 = 100
  await expect(netStat(page)).toContainText('$100');
});

test('關閉場次後無法再記銷售', async ({ page }) => {
  await addProduct(page, '貼紙', 30);
  await startOuting(page, '一日場');
  await page.locator('.tab[data-target="outing"]').click();
  await page.getByRole('button', { name: '關閉場次' }).click();

  await sell(page, '貼紙', 1);
  await page.click('#checkout-btn');
  await expect(page.locator('#sale-msg')).toContainText('尚未開始場次');
});

test('停售已帶貨商品後編輯場次,帶貨量不遺失', async ({ page }) => {
  await addProduct(page, '絕版小卡', 50);
  await startOuting(page, '玩具展', { bring: { 絕版小卡: 20 } });

  await page.locator('.tab[data-target="products"]').click();
  await page.locator('#product-list li', { hasText: '絕版小卡' }).getByRole('button', { name: '停售' }).click();

  await page.locator('.tab[data-target="outing"]').click();
  await page.getByRole('button', { name: '編輯帶貨/成本' }).click();
  await page.fill('#o-name', '玩具展B');
  await page.getByRole('button', { name: '儲存' }).click();

  const row = page.locator('.agg-table tbody tr', { hasText: '絕版小卡' });
  await expect(row.locator('td').nth(1)).toHaveText('20'); // 帶貨量仍在
});

test('編輯一筆改類型為贈送,收入不再計入', async ({ page }) => {
  await addProduct(page, '耳環', 150);
  await startOuting(page, '松菸');
  await sell(page, '耳環', 1);
  await page.click('#checkout-btn');

  await page.locator('.tab[data-target="outing"]').click();
  await expect(revenueStat(page)).toContainText('$150');
  await page.locator('#sales-list .sale-row').getByRole('button', { name: '編輯' }).click();
  await page.locator('.edit-type').selectOption('gift');
  await page.locator('#sales-list').getByRole('button', { name: '儲存' }).click();
  await expect(revenueStat(page)).toContainText('$0');
});

test('刪除一筆後從明細消失', async ({ page }) => {
  await addProduct(page, '貼紙', 30);
  await startOuting(page, '一日場');
  await sell(page, '貼紙', 1);
  await page.click('#checkout-btn');

  await page.locator('.tab[data-target="outing"]').click();
  await expect(page.locator('#sales-list')).toContainText('貼紙');
  await page.locator('#sales-list .sale-row').getByRole('button', { name: '刪除' }).click();
  await expect(page.locator('#sales-list')).toContainText('還沒有銷售');
});
