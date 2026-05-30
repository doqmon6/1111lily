import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { dateKey } from '../js/logic.js';
import {
  addProduct, getAllProducts, getActiveProducts, setProductActive, getProduct, updateProduct,
  addSale, getSalesByDate, getAllSales, updateSale, deleteSale, _closeDb,
} from '../js/db.js';

beforeEach(() => {
  // 每個測試一個全新的記憶體資料庫,確保隔離。
  globalThis.indexedDB = new IDBFactory();
  _closeDb();
});

describe('products', () => {
  it('新增後可讀回,預設 active', async () => {
    const p = await addProduct({ name: '手鍊', price: 100 });
    expect(p.id).toBeTruthy();
    expect(p.active).toBe(true);
    const all = await getAllProducts();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('手鍊');
  });

  it('停售後不在 active 清單,但仍在全部', async () => {
    const p = await addProduct({ name: '耳環', price: 150 });
    await setProductActive(p.id, false);
    expect(await getActiveProducts()).toHaveLength(0);
    expect(await getAllProducts()).toHaveLength(1);
  });

  it('編輯商品名稱/價格', async () => {
    const p = await addProduct({ name: '手鍊', price: 100 });
    await updateProduct({ ...p, name: '銀手鍊', price: 120 });
    const got = await getProduct(p.id);
    expect(got.name).toBe('銀手鍊');
    expect(got.price).toBe(120);
  });
});

describe('sales', () => {
  it('新增銷售自動帶 dateKey,可依日期查詢', async () => {
    const sale = await addSale({
      items: [{ productId: 'x', name: '手鍊', price: 100, qty: 2 }],
      total: 200, paymentMethod: 'cash', createdAt: '2026-05-30T01:00:00.000Z',
    });
    expect(sale.dateKey).toBe(dateKey(new Date('2026-05-30T01:00:00.000Z')));
    const list = await getSalesByDate(sale.dateKey);
    expect(list).toHaveLength(1);
    expect(list[0].total).toBe(200);
    expect(list[0].items[0].name).toBe('手鍊');
  });

  it('更新後重算、刪除後消失', async () => {
    const s = await addSale({
      items: [{ productId: 'x', name: 'A', price: 50, qty: 1 }],
      total: 50, paymentMethod: 'cash', createdAt: '2026-05-30T02:00:00.000Z',
    });
    await updateSale({ ...s, total: 75, items: [{ productId: 'x', name: 'A', price: 75, qty: 1 }] });
    let list = await getSalesByDate(s.dateKey);
    expect(list[0].total).toBe(75);
    await deleteSale(s.id);
    list = await getSalesByDate(s.dateKey);
    expect(list).toHaveLength(0);
  });

  it('不同日期互不混入', async () => {
    await addSale({ items: [], total: 10, paymentMethod: 'cash', createdAt: '2026-05-30T02:00:00.000Z' });
    await addSale({ items: [], total: 20, paymentMethod: 'transfer', createdAt: '2026-05-31T02:00:00.000Z' });
    const k1 = dateKey(new Date('2026-05-30T02:00:00.000Z'));
    expect(await getSalesByDate(k1)).toHaveLength(1);
    expect(await getAllSales()).toHaveLength(2);
  });
});
