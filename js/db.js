// IndexedDB 資料層:商品(products)與銷售(sales)倉儲。
// 設計重點:銷售的 items 內存「品名/單價快照」,商品日後改價或停售都不影響歷史對帳。
import { dateKey } from './logic.js';

const DB_NAME = 'market-sales-db';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sales')) {
        const sales = db.createObjectStore('sales', { keyPath: 'id' });
        sales.createIndex('dateKey', 'dateKey', { unique: false });
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

export async function addProduct({ name, price }) {
  const db = await openDB();
  const product = { id: crypto.randomUUID(), name, price, active: true, createdAt: new Date().toISOString() };
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

export async function addSale({ items, total, paymentMethod, createdAt }) {
  const db = await openDB();
  const ts = createdAt ?? new Date().toISOString();
  const sale = {
    id: crypto.randomUUID(),
    items,
    total,
    paymentMethod,
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

export async function getAllSales() {
  const db = await openDB();
  const all = await reqToPromise(store(db, 'sales', 'readonly').getAll());
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
