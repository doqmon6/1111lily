// 場次(出攤)分頁:開始/關閉場次、設定帶貨與固定成本,並呈現整場報表
// (收入 / 每日分計 / 商品彙總帶·賣·剩 / 好賣排行 / 淨額 / 特例),可編輯或刪除單筆銷售。
import {
  addOuting, getAllOutings, getOuting, getOpenOuting, closeOuting, updateOuting,
  getSalesByOuting, getActiveProducts, getAllProducts, updateSale, deleteSale,
} from '../db.js';
import {
  summarizeDay, soldCost, sumFixedCosts, outingNet,
  productAggregate, ranking, computeTotal, formatMoney, paymentLabel, typeLabel, dateKey,
} from '../logic.js';
import { el } from './dom.js';

const FIXED_LABELS = ['攤租', '交通', '住宿'];

let container;
let selectedId = null;

export async function init(viewEl) {
  container = viewEl;
  await render();
}

export async function show() {
  await render();
}

// 使用者互動中(場次表單或單筆編輯器開著)→ app.js 跳過自動重繪,避免洗掉輸入。
export function isBusy() {
  return !!container?.querySelector('#outing-form form, .sale-editor');
}

async function render() {
  const outings = await getAllOutings();
  const open = outings.find((o) => o.status === 'open') ?? null;
  if (!selectedId || !outings.some((o) => o.id === selectedId)) {
    selectedId = (open ?? outings[0])?.id ?? null;
  }

  const head = el('div', { class: 'card' }, ...renderHead(outings, open));
  if (!selectedId) {
    container.replaceChildren(head);
    return;
  }
  const outing = await getOuting(selectedId);
  const sales = await getSalesByOuting(outing.id);
  const products = await getAllProducts();
  container.replaceChildren(head, ...renderReport(outing, sales, products));
}

function renderHead(outings, open) {
  const nodes = [el('h2', { text: '場次' })];

  if (open) {
    nodes.push(
      el('div', { class: 'active-outing' }, el('span', { text: '進行中:' }), el('strong', { text: open.name })),
      el('div', { class: 'row-actions' },
        el('button', { class: 'btn', type: 'button', text: '編輯帶貨/成本', onClick: () => openForm(open) }),
        el('button', { class: 'btn danger', type: 'button', text: '關閉場次', onClick: () => onClose(open) }),
      ),
    );
  } else {
    nodes.push(el('button', { class: 'btn primary', type: 'button', text: '＋ 開始新場次', onClick: () => openForm(null) }));
  }

  if (outings.length) {
    const select = el('select', { id: 'outing-select' },
      ...outings.map((o) => el('option', { value: o.id, text: o.name + (o.status === 'open' ? '(進行中)' : '') })),
    );
    select.value = selectedId;
    select.addEventListener('change', () => { selectedId = select.value; render(); });
    nodes.push(el('label', { class: 'field' }, '檢視場次', select));
  }

  nodes.push(el('div', { id: 'outing-form' }));
  return nodes;
}

// 開始 / 編輯場次的表單(existing=null 為新增)。
async function openForm(existing) {
  const wrap = container.querySelector('#outing-form');
  const active = await getActiveProducts();
  // 併入「已帶貨但現已停售」的商品,避免編輯場次時其帶貨量被表單重建時清掉。
  const broughtIds = new Set((existing?.brought ?? []).map((b) => b.productId));
  const inactiveBrought = broughtIds.size
    ? (await getAllProducts()).filter((p) => broughtIds.has(p.id) && !p.active)
    : [];
  const products = [...active, ...inactiveBrought];

  const nameInput = el('input', { id: 'o-name', type: 'text', maxlength: 40, placeholder: '例:玩具展、松菸文創' });
  if (existing) nameInput.value = existing.name;

  const costAmount = (label) => existing?.fixedCosts?.find((c) => c.label === label)?.amount ?? '';
  const costInputs = FIXED_LABELS.map((label) => {
    const input = el('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', placeholder: '0', dataset: { label } });
    input.value = costAmount(label);
    return el('label', { class: 'field' }, label + '(元)', input);
  });

  const broughtQty = (id) => existing?.brought?.find((b) => b.productId === id)?.broughtQty ?? '';
  const broughtInputs = products.map((p) => {
    const input = el('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', placeholder: '0', dataset: { id: p.id } });
    input.value = broughtQty(p.id);
    return el('label', { class: 'field bring-row' }, p.name, input);
  });

  const err = el('p', { class: 'error', hidden: true });
  const form = el('form', { class: 'card sub-form', novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) { err.textContent = '請輸入場次名稱'; err.hidden = false; return; }
      const fixedCosts = costInputs
        .map((label) => label.querySelector('input'))
        .map((i) => ({ label: i.dataset.label, amount: Number(i.value) || 0 }))
        .filter((c) => c.amount > 0);
      const brought = broughtInputs
        .map((label) => label.querySelector('input'))
        .map((i) => ({ productId: i.dataset.id, broughtQty: Number(i.value) || 0 }))
        .filter((b) => b.broughtQty > 0);
      const saved = existing
        ? await updateOuting({ ...existing, name, fixedCosts, brought })
        : await addOuting({ name, fixedCosts, brought });
      selectedId = saved.id;
      await render();
    } },
    el('h3', { text: existing ? '編輯場次' : '開始新場次' }),
    el('label', { class: 'field' }, '場次名稱', nameInput),
    el('p', { class: 'field-group-label', text: '固定成本(選填)' }), ...costInputs,
    el('p', { class: 'field-group-label', text: '帶貨數量(選填,可現場再補)' }),
    ...(broughtInputs.length ? broughtInputs : [el('p', { class: 'hint', text: '尚無在售商品,可先到「商品」分頁建立。' })]),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn primary', type: 'submit', text: existing ? '儲存' : '開始場次' }),
      el('button', { class: 'btn', type: 'button', text: '取消', onClick: render }),
    ),
    err,
  );
  wrap.replaceChildren(form);
  nameInput.focus();
}

