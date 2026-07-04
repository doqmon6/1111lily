// Firestore 資料層:商品(products)、銷售(sales)、場次(outings)倉儲。
// 設計重點:銷售的 items 內存「品名/單價/成本快照」,商品日後改價或停售都不影響歷史對帳。
// 資料路徑:users/{uid}/products|sales|outings  文件 id = 既有 uuid。
//
// ── 架構:長駐 listener + 記憶體 store(Firestore canonical 模式)──
// 讀取不打一次性 server 查詢,而是每個 collection 掛長駐 onSnapshot,
// 資料進記憶體 store,讀取函式從 store 過濾/排序。理由:
// 1. read-your-write 確定性:一次性 getDocs 在 persistentLocalCache 下
//    不保證看到尚未 ack 的本地寫入(實測);寫入時同步樂觀更新 store 徹底解決。
// 2. 跨裝置即時:電腦分頁長開時,手機新記的帳由 listener 自動推進來。
// 3. 離線:listener 直接吐本地快取(含 pending writes),不等網路。
// 寫入採 latency compensation:打進本地快取即返回,不等伺服器 ack
// (離線時 ack 永不到,await 會把 UI 掛死)。上雲進度由 M5 pending 提醒呈現。
// 例外:importAll(遷移/還原)需確認真的上雲,維持 await 全部 ack。
import { dateKey } from './logic.js';
import { db } from './firebase.js';
import {
  doc, collection, setDoc, deleteDoc, onSnapshot, writeBatch,
} from 'firebase/firestore';

// ---- uid 注入 ----
// M2:登入後呼叫 setUserId(user.uid),所有讀寫走 users/{uid}/...。
// 未設定前任何存取都大聲失敗(security review:避免悄悄寫進看似合理的假路徑)。
let _uid = null;
export function setUserId(uid) {
  if (uid === _uid) return;
  _uid = uid;
  _teardown(); // 換人(理論上只發生在登入當下)→ 重建 listeners
}

// ---- db 注入(僅供測試 setup 使用)----
let _db = db;
export function _setDb(firestoreInstance) { _db = firestoreInstance; _teardown(); }

function requireUid() {
  if (!_uid) throw new Error('資料層尚未綁定使用者(setUserId 未呼叫)');
  return _uid;
}
function col(name) {
  return collection(_db, 'users', requireUid(), name);
}
function docRef(name, id) {
  return doc(_db, 'users', requireUid(), name, id);
}

// ---- 長駐 listeners + store ----

const COLLECTIONS = ['products', 'sales', 'outings', 'changelog'];
const TOMBSTONE = Symbol('deleted');
let stores = null;      // { products: Map<id,obj>, sales: Map, outings: Map }
let pending = null;     // 同構;值為 { entity|TOMBSTONE, seq }:未 ack 的本地寫入 overlay
let pendingDocCounts = null; // { name: number } — SDK 層 hasPendingWrites 文件數(M5「尚未上雲」)
let readyPromise = null;
let unsubs = [];
let writeSeq = 0;

function _teardown() {
  for (const u of unsubs) u();
  unsubs = [];
  stores = null;
  pending = null;
  pendingDocCounts = null;
  readyPromise = null;
}

// 測試用:重設 listeners 與 store(如 emulator 清庫後,強制下次讀取重新同步)。
export function _closeDb() { _teardown(); }

// 快照重建後,把尚未 ack 的本地寫入疊回去:
// 較舊的快照(還沒收到本地寫入 echo)不可以蓋掉較新的樂觀狀態。
function applyPending(name) {
  const m = stores[name];
  for (const [id, p] of pending[name]) {
    if (p.value === TOMBSTONE) m.delete(id);
    else m.set(id, p.value);
  }
}

// 資料變更通知:任一 collection 快照更新後呼叫(含遠端裝置的變更與本地 echo)。
// app.js 用它讓「當前分頁」自動重繪 —— 電腦分頁長開時,手機新記的帳自動出現。
const changeCallbacks = [];
export function onDataChanged(cb) { changeCallbacks.push(cb); }
function notifyChanged() { for (const cb of changeCallbacks) cb(); }

function ensureListeners() {
  if (readyPromise) return readyPromise;
  stores = Object.fromEntries(COLLECTIONS.map((n) => [n, new Map()]));
  pending = Object.fromEntries(COLLECTIONS.map((n) => [n, new Map()]));
  pendingDocCounts = Object.fromEntries(COLLECTIONS.map((n) => [n, 0]));
  readyPromise = Promise.all(COLLECTIONS.map((name) => new Promise((resolve) => {
    // includeMetadataChanges:pending→committed 的 metadata 翻轉也要觸發快照,
    // 「N 筆尚未上雲」才能在 ack 落地時歸零(M5)。
    const unsub = onSnapshot(col(name), { includeMetadataChanges: true }, (snap) => {
      const m = stores[name];
      m.clear();
      let pendingDocs = 0;
      for (const d of snap.docs) {
        m.set(d.id, d.data());
        if (d.metadata.hasPendingWrites) pendingDocs += 1;
      }
      // SDK 的 hasPendingWrites 來自持久化 mutation queue:離線重啟後仍準確,
      // 勝過記憶體 pending overlay(重啟即空)。
      pendingDocCounts[name] = pendingDocs;
      applyPending(name);
      resolve();
      notifyChanged();
    }, (err) => {
      console.error(`Firestore 監聽失敗(${name})`, err);
      resolve(); // 不讓讀取永久卡死;store 維持現狀
    });
    unsubs.push(unsub);
  })));
  return readyPromise;
}

