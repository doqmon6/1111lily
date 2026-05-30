// 純函式:無副作用、與框架/儲存無關,可單元測試。

const PAYMENT_LABEL = { cash: '現金', transfer: '轉帳' };

export function paymentLabel(method) {
  return PAYMENT_LABEL[method] ?? method;
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

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 銷售匯出為 CSV(UTF-8 BOM,一列一筆銷售)。Excel 開繁中不亂碼。 */
export function toCSV(sales) {
  const BOM = '﻿';
  const header = ['日期', '時間', '商品明細', '件數', '總金額', '付款方式'];
  const lines = [header.map(csvCell).join(',')];
  for (const s of sales) {
    const dt = new Date(s.createdAt);
    const date = dateKey(dt);
    const time = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
    const detail = s.items.map((it) => `${it.name}×${it.qty}`).join('; ');
    const qty = s.items.reduce((n, it) => n + it.qty, 0);
    lines.push([date, time, detail, qty, s.total, paymentLabel(s.paymentMethod)].map(csvCell).join(','));
  }
  return BOM + lines.join('\r\n');
}
