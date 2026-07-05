import { test, expect } from '@playwright/test';
import { gotoAndLogin, clearFirestore, clearAuthAccounts } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearFirestore();
  await clearAuthAccounts();
  await gotoAndLogin(page);
});

test('五個分頁可切換', async ({ page }) => {
  await expect(page.locator('#view-sale')).toBeVisible();

  await page.locator('.tab[data-target="products"]').click();
  await expect(page.locator('#view-products')).toBeVisible();
  await expect(page.locator('#view-sale')).toBeHidden();

  await page.locator('.tab[data-target="outing"]').click();
  await expect(page.locator('#view-outing')).toBeVisible();

  await page.locator('.tab[data-target="online"]').click();
  await expect(page.locator('#view-online')).toBeVisible();

  await page.locator('.tab[data-target="export"]').click();
  await expect(page.locator('#view-export')).toBeVisible();
});

test('manifest 含必要欄位', async ({ page, request }) => {
  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(href).toBeTruthy();
  const res = await request.get('/' + href);
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m.name).toBeTruthy();
  expect(m.start_url).toBeTruthy();
  expect(m.display).toBe('standalone');
  expect(Array.isArray(m.icons)).toBeTruthy();
  expect(m.icons.length).toBeGreaterThan(0);
});

test('匯出分頁有使用說明連結且 href 正確', async ({ page }) => {
  await page.locator('.tab[data-target="export"]').click();
  await expect(page.locator('#view-export')).toBeVisible();
  const link = page.locator('a[href*="USER-GUIDE.md"]');
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toBe('https://github.com/doqmon6/1111lily/blob/master/docs/USER-GUIDE.md');
  const target = await link.getAttribute('target');
  expect(target).toBe('_blank');
});

test('Service Worker 註冊且離線可重載', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // 線上再載一次,確保 app shell 進入快取且頁面受 SW 控制。
  // 注意:networkidle 在長駐 Firestore listener 下永不成立,
  // 改等「SW 接管 + Firebase SDK(gstatic)進 runtime cache」——離線重載的充分條件。
  await page.goto('/index.html?emu=1');
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(async () => {
    for (const n of await caches.keys()) {
      const keys = await (await caches.open(n)).keys();
      if (keys.some((r) => r.url.includes('gstatic.com/firebasejs'))) return true;
    }
    return false;
  }, { timeout: 20000 });

  await context.setOffline(true);
  await page.reload();
  // 離線下登入畫面或 app 都可接受(SW 快取);兩者只會有一個非 hidden
  await expect(page.locator('#login-screen:not([hidden]), #app:not([hidden])').first()).toBeVisible();
  await context.setOffline(false);
});
