// 線上分頁:非場次(outingId===null)銷售,按月分組檢視,單筆編輯(含日期/備註)/刪除。
// 月份 key 取 dateKey 前 7 碼(YYYY-MM);月營收沿用場次同一語意(outingRevenue,只計正常銷售)。
import { getAllSales, updateSale, deleteSale } from '../db.js';
import { outingRevenue, formatMoney, paymentLabel, typeLabel, itemsSummary } from '../logic.js';
import { el } from './dom.js';
import { renderSaleEditor } from './sale-editor.js';

let container;

export async function init(viewEl) {
  container = viewEl;
  await render();
}

export async function show() {
  await render();
}

// 編輯器開著時 app.js 跳過自動重繪,避免洗掉輸入(對齊 outing.js)。
export function isBusy() {
  return !!container?.querySelector('.sale-editor');
}

function groupByMonth(sales) {
  const map = new Map();
  for (const s of sales) {
    const k = s.dateKey.slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])); // 最新月份在前
}

async function render() {
  const sales = (await getAllSales()).filter((s) => s.outingId == null);
  container.replaceChildren(el('h2', { text: '線上' }), ...renderMonths(sales));
}

function renderMonths(sales) {
  const months = groupByMonth(sales);
  if (!months.length) {
    return [el('p', { class: 'empty', text: '還沒有線上銷售紀錄。' })];
  }
  return months.map(([month, list]) => renderMonth(month, list));
}

function renderMonth(month, sales) {
  const revenue = outingRevenue(sales);
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h3', { text: month }),
      el('strong', { text: `月營收 ${formatMoney(revenue)}` }),
    ),
    el('ul', { class: 'list' }, ...sales.map(renderRow)),
  );
}

function timeOf(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function renderRow(sale) {
  const type = sale.type ?? 'sale';
  return el('li', { class: 'sale-row', dataset: { id: sale.id } },
    el('div', { class: 'sale-main' },
      el('span', { class: 'sale-time', text: timeOf(sale.createdAt) }),
      el('span', { class: 'sale-items', text: itemsSummary(sale.items) }),
      type !== 'sale' ? el('span', { class: 'badge', text: typeLabel(type) }) : null,
      el('span', { class: 'sale-method', text: paymentLabel(sale.paymentMethod) }),
      el('span', { class: 'sale-total', text: formatMoney(sale.total) }),
      sale.note ? el('span', { class: 'sale-note', text: sale.note }) : null,
    ),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn', type: 'button', text: '編輯', onClick: () => startEdit(sale) }),
      el('button', { class: 'btn danger', type: 'button', text: '刪除', onClick: () => onDelete(sale) }),
    ),
  );
}

async function onDelete(sale) {
  await deleteSale(sale.id);
  await render();
}

function startEdit(sale) {
  const li = container.querySelector(`.sale-row[data-id="${sale.id}"]`);
  const editor = renderSaleEditor({
    sale,
    showDate: true,
    onSave: async (patch) => {
      if (!patch.items.length) await deleteSale(sale.id);
      else await updateSale({ ...sale, ...patch });
      await render();
    },
    onCancel: render,
  });
  li.replaceChildren(editor);
}