async function onClose(outing) {
  await closeOuting(outing.id);
  await render();
}

// ---- 報表 ----

function stat(label, value, cls) {
  return el('div', { class: 'stat' + (cls ? ' ' + cls : '') },
    el('span', { class: 'stat-label', text: label }),
    el('strong', { class: 'stat-value', text: value }),
  );
}

function renderReport(outing, sales, products) {
  const saleTypeSales = sales.filter((s) => (s.type ?? 'sale') === 'sale');
  const day = summarizeDay(saleTypeSales); // total=收入, byMethod=現金/轉帳
  const net = outingNet(sales, outing.fixedCosts);
  const fixedTotal = sumFixedCosts(outing.fixedCosts);
  const specials = sales.filter((s) => (s.type ?? 'sale') !== 'sale');

  const summary = el('div', { class: 'summary-grid' },
    stat('收入', formatMoney(day.total)),
    stat('銷售筆數', `${day.count}`),
    stat('現金', formatMoney(day.byMethod.cash)),
    stat('轉帳', formatMoney(day.byMethod.transfer)),
    stat('商品成本', formatMoney(soldCost(sales))),
    stat('固定成本', formatMoney(fixedTotal)),
    stat('淨額', formatMoney(net), net < 0 ? 'neg' : ''),
  );

  return [
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', { text: outing.name }),
        el('span', { class: 'badge', text: outing.status === 'open' ? '進行中' : '已關閉' })),
      summary,
    ),
    renderProductTable(outing, sales, products),
    renderDays(saleTypeSales),
    specials.length ? renderSpecials(specials) : null,
    renderSalesList(sales),
  ].filter(Boolean);
}

function renderProductTable(outing, sales, products) {
  const rows = ranking(productAggregate({ brought: outing.brought, sales, products }));
  const body = rows.length
    ? rows.map((r) => el('tr', { class: r.sold === 0 ? 'dead' : '' },
        el('td', {}, r.name, r.sold === 0 ? el('span', { class: 'badge', text: '滯銷' }) : null),
        el('td', { class: 'num', text: r.brought == null ? '—' : String(r.brought) }),
        el('td', { class: 'num', text: String(r.sold) }),
        el('td', { class: 'num', text: r.remaining == null ? '—' : String(r.remaining) }),
        el('td', { class: 'num', text: formatMoney(r.revenue) }),
      ))
    : [el('tr', {}, el('td', { colspan: 5, class: 'empty', text: '這場還沒有商品紀錄。' }))];

  return el('div', { class: 'card' },
    el('h3', { text: '商品彙總(好賣排行)' }),
    el('table', { class: 'agg-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: '商品' }), el('th', { class: 'num', text: '帶' }),
        el('th', { class: 'num', text: '賣' }), el('th', { class: 'num', text: '剩' }),
        el('th', { class: 'num', text: '收入' }))),
      el('tbody', {}, ...body),
    ),
  );
}

