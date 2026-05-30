import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

async function addProduct(page, name, price) {
  await page.locator('.tab[data-target="products"]').click();
  await page.fill('#p-name', name);
  await page.fill('#p-price', String(price));
  await page.click('#product-form button[type="submit"]');
  await expect(page.locator('#product-list')).toContainText(name);
}

async function recordSale(page, name, qty, method) {
  await page.locator('.tab[data-target="sale"]').click();
  const btn = page.locator('.product-btn', { hasText: name });
  for (let i = 0; i < qty; i++) await btn.click();
  if (method) await page.selectOption('#pay-method', method);
  await page.click('#checkout-btn');
}

test('匯出當天 CSV:UTF-8 BOM + 表頭 + 數值', async ({ page }) => {
  await page.goto('/index.html');
  await addProduct(page, '手鍊', 100);
  await recordSale(page, '手鍊', 2, 'cash');

  await page.locator('.tab[data-target="export"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-day-btn'),
  ]);
  const buf = await fs.readFile(await download.path());

  // UTF-8 BOM = EF BB BF
  expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);

  const text = buf.toString('utf8').replace(/^﻿/, '');
  expect(text).toContain('日期,時間,商品明細,件數,總金額,付款方式');
  expect(text).toContain('手鍊×2');
  expect(text).toContain(',2,200,現金');
});

test('匯出全部 CSV:多筆都在', async ({ page }) => {
  await page.goto('/index.html');
  await addProduct(page, '貼紙', 30);
  await recordSale(page, '貼紙', 1, 'cash');
  await recordSale(page, '貼紙', 2, 'transfer');

  await page.locator('.tab[data-target="export"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-all-btn'),
  ]);
  const text = (await fs.readFile(await download.path())).toString('utf8');
  const lines = text.trim().split('\r\n');
  expect(lines.length).toBe(3); // 表頭 + 2 筆
});
