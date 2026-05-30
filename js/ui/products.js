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

function isValidPrice(price) {
  return Number.isInteger(price) && price > 0;
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
  const name = nameInput.value.trim();
  const price = Number(priceInput.value);
  if (!name) return showError('請輸入品名');
  if (!isValidPrice(price)) return showError('單價需為大於 0 的整數');
  showError('');
  await addProduct({ name, price });
  nameInput.value = '';
  priceInput.value = '';
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
  const err = el('p', { class: 'error', hidden: true });
  const form = el('form', { class: 'row-edit', novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const price = Number(priceInput.value);
      if (!name || !isValidPrice(price)) {
        err.textContent = '品名必填,單價需為正整數';
        err.hidden = false;
        return;
      }
      await updateProduct({ ...p, name, price });
      await renderList();
    } },
    nameInput, priceInput,
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
