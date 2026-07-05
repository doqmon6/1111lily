// 純函式:無副作用、與框架/儲存無關,可單元測試。

const PAYMENT_LABEL = { cash: '現金', transfer: '轉帳' };

export function paymentLabel(method) {
  return PAYMENT_LABEL[method] ?? method;
}

const TYPE_LABEL = { sale: '正常銷售', gift: '贈送', replacement: '補送' };

export function typeLabel(type) {
  return TYPE_LABEL[type ?? 'sale'] ?? type;
}

/** 一筆銷售各品項加總:Σ price·qty(整數新台幣)。 */
export function computeTotal(items) {
  return items.reduce((sum, it) => sum + it.price * it.qty, 0);
}

/** 本地日期 YYYY-MM-DD(對帳/索引用,以使用者當地時區的「那一天」為準)。 */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 線上筆 createdAt 建構:選定日期(本地 YYYY-MM-DD,如 online 表單的 dateStr)
 * + now 的時分秒,以 new Date(y, m-1, d, hh, mm, ss) 本地建構,避免
 * new Date('YYYY-MM-DD') 被當 UTC 午夜的時區陷阱。dateStr 空/格式不符時回退 now。
 */
export function onlineCreatedAt(dateStr, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? '');
  if (!match) return now.toISOString();
  const [y, m, d] = [match[1], match[2], match[3]].map(Number);
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
}

/** 當日彙總:總額、筆數、各付款方式小計。 */
export function summarizeDay(sales) {
  const summary = { total: 0, count: sales.length, byMethod: { cash: 0, transfer: 0 } };
  for (const s of sales) {
    summary.total += s.total;
    if (s.paymentMethod in summary.byMethod) {
      summary.byMethod[s.paymentMethod] += s.total;
    }
  }
  return summary;
}

export function formatMoney(n) {
  return '$' + Number(n).toLocaleString('en-US');
}

/** 品項人讀彙總:單一來源,CSV / mirror / diff / UI 共用,分隔符統一 `、`。 */
export function itemsSummary(items) {
  return items.map((i) => `${i.name}×${i.qty}`).join('、');
}

// ---- 場次(outing)彙總 ----
// 交易類型:'sale'=正常銷售(計營收) | 'gift'=贈送 | 'replacement'=補送。三者都算「出貨」(扣剩餘)。

function countsAsRevenue(sale) {
  return (sale.type ?? 'sale') === 'sale';
}

/** 場次收入:只加總「正常銷售」的 total。 */
export function outingRevenue(sales) {
  return sales.reduce((sum, s) => sum + (countsAsRevenue(s) ? s.total : 0), 0);
}

/** 場次固定成本合計(攤租/交通/住宿…)。 */
export function sumFixedCosts(fixedCosts = []) {
  return fixedCosts.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}

/** 出貨商品的材料成本:所有出貨(含贈送/補送)都耗材,皆計入。成本取成交快照。 */
export function soldCost(sales) {
  return sales.reduce((sum, s) => sum + s.items.reduce((t, it) => t + (it.cost ?? 0) * it.qty, 0), 0);
}

/** 場次淨額 = 正常銷售收入 − 出貨商品成本 − 場次固定成本。 */
export function outingNet(sales, fixedCosts = []) {
  return outingRevenue(sales) - soldCost(sales) - sumFixedCosts(fixedCosts);
}

/**
 * 商品彙總:結合帶貨清單與銷售,回每個商品 { productId, name, brought, sold, remaining, revenue }。
 * - sold:所有出貨件數(含贈送/補送)。
 * - revenue:只算正常銷售。
 * - brought/remaining:沒帶貨紀錄(如現場新增)時為 null。
 */
export function productAggregate({ brought = [], sales = [], products = [] }) {
  const nameOf = new Map(products.map((p) => [p.id, p.name]));
  const rows = new Map();
  const ensure = (id, name) => {
    if (!rows.has(id)) {
      rows.set(id, { productId: id, name: name ?? nameOf.get(id) ?? '(已刪除商品)', brought: null, sold: 0, revenue: 0, cost: 0, remaining: null });
    }
    return rows.get(id);
  };
  for (const b of brought) ensure(b.productId).brought = b.broughtQty;
  for (const s of sales) {
    const rev = countsAsRevenue(s);
    for (const it of s.items) {
      const row = ensure(it.productId, it.name);
      row.sold += it.qty;
      row.cost += (it.cost ?? 0) * it.qty;
      if (rev) row.revenue += it.price * it.qty;
    }
  }
  for (const row of rows.values()) {
    if (row.brought != null) row.remaining = row.brought - row.sold;
  }
  return [...rows.values()];
}

/** 好賣排行:依賣出件數(同則依收入)由多到少。sold===0 即滯銷,由呼叫端標示。 */
export function ranking(aggregate) {
  return [...aggregate].sort((a, b) => b.sold - a.sold || b.revenue - a.revenue);
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const BOM = '﻿';

/** 銷售明細 CSV:一列一筆。欄位含場次與類型,不再放冗餘的「件數」。Excel 開繁中不亂碼。 */
export function toSalesCSV(sales, outingNameById = {}) {
  const header = ['日期', '時間', '場次', '類型', '商品明細', '總金額', '付款方式'];
  const lines = [header.map(csvCell).join(',')];
  for (const s of sales) {
    const dt = new Date(s.createdAt);
    const date = dateKey(dt);
    const time = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
    const outing = outingNameById[s.outingId] ?? '';
    const detail = itemsSummary(s.items);
    lines.push([date, time, outing, typeLabel(s.type), detail, s.total, paymentLabel(s.paymentMethod)].map(csvCell).join(','));
  }
  return BOM + lines.join('\r\n');
}

/**
 * 比對 sale 前後差異,回傳人讀描述陣列。
 * create(before=null)或 delete(after=null)時回傳空陣列。
 * 只列有變化的欄位:總金額、類型、付款方式、明細。
 */
export function saleChangeSummary(before, after) {
  if (!before || !after) return [];
  const changes = [];
  if (before.total !== after.total) {
    changes.push(`總金額 ${formatMoney(before.total)} → ${formatMoney(after.total)}`);
  }
  if ((before.type ?? 'sale') !== (after.type ?? 'sale')) {
    changes.push(`類型 ${typeLabel(before.type)} → ${typeLabel(after.type)}`);
  }
  if (before.paymentMethod !== after.paymentMethod) {
    changes.push(`付款 ${paymentLabel(before.paymentMethod)} → ${paymentLabel(after.paymentMethod)}`);
  }
  const itemsStr = (items) => itemsSummary(items ?? []);
  const bStr = itemsStr(before.items);
  const aStr = itemsStr(after.items);
  if (bStr !== aStr) {
    changes.push(`明細 ${bStr} → ${aStr}`);
  }
  return changes;
}

/** 商品彙總 CSV:一列一商品(帶量/賣出/剩餘/收入/成本),供「這場共賣幾個」快速閱覽。 */
export function toProductSummaryCSV(aggregate) {
  const header = ['商品', '帶量', '賣出', '剩餘', '收入', '成本'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of aggregate) {
    lines.push([
      r.name,
      r.brought == null ? '' : r.brought,
      r.sold,
      r.remaining == null ? '' : r.remaining,
      r.revenue,
      r.cost ?? 0,
    ].map(csvCell).join(','));
  }
  return BOM + lines.join('\r\n');
}
