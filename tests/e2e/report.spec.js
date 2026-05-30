import { test, expect } from '@playwright/test';

async function addProduct(page, name, price) {
  await page.locator('.tab[data-target="products"]').click();
  await page.fill('#p-name', name);
  await page.fill('#p-price', String(price));
  await page.click('#product-form button[type="submit"]');
  await expect(page.locator('#product-list')).toContainText(name);
}

async function recordSale(page, productName, qty, method) {
  await page.locator('.tab[data-target="sale"]').click();
  const btn = page.locator('.product-btn', { hasText: productName });
  for (let i = 0; i < qty; i++) await btn.click();
  if (method) await page.selectOption('#pay-method', method);
  await page.click('#checkout-btn');
}

test('當日對帳:總額/筆數/現金小計/轉帳小計', async ({ page }) => {
  await page.goto('/index.html');
  await addProduct(page, '手鍊', 100);
  await addProduct(page, '耳環', 150);
  await recordSale(page, '手鍊', 2, 'cash');
  await recordSale(page, '耳環', 1, 'transfer');

  await page.locator('.tab[data-target="report"]').click();
  await expect(page.locator('#report-total')).toHaveText('$350');
  await expect(page.locator('#report-count')).toHaveText('2');
  await expect(page.locator('#report-cash')).toHaveText('$200');
  await expect(page.locator('#report-transfer')).toHaveText('$150');
  await expect(page.locator('#report-list .sale-row')).toHaveCount(2);
});

test('刪除一筆後對帳減少', async ({ page }) => {
  await page.goto('/index.html');
  await addProduct(page, '貼紙', 30);
  await recordSale(page, '貼紙', 1, 'cash');
  await recordSale(page, '貼紙', 2, 'cash');

  await page.locator('.tab[data-target="report"]').click();
  await expect(page.locator('#report-total')).toHaveText('$90');

  await page.locator('.sale-row').first().getByRole('button', { name: '刪除' }).click();
  await expect(page.locator('#report-list .sale-row')).toHaveCount(1);
  await expect(page.locator('#report-total')).toHaveText('$60');
});

test('編輯一筆:改數量與付款方式並重算', async ({ page }) => {
  await page.goto('/index.html');
  await addProduct(page, '手鍊', 100);
  await recordSale(page, '手鍊', 2, 'cash');

  await page.locator('.tab[data-target="report"]').click();
  await expect(page.locator('#report-total')).toHaveText('$200');
  await expect(page.locator('#report-cash')).toHaveText('$200');

  await page.locator('.sale-row').first().getByRole('button', { name: '編輯' }).click();
  await page.locator('.sale-editor').getByRole('button', { name: '減少' }).click();
  await page.locator('.edit-method').selectOption('transfer');
  await page.locator('.sale-editor').getByRole('button', { name: '儲存' }).click();

  await expect(page.locator('#report-total')).toHaveText('$100');
  await expect(page.locator('#report-cash')).toHaveText('$0');
  await expect(page.locator('#report-transfer')).toHaveText('$100');
});
