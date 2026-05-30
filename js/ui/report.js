// 當日對帳:選日期 → 顯示總營收/筆數/現金小計/轉帳小計 + 當日明細;可編輯/刪除單筆。
import { getSalesByDate, updateSale, deleteSale } from '../db.js';
import { summarizeDay, dateKey, formatMoney, paymentLabel, computeTotal } from '../logic.js';
import { el } from './dom.js';

let container;
let selectedDate;

export async function init(viewEl) {
  container = viewEl;
  selectedDate = dateKey(new Date());
  const dateInput = el('input', { id: 'report-date', type: 'date' });
  dateInput.value = selectedDate;
  dateInput.addEventListener('change', () => { selectedDate = dateInput.value; render(); });

  container.replaceChildren(
    el('div', { class: 'card' },
      el('label', { class: 'field' }, '日期', dateInput),
      el('div', { id: 'report-summary', class: 'summary-grid' }),
      el('p', { class: 'hint', text: '收攤記得到「匯出」分頁備份今天的紀錄。' }),
    ),
    el('ul', { id: 'report-list', class: 'list' }),
  );
  await render();
}

export async function show() {
  await render();
}

async function render() {
  const sales = await getSalesByDate(selectedDate);
  renderSummary(sales);
  renderList(sales);
}

function stat(label, value, id) {
  return el('div', { class: 'stat' },
    el('span', { class: 'stat-label', text: label }),
    el('strong', { class: 'stat-value', id, text: value }),
  );
}

function renderSummary(sales) {
  const s = summarizeDay(sales);
  container.querySelector('#report-summary').replaceChildren(
    stat('總營收', formatMoney(s.total), 'report-total'),
    stat('筆數', `${s.count}`, 'report-count'),
    stat('現金', formatMoney(s.byMethod.cash), 'report-cash'),
    stat('轉帳', formatMoney(s.byMethod.transfer), 'report-transfer'),
  );
}

function timeOf(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function itemsSummary(items) {
  return items.map((i) => `${i.name}×${i.qty}`).join('、');
}

function renderList(sales) {
  const ul = container.querySelector('#report-list');
  if (!sales.length) {
    ul.replaceChildren(el('li', { class: 'empty', text: '這天還沒有銷售紀錄。' }));
    return;
  }
  ul.replaceChildren(...sales.map(renderSaleRow));
}

function renderSaleRow(sale) {
  return el('li', { class: 'sale-row', dataset: { id: sale.id } },
    el('div', { class: 'sale-main' },
      el('span', { class: 'sale-time', text: timeOf(sale.createdAt) }),
      el('span', { class: 'sale-items', text: itemsSummary(sale.items) }),
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
  const li = container.querySelector(`li[data-id="${sale.id}"]`);
  const draft = sale.items.map((i) => ({ ...i }));
  let method = sale.paymentMethod;

  const itemsWrap = el('div', { class: 'edit-items' });
  const totalEl = el('strong', { class: 'edit-total' });

  const recalc = () => { totalEl.textContent = formatMoney(computeTotal(draft)); };

  function renderItems() {
    itemsWrap.replaceChildren(...draft.map((item) =>
      el('div', { class: 'edit-item' },
        el('span', { class: 'ei-name', text: item.name }),
        el('div', { class: 'qty' },
          el('button', { class: 'btn qbtn', type: 'button', text: '−', 'aria-label': '減少',
            onClick: () => {
              item.qty -= 1;
              if (item.qty <= 0) draft.splice(draft.indexOf(item), 1);
              renderItems();
              recalc();
            } }),
          el('span', { class: 'qv', text: String(item.qty) }),
          el('button', { class: 'btn qbtn', type: 'button', text: '＋', 'aria-label': '增加',
            onClick: () => { item.qty += 1; renderItems(); recalc(); } }),
        ),
      ),
    ));
  }

  const methodSelect = el('select', { class: 'edit-method' },
    el('option', { value: 'cash', text: '現金' }),
    el('option', { value: 'transfer', text: '轉帳' }),
  );
  methodSelect.value = method;
  methodSelect.addEventListener('change', () => { method = methodSelect.value; });

  const editor = el('div', { class: 'sale-editor' },
    itemsWrap,
    el('label', { class: 'field' }, '付款方式', methodSelect),
    el('div', { class: 'cart-total' }, '合計 ', totalEl),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn accent', type: 'button', text: '儲存',
        onClick: async () => {
          if (!draft.length) {
            await deleteSale(sale.id);
          } else {
            await updateSale({ ...sale, items: draft, total: computeTotal(draft), paymentMethod: method });
          }
          await render();
        } }),
      el('button', { class: 'btn', type: 'button', text: '取消', onClick: render }),
    ),
  );

  renderItems();
  recalc();
  li.replaceChildren(editor);
}
