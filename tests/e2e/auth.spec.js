// auth.spec.js — 登入 gate e2e 測試。
// 需在 emulator 模式下跑(URL 含 ?emu=1)。
import { test, expect } from '@playwright/test';
import { gotoAndLogin, clearFirestore, clearAuthAccounts } from './helpers.js';

test.beforeEach(async () => {
  await clearFirestore();
  await clearAuthAccounts();
});

test('未登入時不顯示分頁,只顯示登入畫面', async ({ page }) => {
  await page.goto('/index.html?emu=1');
  // 登入畫面可見
  await expect(page.locator('#login-screen')).toBeVisible();
  // App 主介面隱藏
  await expect(page.locator('#app')).toBeHidden();
  // 分頁導覽不可見
  await expect(page.locator('.tabbar')).toBeHidden();
});

test('登入後顯示主介面與分頁', async ({ page }) => {
  await gotoAndLogin(page);
  // 登入畫面消失
  await expect(page.locator('#login-screen')).toBeHidden();
  // App 主介面可見
  await expect(page.locator('#app')).toBeVisible();
  // 分頁列可見
  await expect(page.locator('.tabbar')).toBeVisible();
  // 預設顯示記銷售分頁
  await expect(page.locator('#view-sale')).toBeVisible();
});

test('登出後回到登入畫面', async ({ page }) => {
  await gotoAndLogin(page);
  // 切到匯出分頁找登出按鈕
  await page.locator('.tab[data-target="export"]').click();
  await expect(page.locator('#signout-btn')).toBeVisible();
  await page.click('#signout-btn');
  // 回到登入畫面
  await expect(page.locator('#login-screen')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
});