async function all(name) {
  await ensureListeners();
  return [...stores[name].values()];
}

// M5:「N 筆尚未上雲」— 尚未收到伺服器 ack 的銷售筆數(SDK metadata,重啟後仍準)。
export async function getPendingSalesCount() {
  await ensureListeners();
  return pendingDocCounts.sales;
}

// 寫入:樂觀更新 store + pending overlay(同步、read-your-write 確定),
// fire 到 Firestore 不等 ack;ack 到且無更新的同 id 寫入時,交回快照權威
// (之後其他裝置的修改才不會被本地舊 overlay 遮蔽)。
//
// 以 ack 為 pending 清除時機的正確性論證(review 指名要求):
// Firestore SDK 的快照一律含「當下 mutation queue」的 latency compensation,
// 快照視圖單調前進、不會倒退 —— 一個「缺少某本地 mutation」的快照,
// 不可能在該 mutation 已被 SDK 接受之後才送達。因此 ack(晚於 SDK 接受)
// 之後到達的任何快照必已反映該寫入,清掉 pending 不會讓舊狀態復活。
// pending 要防的是另一件事:mutation 尚未反映進「已在途快照」時,
// 我們手動 store rebuild 與讀取之間的競態。
function track(name, id, value, promise, ctx) {
  const seq = ++writeSeq;
  pending[name].set(id, { value, seq });
  promise
    .then(() => {
      if (!pending) return; // teardown(換 uid/測試重置)後的 in-flight ack,無事可做
      const cur = pending[name].get(id);
      if (cur && cur.seq === seq) pending[name].delete(id);
    })
    .catch((err) => console.error(`Firestore 寫入失敗(${ctx})`, err));
}

function write(name, entity, ctx) {
  stores[name].set(entity.id, entity);
  track(name, entity.id, entity, setDoc(docRef(name, entity.id), entity), ctx);
}
function remove(name, id, ctx) {
  stores[name].delete(id);
  track(name, id, TOMBSTONE, deleteDoc(docRef(name, id)), ctx);
}

const byCreatedAt = (a, b) => a.createdAt.localeCompare(b.createdAt);

// ---- products ----

export async function addProduct({ name, price, cost = 0 }) {
  const product = {
    id: crypto.randomUUID(),
    name,
    price,
    cost,
    active: true,
    createdAt: new Date().toISOString(),
  };
  await ensureListeners();
  write('products', product, 'addProduct');
  return product;
}

export async function getProduct(id) {
  await ensureListeners();
  return stores.products.get(id);
}

export async function getAllProducts() {
  return (await all('products')).sort(byCreatedAt);
}

export async function getActiveProducts() {
  const all = await getAllProducts();
  return all.filter((p) => p.active);
}

export async function updateProduct(product) {
  await ensureListeners();
  write('products', product, 'updateProduct');
  return product;
}

export async function setProductActive(id, active) {
  const product = await getProduct(id);
  if (!product) return null;
  return updateProduct({ ...product, active });
}

// ---- sales ----

function makeChangelogEntry({ entityId, action, before, after }) {
  return {
    id: crypto.randomUUID(),
    entity: 'sale',
    entityId,
    action,
    before: before ?? null,
    after: after ?? null,
    at: new Date().toISOString(),
  };
}

// writeBatch 版本:sale 文件 + changelog 文件 同批提交,保證原子性。
// 兩者共用同一個 commit promise,各自呼叫 track() 維護 pending overlay 不變式。
export async function addSale({ items, total, paymentMethod, createdAt, outingId = null, type = 'sale' }) {
  const ts = createdAt ?? new Date().toISOString();
  const sale = {
    id: crypto.randomUUID(),
    items,
    total,
    paymentMethod,
    outingId,
    type,
    createdAt: ts,
    dateKey: dateKey(new Date(ts)),
  };
  const entry = makeChangelogEntry({ entityId: sale.id, action: 'create', before: null, after: sale });
  await ensureListeners();
  const batch = writeBatch(_db);
  batch.set(docRef('sales', sale.id), sale);
  batch.set(docRef('changelog', entry.id), entry);
  // 樂觀更新 store
  stores.sales.set(sale.id, sale);
  stores.changelog.set(entry.id, entry);
  const p = batch.commit();
  track('sales', sale.id, sale, p, 'addSale');
  track('changelog', entry.id, entry, p, 'addSale/changelog');
  return sale;
}

