// mirror.test.js — M6 Sheets 鏡像(Firestore Emulator + fetch mock)。
// 執行方式:npm run test:emulator (包含本檔)。
// setup 模式抄 changelog.test.js:Auth emulator FIXED_UID + beforeEach 清庫歸零。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { waitForPendingWrites } from 'firebase/firestore';
import { app, db } from '../js/firebase.js';
import {
  addSale, updateSale, deleteSale, getAllSales, getAllProducts, getAllOutings,
  getChangelog, setUserId, _closeDb,
} from '../js/db.js';
import { _setUrl, initMirror } from '../js/mirror.js';

// ─── localStorage shim ───
if (typeof globalThis.localStorage === 'undefined') {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

const QUEUE_KEY = 'market-sales:mirror-queue';
const MIRROR_URL = 'https://mirror.test/hook';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
const AUTH_EMULATOR_HOST = 'localhost:9099';
const PROJECT_ID = 'demo-market-sales';
const CLEAR_URL = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const ITEM = { productId: 'p-1', name: '娃娃', price: 200, cost: 50, qty: 1 };

// ─── fetch mock ───
// URL 為 MIRROR_URL → 走 mock(可控成功/失敗、記錄 payload)。
// 其餘(emulator REST) → 透傳原生 fetch。
const _nativeFetch = globalThis.fetch;
let mockResult = { ok: true, status: 200 };
const capturedPayloads = [];

function resetMockFetch() {
  mockResult = { ok: true, status: 200 };
  capturedPayloads.length = 0;
}

globalThis.fetch = async (url, opts) => {
  if (String(url) === MIRROR_URL) {
    capturedPayloads.push(JSON.parse(opts?.body ?? '{}'));
    if (mockResult.ok) {
      return { ok: true, status: 200 };
    }
    return { ok: false, status: 500 };
  }
  return _nativeFetch(url, opts);
};

// ─── Auth + emulator 清庫 setup ───

beforeAll(async () => {
  const auth = getAuth(app);
  await _nativeFetch(`http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE', headers: { Authorization: 'Bearer owner' },
  });
  await _nativeFetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        localId: 'FIXED_UID', email: 'mirror@test.local', password: 'test-password-mirror',
        returnSecureToken: true,
      }),
    },
  );
  await signInWithEmailAndPassword(auth, 'mirror@test.local', 'test-password-mirror');
  setUserId('FIXED_UID');
});

beforeEach(async () => {
  await waitForPendingWrites(db);
  await _nativeFetch(CLEAR_URL, { method: 'DELETE' });
  // 輪詢到 store 歸零
  for (let i = 0; ; i++) {
    const [p, s, o, cl] = await Promise.all([
      getAllProducts(), getAllSales(), getAllOutings(), getChangelog(),
    ]);
    if (!p.length && !s.length && !o.length && !cl.length) break;
    if (i > 100) throw new Error('emulator 清庫後 store 未歸零');
    await new Promise((r) => setTimeout(r, 30));
  }
  // 重設 mirror URL + mock 狀態 + localStorage 佇列
  _setUrl(MIRROR_URL);
  resetMockFetch();
  localStorage.removeItem(QUEUE_KEY);
});

afterEach(() => {
  localStorage.removeItem(QUEUE_KEY);
});

// ─── 輔助:等 onSaleWritten 觸發後 flush 完成 ───
// onSaleWritten 在 batch ack 後呼叫,flush 是 async。
// 等待方式:waitForPendingWrites 確保 ack 到,再短暫 yield 讓 flush 完成。
async function waitForMirrorFlush() {
  await waitForPendingWrites(db);
  // 給 flush async chain 一個 microtask 輪次
  await new Promise((r) => setTimeout(r, 50));
}

// ─── 案例 1:addSale → payload 欄位正確 ───
describe('案例1:addSale → flush 後 payload 欄位正確', () => {
  it('欄位正確且佇列清空', async () => {
    // 用固定 ISO 字串,但 date/time 依 salePayload 的本地時間換算(與 toSalesCSV 一致)
    const createdAt = '2026-07-04T10:30:00.000Z';
    const dt = new Date(createdAt);
    const expectedDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const expectedTime = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt, outingId: null, type: 'sale',
    });
    await waitForMirrorFlush();

    expect(capturedPayloads).toHaveLength(1);
    const payload = capturedPayloads[0];
    expect(payload.id).toBe(sale.id);
    expect(payload.date).toBe(expectedDate);
    expect(payload.time).toBe(expectedTime);
    expect(payload.type).toBe('正常銷售');
    expect(payload.items).toBe('娃娃×1');
    expect(payload.total).toBe(200);
    expect(payload.payment).toBe('現金');
    expect(payload.deleted).toBe(false);
    expect(payload.outing).toBe('');

    // 佇列清空
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}');
    expect(Object.keys(q)).toHaveLength(0);
  });
});

// ─── 案例 2:updateSale(改 type gift) → payload type=贈送(upsert 語意) ───
describe('案例2:updateSale → payload type=贈送', () => {
  it('type 欄位為中文 label', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T10:30:00.000Z', outingId: null, type: 'sale',
    });
    await waitForMirrorFlush();
    capturedPayloads.length = 0; // 清掉 addSale 的

    await updateSale({ ...sale, type: 'gift' });
    await waitForMirrorFlush();

    expect(capturedPayloads).toHaveLength(1);
    expect(capturedPayloads[0].type).toBe('贈送');
    expect(capturedPayloads[0].deleted).toBe(false);
  });
});

// ─── 案例 3:deleteSale → payload {id, deleted:true} ───
describe('案例3:deleteSale → payload {id, deleted:true}', () => {
  it('payload 只含 id 與 deleted:true', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T10:30:00.000Z',
    });
    await waitForMirrorFlush();
    capturedPayloads.length = 0;

    await deleteSale(sale.id);
    await waitForMirrorFlush();

    expect(capturedPayloads).toHaveLength(1);
    const payload = capturedPayloads[0];
    expect(payload.id).toBe(sale.id);
    expect(payload.deleted).toBe(true);
    // 其他欄位不需要(僅 {id, deleted:true})
    expect(Object.keys(payload).sort()).toEqual(['deleted', 'id'].sort());
  });
});

// ─── 案例 4:mock 失敗 → 佇列保留;改成功後 flush → 送出最新狀態且佇列清空 ───
describe('案例4:fetch 失敗 → 佇列保留;成功 → 送出並清空', () => {
  it('失敗不 throw,佇列保留;再 flush 成功後清空', async () => {
    mockResult = { ok: false, status: 500 };

    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T10:30:00.000Z', type: 'sale',
    });
    await waitForMirrorFlush();

    // 失敗:佇列應保留該 id
    const qFail = JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}');
    expect(qFail[sale.id]).toBeDefined();
    expect(qFail[sale.id].deleted).toBe(false);

    // 切換 mock 為成功後再更新 sale(確保重送取最新狀態)
    mockResult = { ok: true, status: 200 };
    // 直接 import flush — 透過 initMirror 已掛 onSaleWritten,但此處改 type 後 flush 也會帶出
    // 為驗「重送取最新狀態」:先手動改 type,然後觸發 flush
    await updateSale({ ...sale, type: 'gift' });
    await waitForMirrorFlush();

    // 最終 payload 的 type 應為最新狀態
    const latest = capturedPayloads[capturedPayloads.length - 1];
    expect(latest.type).toBe('贈送');
    // 佇列清空
    const qOk = JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}');
    expect(Object.keys(qOk)).toHaveLength(0);
  });
});

// ─── 案例 6:入列不綁 ack —— 未等 ack 即已入列+送出(review BLOCKER 修正)───
// 對應真實場景:離線記帳後關 App。入列若綁 commit ack,該筆永遠不會進佇列。
describe('案例6:寫入當下即入列,不等 Firestore ack', () => {
  it('addSale 後立即(不 waitForPendingWrites)payload 已送出或已在佇列', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T10:30:00.000Z',
    });
    // 不等 ack:輪詢「已送出 或 已入列」——兩者之一必須立刻成立
    for (let i = 0; ; i++) {
      const sent = capturedPayloads.some((p) => p.id === sale.id);
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}');
      if (sent || q[sale.id]) break;
      if (i > 50) throw new Error('寫入後既未送出也未入列(入列被綁在 ack 上)');
      await new Promise((r) => setTimeout(r, 10));
    }
  });
});

// ─── 案例 7:佇列跨重啟 —— 殘留佇列由 initMirror 撈回送出(review MAJOR 修正)───
describe('案例7:重開 App 後 initMirror 重送殘留佇列', () => {
  it('手動塞佇列(模擬上次 session 殘留)→ initMirror → 送出且清空', async () => {
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T10:30:00.000Z', type: 'gift',
    });
    await waitForMirrorFlush();
    capturedPayloads.length = 0;
    // 模擬「上次 session 入列但沒送出去」:直接塞佇列
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ [sale.id]: { deleted: false } }));

    initMirror(); // 重開 App 的入口
    await new Promise((r) => setTimeout(r, 100));

    expect(capturedPayloads.some((p) => p.id === sale.id && p.type === '贈送')).toBe(true);
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}');
    expect(Object.keys(q)).toHaveLength(0);
  });
});

// ─── 案例 5:URL=null → 完全 no-op ───
describe('案例5:URL=null → no-op', () => {
  it('fetch 不被呼叫', async () => {
    _setUrl(null);
    const sale = await addSale({
      items: [ITEM], total: 200, paymentMethod: 'cash',
      createdAt: '2026-07-04T10:30:00.000Z',
    });
    await waitForMirrorFlush();

    expect(capturedPayloads).toHaveLength(0);
  });
});
