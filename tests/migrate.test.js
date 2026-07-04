// migrate.test.js — M3 資料遷移:JSON 備份匯入 Firestore(upsert 冪等)。
// 執行方式:npm run test:emulator。
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { waitForPendingWrites } from 'firebase/firestore';
import { app, db } from '../js/firebase.js';
import { RULES_UID } from './rules-uid.js';
import {
  importAll, exportAll, addSale, getAllProducts, getAllSales, getAllOutings, setUserId,
} from '../js/db.js';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
const AUTH_EMULATOR_HOST = 'localhost:9099';
const PROJECT_ID = 'demo-market-sales';
const CLEAR_URL = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// v2 JSON 備份檔 fixture(形狀對齊 exporter.js backupJSON 輸出)
const FIXTURE = {
  app: 'market-sales',
  version: 2,
  exportedAt: '2026-07-03T12:00:00.000Z',
  products: [
    { id: 'p-1', name: '手鍊', price: 100, cost: 40, active: true, createdAt: '2026-07-01T01:00:00.000Z' },
    { id: 'p-2', name: '耳環', price: 150, cost: 0, active: false, createdAt: '2026-07-01T02:00:00.000Z' },
  ],
  sales: [
    {
      id: 's-1', outingId: 'o-1', type: 'sale', paymentMethod: 'cash', total: 200,
      items: [{ productId: 'p-1', name: '手鍊', price: 100, cost: 40, qty: 2 }],
      createdAt: '2026-07-03T03:00:00.000Z', dateKey: '2026-07-03',
    },
    {
      id: 's-2', outingId: 'o-1', type: 'gift', paymentMethod: 'cash', total: 100,
      items: [{ productId: 'p-1', name: '手鍊', price: 100, cost: 40, qty: 1 }],
      createdAt: '2026-07-03T04:00:00.000Z', dateKey: '2026-07-03',
    },
  ],
  outings: [
    {
      id: 'o-1', name: '四天展', status: 'open',
      fixedCosts: [{ label: '攤租', amount: 2000 }],
      brought: [{ productId: 'p-1', broughtQty: 30 }],
      startedAt: '2026-07-03T00:00:00.000Z', closedAt: null,
    },
  ],
};

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
      body: JSON.stringify({ localId: RULES_UID, email: 'migrate@test.local', password: 'test-password-123', returnSecureToken: true }),
    },
  );
  await signInWithEmailAndPassword(auth, 'migrate@test.local', 'test-password-123');
  setUserId(RULES_UID);
});

beforeEach(async () => {
  await waitForPendingWrites(db);
  await fetch(CLEAR_URL, { method: 'DELETE' });
  for (let i = 0; ; i++) {
    const [p, s, o] = await Promise.all([getAllProducts(), getAllSales(), getAllOutings()]);
    if (!p.length && !s.length && !o.length) break;
    if (i > 100) throw new Error('emulator 清庫後 store 未歸零');
    await new Promise((r) => setTimeout(r, 30));
  }
});

describe('JSON 備份匯入(AC9)', () => {
  it('匯入後三 collection 筆數與內容正確', async () => {
    await importAll(FIXTURE);
    const [products, sales, outings] = await Promise.all([getAllProducts(), getAllSales(), getAllOutings()]);
    expect(products).toHaveLength(2);
    expect(sales).toHaveLength(2);
    expect(outings).toHaveLength(1);
    expect(products.find((p) => p.id === 'p-1').cost).toBe(40);
    expect(sales.find((s) => s.id === 's-2').type).toBe('gift');
    expect(outings[0].brought[0].broughtQty).toBe(30);
  });

  it('冪等:匯入兩次結果相同,不產生重複文件', async () => {
    await importAll(FIXTURE);
    await importAll(FIXTURE);
    expect(await getAllProducts()).toHaveLength(2);
    expect(await getAllSales()).toHaveLength(2);
    expect(await getAllOutings()).toHaveLength(1);
  });

  it('匯入後新增一筆再重匯:新筆仍在(不清空既有資料)', async () => {
    await importAll(FIXTURE);
    await addSale({
      items: [{ productId: 'p-1', name: '手鍊', price: 100, cost: 40, qty: 1 }],
      total: 100, paymentMethod: 'transfer', outingId: 'o-1', createdAt: '2026-07-04T05:00:00.000Z',
    });
    await importAll(FIXTURE);
    expect(await getAllSales()).toHaveLength(3);
  });

  it('匯入等到全部 ack:落地後 exportAll 完整往返', async () => {
    await importAll(FIXTURE);
    await waitForPendingWrites(db);
    const round = await exportAll();
    expect(round.products).toHaveLength(2);
    expect(round.sales).toHaveLength(2);
    expect(round.outings).toHaveLength(1);
    // 往返內容一致(以 id 對齊)
    expect(round.sales.find((s) => s.id === 's-1').total).toBe(200);
  });
});
