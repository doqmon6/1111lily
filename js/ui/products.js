// 商品管理:新增 / 編輯 / 停售-恢復。欄位僅品名 + 單價(正整數)。
import { getAllProducts, addProduct, updateProduct, setProductActive } from '../db.js';
import { formatMoney } from '../logic.js';
import { el } from './dom.js';

let container;

export async function init(viewEl) {
  container = viewEl;
  container.replaceChildren(
    el('form', { class: 'card', id: 'product-form', novalidate: true, onSubmit: onAdd },
      el('h2', { text: '新增商品' }),
      el('label', { class: 'field' }, '品名',
        el('input', { id: 'p-name', type: 'text', maxlength: 40, placeholder: '例:手鍊' })),
      el('label', { class: 'field' }, '單價(元)',
        el('input', { id: 'p-price', type: 'number', min: 1, step: 1, inputmode: 'numeric', placeholder: '例:150' })),
      el('label', { class: 'field' }, '成本(選填,元)',
        el('input', { id: 'p-cost', type: 'number', min: 0, step: 1, inputmode: 'numeric', placeholder: '材料/進貨成本,可後補' })),
      el('button', { class: 'btn primary', type: 'submit', text: '新增商品' }),
      el('p', { id: 'p-error', class: 'error', role: 'alert', hidden: true }),
    ),
    el('ul', { id: 'product-list', class: 'list' }),
  );
  await renderList();
}

export async function show() {
  await renderList();
}

// 行內編輯表單開著時,app.js 跳過自動重繪,避免洗掉輸入。
export function isBusy() {
  return !!document.querySelector('#view-products .row-edit');
}

function isValidPrice(price) {
  return Number.isInteger(price) && price > 0;
}

// 成本選填:空字串視為 0;有填則需 0 或正整數。回 { ok, cost }。
function parseCost(raw) {
  if (raw.trim() === '') return { ok: true, cost: 0 };
  const cost = Number(raw);
  return { ok: Number.isInteger(cost) && cost >= 0, cost };
}

function showError(msg) {
  const e = container.querySelector('#p-error');
  e.textContent = msg;
  e.hidden = !msg;
}

async function onAdd(e) {
  e.preventDefault();
  const nameInput = container.querySelector('#p-name');
  const priceInput = container.querySelector('#p-price');
  const costInput = container.querySelector('#p-cost');
  const name = nameInput.value.trim();
  const price = Number(priceInput.value);
  if (!name) return showError('請輸入品名');
  if (!isValidPrice(price)) return showError('單價需為大於 0 的整數');
  const { ok, cost } = parseCost(costInput.value);
  if (!ok) return showError('成本需為 0 或正整數');
  showError('');
  await addProduct({ name, price, cost });
  nameInput.value = '';
  priceInput.value = '';
  costInput.value = '';
  nameInput.focus();
  await renderList();
}

async function renderList() {
  const products = await getAllProducts();
  const ul = container.querySelector('#product-list');
  if (!products.length) {
    ul.replaceChildren(el('li', { class: 'empty', text: '還沒有商品,先新增一個。' }));
    return;
  }
  ul.replaceChildren(...products.map(renderRow));
}

function renderRow(p) {
  return el('li', { class: 'row' + (p.active ? '' : ' inactive'), dataset: { id: p.id } },
    el('div', { class: 'row-main' },
      el('span', { class: 'row-name', text: p.name }),
      el('span', { class: 'row-price', text: formatMoney(p.price) }),
      el('span', { class: 'row-cost', text: '成本 ' + formatMoney(p.cost ?? 0) }),
      p.active ? null : el('span', { class: 'badge', text: '已停售' }),
    ),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn', type: 'button', text: '編輯', onClick: () => startEdit(p) }),
      el('button', { class: 'btn', type: 'button', text: p.active ? '停售' : '恢復', onClick: () => onToggle(p) }),
    ),
  );
}

function startEdit(p) {
  const li = container.querySelector(`li[data-id="${p.id}"]`);
  const nameInput = el('input', { class: 'e-name', type: 'text', maxlength: 40 });
  nameInput.value = p.name;
  const priceInput = el('input', { class: 'e-price', type: 'number', min: 1, step: 1 });
  priceInput.value = p.price;
  const costInput = el('input', { class: 'e-cost', type: 'number', min: 0, step: 1, placeholder: '成本' });
  costInput.value = p.cost ?? 0;
  const err = el('p', { class: 'error', hidden: true });
  const form = el('form', { class: 'row-edit', novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const price = Number(priceInput.value);
      const { ok, cost } = parseCost(costInput.value);
      if (!name || !isValidPrice(price) || !ok) {
        err.textContent = '品名必填,單價需為正整數,成本需為 0 或正整數';
        err.hidden = false;
        return;
      }
      await updateProduct({ ...p, name, price, cost });
      await renderList();
    } },
    nameInput, priceInput, costInput,
    el('button', { class: 'btn primary', type: 'submit', text: '儲存' }),
    el('button', { class: 'btn', type: 'button', text: '取消', onClick: renderList }),
    err,
  );
  li.replaceChildren(form);
}

async function onToggle(p) {
  await setProductActive(p.id, !p.active);
  await renderList();
}
