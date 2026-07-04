// Firestore 資料層:商品(products)、銷售(sales)、場次(outings)倉儲。
// 設計重點:銷售的 items 內存「品名/單價/成本快照」,商品日後改價或停售都不影響歷史對帳。
// 資料路徑:users/{uid}/products|sales|outings  文件 id = 既有 uuid。
// M1 階段 uid 用常數 'dev';M2 接真 Auth 後呼叫 setUserId(user.uid) 一行替換。
import { dateKey } from './logic.js';
import { db } from './firebase.js';
import {
  doc, collection, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where, orderBy,
} from 'firebase/firestore';

// ---- uid 注入 ----
// M2: 將 setUserId(user.uid) 替換此常數,之後所有讀寫自動走正確路徑。
export const DEFAULT_UID = 'dev';
let _uid = DEFAULT_UID;
export function setUserId(uid) { _uid = uid; }

function col(name) {
  return collection(db, 'users', _uid, name);
}
function docRef(name, id) {
  return doc(db, 'users', _uid, name, id);
}

// 測試用 no-op:IndexedDB 版需要重設連線,Firestore 版無需處理。
export function _closeDb() {}

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
  await setDoc(docRef('products', product.id), product);
  return product;
}

export async function getProduct(id) {
  const snap = await getDoc(docRef('products', id));
  return snap.exists() ? snap.data() : undefined;
}

export async function getAllProducts() {
  const snap = await getDocs(query(col('products'), orderBy('createdAt')));
  return snap.docs.map((d) => d.data());
}

export async function getActiveProducts() {
  const all = await getAllProducts();
  return all.filter((p) => p.active);
}

export async function updateProduct(product) {
  await setDoc(docRef('products', product.id), product);
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
  await setDoc(docRef('sales', sale.id), sale);
  return sale;
}

export async function updateSale(sale) {
  const updated = { ...sale, dateKey: dateKey(new Date(sale.createdAt)) };
  await setDoc(docRef('sales', updated.id), updated);
  return updated;
}

export async function deleteSale(id) {
  await deleteDoc(docRef('sales', id));
}

export async function getSalesByDate(key) {
  const snap = await getDocs(
    query(col('sales'), where('dateKey', '==', key), orderBy('createdAt'))
  );
  return snap.docs.map((d) => d.data());
}

export async function getSalesByOuting(outingId) {
  const snap = await getDocs(
    query(col('sales'), where('outingId', '==', outingId), orderBy('createdAt'))
  );
  return snap.docs.map((d) => d.data());
}

export async function getAllSales() {
  const snap = await getDocs(query(col('sales'), orderBy('createdAt')));
  return snap.docs.map((d) => d.data());
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
  await setDoc(docRef('outings', outing.id), outing);
  return outing;
}

export async function getOuting(id) {
  const snap = await getDoc(docRef('outings', id));
  return snap.exists() ? snap.data() : undefined;
}

export async function getAllOutings() {
  const snap = await getDocs(query(col('outings'), orderBy('startedAt', 'desc')));
  return snap.docs.map((d) => d.data());
}

export async function updateOuting(outing) {
  await setDoc(docRef('outings', outing.id), outing);
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

// 還原 = upsert:以既有 uuid 為文件 id set(),冪等,不清空既有雲端資料。
// M3 遷移升級此語意,M1 已對齊。
export async function importAll({ products = [], sales = [], outings = [] }) {
  const writes = [
    ...products.map((p) => setDoc(docRef('products', p.id), p)),
    ...sales.map((s) => setDoc(docRef('sales', s.id), s)),
    ...outings.map((o) => setDoc(docRef('outings', o.id), o)),
  ];
  await Promise.all(writes);
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