function groupByDate(sales) {
  const map = new Map();
  for (const s of sales) {
    const k = s.dateKey ?? dateKey(new Date(s.createdAt));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderDays(saleTypeSales) {
  const days = groupByDate(saleTypeSales);
  if (days.length <= 1) return null; // 單天就不另列每日分計
  return el('div', { class: 'card' },
    el('h3', { text: '每日分計' }),
    el('ul', { class: 'list' }, ...days.map(([k, list]) => {
      const d = summarizeDay(list);
      return el('li', { class: 'row' },
        el('span', { class: 'row-name', text: k }),
        el('span', { class: 'row-price', text: `${d.count} 筆` }),
        el('strong', { text: formatMoney(d.total) }),
      );
    })),
  );
}

function renderSpecials(specials) {
  const pieces = (list) => list.reduce((n, s) => n + s.items.reduce((t, it) => t + it.qty, 0), 0);
  const gift = specials.filter((s) => s.type === 'gift');
  const repl = specials.filter((s) => s.type === 'replacement');
  return el('div', { class: 'card' },
    el('h3', { text: '特例(不計營收)' }),
    el('p', { class: 'hint', text: `贈送 ${pieces(gift)} 件 / 補送 ${pieces(repl)} 件,已計入出貨(扣剩餘),不計入收入。` }),
  );
}

function timeOf(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function itemsSummary(items) {
  return items.map((i) => `${i.name}×${i.qty}`).join('、');
}

function renderSalesList(sales) {
  const ul = el('ul', { id: 'sales-list', class: 'list' });
  if (!sales.length) {
    ul.replaceChildren(el('li', { class: 'empty', text: '這場還沒有銷售紀錄。' }));
  } else {
    ul.replaceChildren(...sales.map(renderSaleRow));
  }
  return el('div', { class: 'card' }, el('h3', { text: '銷售明細' }), ul);
}

function renderSaleRow(sale) {
  const type = sale.type ?? 'sale';
  return el('li', { class: 'sale-row', dataset: { id: sale.id } },
    el('div', { class: 'sale-main' },
      el('span', { class: 'sale-time', text: timeOf(sale.createdAt) }),
      el('span', { class: 'sale-items', text: itemsSummary(sale.items) }),
      type !== 'sale' ? el('span', { class: 'badge', text: typeLabel(type) }) : null,
      el('span', { class: 'sale-method', text: paymentLabel(sale.paymentMethod) }),
      el('span', { class: 'sale-total', text: formatMoney(sale.total) }),
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
  const li = container.querySelector(`#sales-list li[data-id="${sale.id}"]`);
  const draft = sale.items.map((i) => ({ ...i }));
  let method = sale.paymentMethod;
  let type = sale.type ?? 'sale';

  const itemsWrap = el('div', { class: 'edit-items' });
  const totalEl = el('strong', { class: 'edit-total' });
  const recalc = () => { totalEl.textContent = formatMoney(computeTotal(draft)); };

  function renderItems() {
    itemsWrap.replaceChildren(...draft.map((item) =>
      el('div', { class: 'edit-item' },
        el('span', { class: 'ei-name', text: item.name }),
        el('div', { class: 'qty' },
          el('button', { class: 'btn qbtn', type: 'button', text: '−', 'aria-label': '減少',
            onClick: () => { item.qty -= 1; if (item.qty <= 0) draft.splice(draft.indexOf(item), 1); renderItems(); recalc(); } }),
          el('span', { class: 'qv', text: String(item.qty) }),
          el('button', { class: 'btn qbtn', type: 'button', text: '＋', 'aria-label': '增加',
            onClick: () => { item.qty += 1; renderItems(); recalc(); } }),
        ),
      ),
    ));
  }

  const methodSelect = el('select', { class: 'edit-method' },
    el('option', { value: 'cash', text: '現金' }), el('option', { value: 'transfer', text: '轉帳' }));
  methodSelect.value = method;
  methodSelect.addEventListener('change', () => { method = methodSelect.value; });

  const typeSelect = el('select', { class: 'edit-type' },
    el('option', { value: 'sale', text: '正常銷售' }),
    el('option', { value: 'gift', text: '贈送(不計營收)' }),
    el('option', { value: 'replacement', text: '補送(不計營收)' }));
  typeSelect.value = type;
  typeSelect.addEventListener('change', () => { type = typeSelect.value; });

  const editor = el('div', { class: 'sale-editor' },
    itemsWrap,
    el('label', { class: 'field' }, '付款方式', methodSelect),
    el('label', { class: 'field' }, '類型', typeSelect),
    el('div', { class: 'cart-total' }, '合計 ', totalEl),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn accent', type: 'button', text: '儲存',
        onClick: async () => {
          if (!draft.length) await deleteSale(sale.id);
          else await updateSale({ ...sale, items: draft, total: computeTotal(draft), paymentMethod: method, type });
          await render();
        } }),
      el('button', { class: 'btn', type: 'button', text: '取消', onClick: render }),
    ),
  );

  renderItems();
  recalc();
  li.replaceChildren(editor);
}
