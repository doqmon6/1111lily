// db.test.js — 連 Firestore Emulator。
// 執行方式:npm run test:emulator(emulators:exec 自動注入 FIRESTORE_EMULATOR_HOST)。
// 每個 test 前透過 emulator REST API 清空資料,確保隔離。
import { describe, it, expect, beforeEach } from 'vitest';
import { dateKey } from '../js/logic.js';
import {
  addProduct, getAllProducts, getActiveProducts, setProductActive, getProduct, updateProduct,
  addSale, getSalesByDate, getSalesByOuting, getAllSales, updateSale, deleteSale, _closeDb,
  addOuting, getAllOutings, getOpenOuting, closeOuting, ensureMigrated,
  setUserId,
} from '../js/db.js';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
const PROJECT_ID = 'demo-market-sales';
const CLEAR_URL = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

beforeEach(async () => {
  // 清空 emulator 所有資料,確保每個 test 從乾淨狀態開始。
  await fetch(CLEAR_URL, { method: 'DELETE' });
  _closeDb(); // no-op in Firestore version; kept for API compatibility
  // 每個 test 重設 uid,避免 test 間汙染(uid 改變時 Firestore 走不同路徑)
  setUserId('dev');
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

  it('addSale 預設 type=sale、outingId=null', async () => {
    const s = await addSale({ items: [], total: 0, paymentMethod: 'cash', createdAt: '2026-05-30T01:00:00.000Z' });
    expect(s.type).toBe('sale');
    expect(s.outingId).toBeNull();
  });

  it('銷售綁定場次與類型,可依場次查詢', async () => {
    const o = await addOuting({ name: '松菸' });
    const item = [{ productId: 'a', name: 'A', price: 50, cost: 20, qty: 1 }];
    await addSale({ items: item, total: 50, paymentMethod: 'cash', outingId: o.id, type: 'sale', createdAt: '2026-05-30T01:00:00.000Z' });
    await addSale({ items: item, total: 50, paymentMethod: 'cash', outingId: o.id, type: 'gift', createdAt: '2026-05-30T02:00:00.000Z' });
    const list = await getSalesByOuting(o.id);
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.type)).toEqual(['sale', 'gift']);
  });
});

describe('product cost', () => {
  it('商品帶成本,未填預設 0', async () => {
    const p = await addProduct({ name: '手鍊', price: 100, cost: 40 });
    expect(p.cost).toBe(40);
    const p2 = await addProduct({ name: '貼紙', price: 30 });
    expect(p2.cost).toBe(0);
  });
});

describe('outings', () => {
  it('新增=進行中;同時只一場進行中;關閉後無進行中', async () => {
    const o = await addOuting({ name: '玩具展', fixedCosts: [{ label: '攤租', amount: 2000 }] });
    expect(o.status).toBe('open');
    expect(o.fixedCosts[0].amount).toBe(2000);
    expect((await getOpenOuting()).id).toBe(o.id);
    await closeOuting(o.id);
    expect(await getOpenOuting()).toBeNull();
    const all = await getAllOutings();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('closed');
    expect(all[0].closedAt).toBeTruthy();
  });
});

describe('v1 → v2 遷移', () => {
  it('舊銷售(無 outingId)升級後保留,並歸入已關閉的「舊紀錄」場次', async () => {
    // Firestore 版:直接以 addSale 寫入無 outingId 的銷售模擬舊資料
    await addSale({
      items: [{ productId: 'p', name: '舊商品', price: 100, qty: 1 }],
      total: 100, paymentMethod: 'cash',
      createdAt: '2026-05-01T01:00:00.000Z',
    });

    const legacy = await ensureMigrated();
    expect(legacy.name).toBe('舊紀錄');
    expect(legacy.status).toBe('closed');

    const all = await getAllSales();
    expect(all).toHaveLength(1);
    expect(all[0].total).toBe(100);
    expect(all[0].outingId).toBe(legacy.id);

    expect(await getSalesByOuting(legacy.id)).toHaveLength(1);
    // 冪等:再跑一次不再建場次、不重複處理
    expect(await ensureMigrated()).toBeNull();
    expect(await getAllOutings()).toHaveLength(1);
  });
});
