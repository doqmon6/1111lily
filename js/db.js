// IndexedDB 資料層:商品(products)、銷售(sales)、場次(outings)倉儲。
// 設計重點:銷售的 items 內存「品名/單價/成本快照」,商品日後改價或停售都不影響歷史對帳。
import { dateKey } from './logic.js';

const DB_NAME = 'market-sales-db';
const DB_VERSION = 2;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction; // versionchange 交易,用來改既有 store
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sales')) {
        const sales = db.createObjectStore('sales', { keyPath: 'id' });
        sales.createIndex('dateKey', 'dateKey', { unique: false });
        sales.createIndex('outingId', 'outingId', { unique: false });
      } else {
        // v1 → v2:既有 sales 補上 outingId 索引(舊紀錄無此鍵,不會進索引,待 backfill)。
        const sales = tx.objectStore('sales');
        if (!sales.indexNames.contains('outingId')) {
          sales.createIndex('outingId', 'outingId', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains('outings')) {
        db.createObjectStore('outings', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// 測試用:清除快取連線,讓下一次 openDB 對新的 indexedDB 工廠重新開啟。
export function _closeDb() {
  dbPromise = null;
}

function store(db, name, mode) {
  return db.transaction(name, mode).objectStore(name);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- products ----

export async function addProduct({ name, price, cost = 0 }) {
  const db = await openDB();
  const product = { id: crypto.randomUUID(), name, price, cost, active: true, createdAt: new Date().toISOString() };
  await reqToPromise(store(db, 'products', 'readwrite').add(product));
  return product;
}

export async function getProduct(id) {
  const db = await openDB();
  return reqToPromise(store(db, 'products', 'readonly').get(id));
}

export async function getAllProducts() {
  const db = await openDB();
  const all = await reqToPromise(store(db, 'products', 'readonly').getAll());
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getActiveProducts() {
  const all = await getAllProducts();
  return all.filter((p) => p.active);
}

export async function updateProduct(product) {
  const db = await openDB();
  await reqToPromise(store(db, 'products', 'readwrite').put(product));
  return product;
}

export async function setProductActive(id, active) {
  const product = await getProduct(id);
  if (!product) return null;
  product.active = active;
  return updateProduct(product);
}

// ---- sales ----

export async function addSale({ items, total, paymentMethod, createdAt, outingId = null, type = 'sale' }) {
  const db = await openDB();
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
  await reqToPromise(store(db, 'sales', 'readwrite').add(sale));
  return sale;
}

export async function updateSale(sale) {
  const db = await openDB();
  const updated = { ...sale, dateKey: dateKey(new Date(sale.createdAt)) };
  await reqToPromise(store(db, 'sales', 'readwrite').put(updated));
  return updated;
}

export async function deleteSale(id) {
  const db = await openDB();
  await reqToPromise(store(db, 'sales', 'readwrite').delete(id));
}

export async function getSalesByDate(key) {
  const db = await openDB();
  const index = store(db, 'sales', 'readonly').index('dateKey');
  const list = await reqToPromise(index.getAll(IDBKeyRange.only(key)));
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getSalesByOuting(outingId) {
  const db = await openDB();
  const index = store(db, 'sales', 'readonly').index('outingId');
  const list = await reqToPromise(index.getAll(IDBKeyRange.only(outingId)));
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getAllSales() {
  const db = await openDB();
  const all = await reqToPromise(store(db, 'sales', 'readonly').getAll());
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ---- outings(場次)----

export async function addOuting({ name, fixedCosts = [], brought = [], status = 'open' }) {
  const db = await openDB();
  const outing = {
    id: crypto.randomUUID(),
    name,
    status,
    fixedCosts,
    brought,
    startedAt: new Date().toISOString(),
    closedAt: status === 'closed' ? new Date().toISOString() : null,
  };
  await reqToPromise(store(db, 'outings', 'readwrite').add(outing));
  return outing;
}

export async function getOuting(id) {
  const db = await openDB();
  return reqToPromise(store(db, 'outings', 'readonly').get(id));
}

export async function getAllOutings() {
  const db = await openDB();
  const all = await reqToPromise(store(db, 'outings', 'readonly').getAll());
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function updateOuting(outing) {
  const db = await openDB();
  await reqToPromise(store(db, 'outings', 'readwrite').put(outing));
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

// ---- 備份 / 還原(完整資料,供換機/防遺失)----

export async function exportAll() {
  const [products, sales, outings] = await Promise.all([getAllProducts(), getAllSales(), getAllOutings()]);
  return { products, sales, outings };
}

// 還原 = 以備份覆蓋:單一交易內清空三個 store 再寫入,確保原子性。
export async function importAll({ products = [], sales = [], outings = [] }) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['products', 'sales', 'outings'], 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    const ps = tx.objectStore('products');
    const ss = tx.objectStore('sales');
    const os = tx.objectStore('outings');
    ps.clear(); ss.clear(); os.clear();
    for (const p of products) ps.put(p);
    for (const s of sales) ss.put(s);
    for (const o of outings) os.put(o);
  });
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