export async function updateSale(sale) {
  await ensureListeners();
  const before = stores.sales.get(sale.id) ?? null;
  const updated = { ...sale, dateKey: dateKey(new Date(sale.createdAt)) };
  const entry = makeChangelogEntry({ entityId: sale.id, action: 'update', before, after: updated });
  const batch = writeBatch(_db);
  batch.set(docRef('sales', updated.id), updated);
  batch.set(docRef('changelog', entry.id), entry);
  stores.sales.set(updated.id, updated);
  stores.changelog.set(entry.id, entry);
  const p = batch.commit();
  track('sales', updated.id, updated, p, 'updateSale');
  track('changelog', entry.id, entry, p, 'updateSale/changelog');
  return updated;
}

export async function deleteSale(id) {
  await ensureListeners();
  const before = stores.sales.get(id) ?? null;
  const entry = makeChangelogEntry({ entityId: id, action: 'delete', before, after: null });
  const batch = writeBatch(_db);
  batch.delete(docRef('sales', id));
  batch.set(docRef('changelog', entry.id), entry);
  stores.sales.delete(id);
  stores.changelog.set(entry.id, entry);
  const p = batch.commit();
  track('sales', id, TOMBSTONE, p, 'deleteSale');
  track('changelog', entry.id, entry, p, 'deleteSale/changelog');
}

export async function getSalesByDate(key) {
  return (await all('sales')).filter((s) => s.dateKey === key).sort(byCreatedAt);
}

export async function getSalesByOuting(outingId) {
  return (await all('sales')).filter((s) => s.outingId === outingId).sort(byCreatedAt);
}

export async function getAllSales() {
  return (await all('sales')).sort(byCreatedAt);
}

// ---- outings(場次)----

export async function addOuting({ name, fixedCosts = [], brought = [], status = 'open' }) {
  const outing = {
    id: crypto.randomUUID(),
    name,
    status,
    fixedCosts,
    brought,
    startedAt: new Date().toISOString(),
    closedAt: status === 'closed' ? new Date().toISOString() : null,
  };
  await ensureListeners();
  write('outings', outing, 'addOuting');
  return outing;
}

export async function getOuting(id) {
  await ensureListeners();
  return stores.outings.get(id);
}

export async function getAllOutings() {
  return (await all('outings')).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function updateOuting(outing) {
  await ensureListeners();
  write('outings', outing, 'updateOuting');
  return outing;
}

export async function getOpenOuting() {
  const all = await getAllOutings();
  return all.find((o) => o.status === 'open') ?? null;
}

export async function closeOuting(id) {
  const outing = await getOuting(id);
  if (!outing) return null;
  return updateOuting({ ...outing, status: 'closed', closedAt: new Date().toISOString() });
}

// ---- changelog 查詢 ----

// 回傳全部 changelog 依 at 倒序(最新在前)。
export async function getChangelog() {
  return (await all('changelog')).sort((a, b) => b.at.localeCompare(a.at));
}

// ---- 備份 / 還原(完整資料,供換機/防遺失)----

export async function exportAll() {
  const [products, sales, outings] = await Promise.all([getAllProducts(), getAllSales(), getAllOutings()]);
  return { products, sales, outings };
}

// 還原 = upsert:以既有 uuid 為文件 id set(),冪等,不清空既有雲端資料。
// 遷移/還原需確認資料真的上雲,故等全部 ack(在交接/換機時執行,當下有網路)。
export async function importAll({ products = [], sales = [], outings = [] }) {
  await ensureListeners();
  const entries = [
    ...products.map((p) => ['products', p]),
    ...sales.map((s) => ['sales', s]),
    ...outings.map((o) => ['outings', o]),
  ];
  // 與一般寫入走同一條 track() 路徑維護 pending overlay 不變式(review 修正),
  // 另外保留原始 promise 供本函式 await 全部 ack(遷移/還原需確認真的上雲)。
  const acks = entries.map(([name, entity]) => {
    stores[name].set(entity.id, entity);
    const p = setDoc(docRef(name, entity.id), entity);
    track(name, entity.id, entity, p, 'importAll');
    return p;
  });
  await Promise.all(acks);
}

const LEGACY_OUTING_NAME = '舊紀錄';

// v1 → v2 一次性遷移:把沒有場次的舊銷售歸入一個已關閉的「舊紀錄」場次,讓場次報表一致。
// 冪等:沒有孤兒銷售時不做任何事。
export async function ensureMigrated() {
  const sales = await getAllSales();
  const orphans = sales.filter((s) => !s.outingId);
  if (!orphans.length) return null;
  const outings = await getAllOutings();
  let legacy = outings.find((o) => o.name === LEGACY_OUTING_NAME);
  if (!legacy) legacy = await addOuting({ name: LEGACY_OUTING_NAME, status: 'closed' });
  for (const s of orphans) {
    await updateSale({ ...s, outingId: legacy.id, type: s.type ?? 'sale' });
  }
  return legacy;
}
