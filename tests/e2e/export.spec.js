import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
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

async function startOuting(page, name, { bring = {} } = {}) {
  await page.locator('.tab[data-target="outing"]').click();
  await page.getByRole('button', { name: /開始新場次/ }).click();
  await page.fill('#o-name', name);
  for (const [prod, qty] of Object.entries(bring)) {
    await page.locator('label.bring-row', { hasText: prod }).locator('input').fill(String(qty));
  }
  await page.getByRole('button', { name: '開始場次' }).click();
  await expect(page.locator('#view-outing .active-outing')).toContainText(name);
}

async function recordSale(page, name, qty, method) {
  await page.locator('.tab[data-target="sale"]').click();
  const btn = page.locator('.product-btn', { hasText: name });
  for (let i = 0; i < qty; i++) await btn.click();
  if (method) await page.selectOption('#pay-method', method);
  await page.click('#checkout-btn');
}

test('場次明細 CSV:新表頭(場次/類型、無件數)與數值', async ({ page }) => {
  await addProduct(page, '手鍊', 100, 40);
  await startOuting(page, '玩具展');
  await recordSale(page, '手鍊', 2, 'cash');

  await page.locator('.tab[data-target="export"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-detail-btn'),
  ]);
  const buf = await fs.readFile(await download.path());
  expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM

  const text = buf.toString('utf8').replace(/^﻿/, '');
  expect(text).toContain('日期,時間,場次,類型,商品明細,總金額,付款方式');
  expect(text).not.toContain('件數');
  expect(text).toContain('玩具展,正常銷售,手鍊×2,200,現金');
});

test('商品彙總 CSV:每商品 帶/賣/剩/收入/成本', async ({ page }) => {
  await addProduct(page, '明信片', 20, 8);
  await startOuting(page, '松菸', { bring: { 明信片: 30 } });
  await recordSale(page, '明信片', 5, 'cash');

  await page.locator('.tab[data-target="export"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-summary-btn'),
  ]);
  const text = (await fs.readFile(await download.path())).toString('utf8');
  expect(text).toContain('商品,帶量,賣出,剩餘,收入,成本');
  expect(text).toContain('明信片,30,5,25,100,40'); // 帶30 賣5 剩25 收入100 成本5×8=40
});

test('JSON 備份可下載(banner 為 M5 上雲語意,見 sync.spec)', async ({ page }) => {
  await addProduct(page, '貼紙', 30);
  await startOuting(page, '一日場');
  await recordSale(page, '貼紙', 1, 'cash');

  await page.locator('.tab[data-target="export"]').click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#backup-btn'),
  ]);
  expect(await dl.path()).toBeTruthy();
});

test('壞檔匯入:明確錯誤訊息、不寫入任何資料', async ({ page }) => {
  await page.locator('.tab[data-target="export"]').click();
  await page.setInputFiles('#restore-file', {
    name: 'garbage.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"not":"a backup"}'),
  });
  await expect(page.locator('#export-msg')).toContainText('不是有效的備份檔');
  await page.locator('.tab[data-target="products"]').click();
  await expect(page.locator('#product-list')).toContainText('還沒有商品');
});

test('JSON 備份 → 清空 Firestore → 還原,資料完整回來', async ({ page }) => {
  await addProduct(page, '手鍊', 100, 40);
  await startOuting(page, '玩具展');
  await recordSale(page, '手鍊', 2, 'cash');

  await page.locator('.tab[data-target="export"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#backup-btn'),
  ]);
  const backupPath = await download.path();

  // 清空 Firestore emulator 模擬「換機 / 資料遺失」
  await clearFirestore();
  // 重新導覽並登入(清空後重載)
  await page.goto('/index.html?emu=1');
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });

  await page.locator('.tab[data-target="products"]').click();
  await expect(page.locator('#product-list')).toContainText('還沒有商品');

  // 還原(接受覆蓋確認)
  page.on('dialog', (d) => d.accept());
  await page.locator('.tab[data-target="export"]').click();
  await page.setInputFiles('#restore-file', backupPath);
  await expect(page.locator('#export-msg')).toContainText('已還原');

  // 資料回來:商品、場次、收入
  await page.locator('.tab[data-target="products"]').click();
  await expect(page.locator('#product-list')).toContainText('手鍊');
  await page.locator('.tab[data-target="outing"]').click();
  await expect(page.locator('#view-outing')).toContainText('玩具展');
  await expect(page.locator('#view-outing .stat', { hasText: '收入' })).toContainText('$200');
});
