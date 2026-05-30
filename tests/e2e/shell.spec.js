import { test, expect } from '@playwright/test';

test('四個分頁可切換', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#view-sale')).toBeVisible();

  await page.locator('.tab[data-target="products"]').click();
  await expect(page.locator('#view-products')).toBeVisible();
  await expect(page.locator('#view-sale')).toBeHidden();

  await page.locator('.tab[data-target="outing"]').click();
  await expect(page.locator('#view-outing')).toBeVisible();

  await page.locator('.tab[data-target="export"]').click();
  await expect(page.locator('#view-export')).toBeVisible();
});

test('manifest 含必要欄位', async ({ page, request }) => {
  await page.goto('/index.html');
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

test('Service Worker 註冊且離線可重載', async ({ page, context }) => {
  await page.goto('/index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // 線上再載一次,確保 app shell 進入快取且頁面受 SW 控制
  await page.reload();
  await page.waitForLoadState('networkidle');

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#view-sale')).toBeVisible();
  await context.setOffline(false);
});
