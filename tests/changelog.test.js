// changelog.test.js — M4 append-only 修改歷史(Firestore Emulator)。
// 執行方式:npm run test:emulator。
// 模式抄 migrate.test.js:Auth emulator FIXED_UID + beforeEach 清庫輪詢歸零。
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { waitForPendingWrites } from 'firebase/firestore';
import { app, db } from '../js/firebase.js';
import {
  addSale, updateSale, deleteSale, getAllSales, getAllOutings, getAllProducts,
  getChangelog, setUserId,
} from '../js/db.js';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
const AUTH_EMULATOR_HOST = 'localhost:9099';
const PROJECT_ID = 'demo-market-sales';
const CLEAR_URL = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const ITEM = { productId: 'p-1', name: '手鍊', price: 100, cost: 40, qty: 2 };

beforeAll(async () => {
  const auth = getAuth(app);
  await fetch(`http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE', headers: { Authorization: 'Bearer owner' },
  });
  await fetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        localId: 'FIXED_UID', email: 'changelog@test.local', password: 'test-password-123',
        returnSecureToken: true,
      }),
    },
  );
  await signInWithEmailAndPassword(auth, 'changelog@test.local', 'test-password-123');
  setUserId('FIXED_UID');
});

beforeEach(async () => {
  await waitForPendingWrites(db);
  await fetch(CLEAR_URL, { method: 'DELETE' });
  // 輪詢到 store 歸零(含 changelog)才放行
  for (let i = 0; ; i++) {
    const [p, s, o, cl] = await Promise.all([
      getAllProducts(), getAllSales(), getAllOutings(), getChangelog(),
    ]);
    if (!p.length && !s.length && !o.length && !cl.length) break;
    if (i > 100) throw new Error('emulator 清庫後 store 未歸零');
    await new Promise((r) => setTimeout(r, 30));
  }
});

describe('create — 新增 sale 產生一筆 changelog', () => {
  it('create action:before=null, after=sale 完整內容', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T01:00:00.000Z', outingId: 'o-1',
    });
    // 批次語意:sale 與 changelog 文件同時存在(writeBatch 保證原子性)
    const cl = await getChangelog();
    expect(cl).toHaveLength(1);
    const entry = cl[0];
    expect(entry.entity).toBe('sale');
    expect(entry.entityId).toBe(sale.id);
    expect(entry.action).toBe('create');
    expect(entry.before).toBeNull();
    expect(entry.after.id).toBe(sale.id);
    expect(entry.after.total).toBe(200);
    expect(entry.at).toBeTruthy();
    // sale 文件也存在(批次原子性)
    const sales = await getAllSales();
    expect(sales).toHaveLength(1);
  });
});

describe('update — 編輯 sale 產生一筆 changelog', () => {
  it('update action:before=舊值, after=新值', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T01:00:00.000Z', outingId: 'o-1',
    });
    await updateSale({ ...sale, total: 180, paymentMethod: 'transfer' });
    const cl = await getChangelog();
    // create + update = 2 筆
    expect(cl).toHaveLength(2);
    const updateEntry = cl.find((e) => e.action === 'update');
    expect(updateEntry).toBeDefined();
    expect(updateEntry.entityId).toBe(sale.id);
    expect(updateEntry.before.total).toBe(200);
    expect(updateEntry.before.paymentMethod).toBe('cash');
    expect(updateEntry.after.total).toBe(180);
    expect(updateEntry.after.paymentMethod).toBe('transfer');
  });
});

describe('delete — 刪除 sale 產生一筆 changelog', () => {
  it('delete action:before=舊值, after=null', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T01:00:00.000Z',
    });
    await deleteSale(sale.id);
    const cl = await getChangelog();
    const deleteEntry = cl.find((e) => e.action === 'delete');
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry.entityId).toBe(sale.id);
    expect(deleteEntry.before.id).toBe(sale.id);
    expect(deleteEntry.before.total).toBe(200);
    expect(deleteEntry.after).toBeNull();
    // sale 文件已刪除(批次原子性)
    const sales = await getAllSales();
    expect(sales).toHaveLength(0);
  });
});

describe('連續兩次 update — 各自 before/after 正確銜接', () => {
  it('第一次 update 的 after = 第二次 update 的 before', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T01:00:00.000Z',
    });
    const updated1 = await updateSale({ ...sale, total: 180 });
    await updateSale({ ...updated1, total: 150 });
    const cl = await getChangelog();
    const updates = cl.filter((e) => e.action === 'update');
    expect(updates).toHaveLength(2);
    // 依 before.total 識別哪筆是第一次(200→180)、哪筆是第二次(180→150)
    const first = updates.find((e) => e.before.total === 200);
    const second = updates.find((e) => e.before.total === 180);
    expect(first).toBeDefined();
    expect(first.after.total).toBe(180);
    expect(second).toBeDefined();
    expect(second.after.total).toBe(150);
  });
});

describe('getChangelog — 依 at 倒序', () => {
  it('三筆以 at 由新到舊排序', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T01:00:00.000Z',
    });
    await waitForPendingWrites(db);
    await new Promise((r) => setTimeout(r, 10));
    const updated = await updateSale({ ...sale, total: 180 });
    await waitForPendingWrites(db);
    await new Promise((r) => setTimeout(r, 10));
    await updateSale({ ...updated, total: 160 });
    const cl = await getChangelog();
    expect(cl.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < cl.length - 1; i++) {
      expect(cl[i].at >= cl[i + 1].at).toBe(true);
    }
  });
});

describe('批次語意:每個動作後 sale 與 changelog 同時可讀', () => {
  it('addSale 後 sale 與 changelog 文件同時存在', async () => {
    // writeBatch 保證原子性:sale + changelog 同一批提交,一起落地或一起失敗
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T01:00:00.000Z',
    });
    const [sales, cl] = await Promise.all([getAllSales(), getChangelog()]);
    expect(sales.some((s) => s.id === sale.id)).toBe(true);
    expect(cl.some((e) => e.entityId === sale.id && e.action === 'create')).toBe(true);
  });

  it('deleteSale 後 sale 不可讀、changelog delete 可讀', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T01:00:00.000Z',
    });
    await deleteSale(sale.id);
    const [sales, cl] = await Promise.all([getAllSales(), getChangelog()]);
    expect(sales.some((s) => s.id === sale.id)).toBe(false);
    expect(cl.some((e) => e.entityId === sale.id && e.action === 'delete')).toBe(true);
  });
});
