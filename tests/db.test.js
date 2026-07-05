// db.test.js — 連 Firestore Emulator。
// 執行方式:npm run test:emulator(emulators:exec 自動注入 FIRESTORE_EMULATOR_HOST)。
// M2 後 firestore.rules 鎖定 UID;本檔在 Auth emulator 以 admin API 建立
// localId='FIXED_UID' 的帳號並登入 —— uid 正好等於 rules 的佔位字面值,
// 讓資料層測試跑在「部署那份 rules」之下。rules 的 allow/deny 矩陣由 rules.test.js 負責。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { waitForPendingWrites } from 'firebase/firestore';
import { app, db } from '../js/firebase.js';
import { dateKey } from '../js/logic.js';
import { RULES_UID } from './rules-uid.js';
import {
  addProduct, getAllProducts, getActiveProducts, setProductActive, getProduct, updateProduct,
  addSale, getSale, getSalesByDate, getSalesByOuting, getAllSales, updateSale, deleteSale, _closeDb,
  addOuting, getAllOutings, getOpenOuting, closeOuting,
  setUserId,
} from '../js/db.js';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
const AUTH_EMULATOR_HOST = 'localhost:9099';
const PROJECT_ID = 'demo-market-sales';
const CLEAR_URL = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_CLEAR_URL = `http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`;

// Auth emulator 中,Bearer token 只要非空字串即被視為 admin mode
// 這讓 /v1/projects/{id}/accounts POST 允許指定 localId
const FAKE_ADMIN_BEARER = 'owner';
const DB_TEST_UID = RULES_UID;
const DB_TEST_EMAIL = 'dbtest@test.local';
const DB_TEST_PASSWORD = 'test-password-123';

let auth;

beforeAll(async () => {
  // Auth emulator 連線由 js/firebase.js 依 FIREBASE_AUTH_EMULATOR_HOST 完成,這裡直接取用
  auth = getAuth(app);

  // 清空 Auth emulator 所有帳號(admin mode:Bearer 任意非空字串)
  await fetch(AUTH_CLEAR_URL, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${FAKE_ADMIN_BEARER}` },
  });

  // 用 admin mode 在 Auth emulator 建立指定 UID 的帳號
  // Authorization: Bearer <任意非空字串> 在 emulator 被視為 Oauth2 admin
  const createRes = await fetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FAKE_ADMIN_BEARER}`,
      },
      body: JSON.stringify({
        localId: DB_TEST_UID,
        email: DB_TEST_EMAIL,
        password: DB_TEST_PASSWORD,
        returnSecureToken: true,
      }),
    },
  );
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Auth emulator 建立帳號失敗:${createRes.status} ${text}`);
  }

  // 以 client SDK 登入
  const cred = await signInWithEmailAndPassword(auth, DB_TEST_EMAIL, DB_TEST_PASSWORD);
  console.log('登入成功,uid:', cred.user.uid);
  setUserId(DB_TEST_UID);
});

afterAll(() => {});

beforeEach(async () => {
  // 先等前一個 test 的未 ack 寫入落地(db.js 寫入採 latency compensation 不等 ack),
  // 再清空 emulator。清庫後「不要」重建 listener(重建會從快取種子讀到清庫前的鬼影),
  // 而是讓活著的 listener 收到刪除事件,輪詢到 store 歸零才放行。
  await waitForPendingWrites(db);
  setUserId(DB_TEST_UID);
  await fetch(CLEAR_URL, { method: 'DELETE' });
  for (let i = 0; ; i++) {
    const [p, s, o] = await Promise.all([getAllProducts(), getAllSales(), getAllOutings()]);
    if (!p.length && !s.length && !o.length) break;
    if (i > 100) throw new Error('emulator 清庫後 store 未歸零');
    await new Promise((r) => setTimeout(r, 30));
  }
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

describe('pending overlay(未 ack 寫入的 read-your-write)', () => {
  it('連續快寫同一筆:新增→更新→再更新,讀取永遠是最後狀態', async () => {
    const p = await addProduct({ name: '快寫', price: 10 });
    await updateProduct({ ...p, price: 20 });
    await updateProduct({ ...p, price: 30 });
    expect((await getProduct(p.id)).price).toBe(30);
    // 等 ack 落地後(快照接管)仍是最後狀態
    await waitForPendingWrites(db);
    await new Promise((r) => setTimeout(r, 50));
    expect((await getProduct(p.id)).price).toBe(30);
  });

  it('寫後立刪:讀取立即消失,ack 落地後不復活', async () => {
    const s = await addSale({ items: [], total: 5, paymentMethod: 'cash', createdAt: '2026-05-30T01:00:00.000Z' });
    await deleteSale(s.id);
    expect(await getAllSales()).toHaveLength(0);
    await waitForPendingWrites(db);
    await new Promise((r) => setTimeout(r, 50));
    expect(await getAllSales()).toHaveLength(0);
  });

  it('刪後重建同 id:讀取為新內容', async () => {
    const p = await addProduct({ name: '舊', price: 10 });
    await waitForPendingWrites(db);
    await updateProduct({ ...p, name: '刪前' });
    // 模擬刪後重建(同 id upsert)
    const rebuilt = { ...p, name: '重建', price: 99 };
    await updateProduct(rebuilt);
    expect((await getProduct(p.id)).name).toBe('重建');
    await waitForPendingWrites(db);
    await new Promise((r) => setTimeout(r, 50));
    expect((await getProduct(p.id)).name).toBe('重建');
    expect((await getProduct(p.id)).price).toBe(99);
  });
});

describe('線上筆(outingId: null)', () => {
  it('讀取後仍為 null,不被歸入其他場次(無 v1→v2 遷移)', async () => {
    const s = await addSale({
      items: [{ productId: 'p', name: '線上商品', price: 100, qty: 1 }],
      total: 100, paymentMethod: 'transfer', outingId: null,
      createdAt: '2026-05-01T01:00:00.000Z',
    });
    expect(s.outingId).toBeNull();
    expect((await getSale(s.id)).outingId).toBeNull();
    expect(await getAllOutings()).toHaveLength(0);
  });
});

describe('note 欄位', () => {
  it('addSale 帶 note,讀回原值', async () => {
    const s = await addSale({
      items: [], total: 0, paymentMethod: 'cash', createdAt: '2026-05-30T01:00:00.000Z',
      note: 'IG @foo',
    });
    expect(s.note).toBe('IG @foo');
    const got = await getSale(s.id);
    expect(got.note).toBe('IG @foo');
  });

  it('不給 note 讀回空字串', async () => {
    const s = await addSale({ items: [], total: 0, paymentMethod: 'cash', createdAt: '2026-05-30T01:00:00.000Z' });
    expect(s.note).toBe('');
  });
});
