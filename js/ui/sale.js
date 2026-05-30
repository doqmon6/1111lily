// 記銷售熱路徑:點商品加入購物車 → 調數量 → 選付款方式 → 完成。
// 一筆可含多商品;總額自動加總;存檔後即時更新「今天累計」。支援現場新增商品。
import { getActiveProducts, addProduct, addSale, getSalesByDate } from '../db.js';
import { computeTotal, summarizeDay, dateKey, formatMoney } from '../logic.js';
import { el } from './dom.js';

let container;
let cart = [];

export async function init(viewEl) {
  container = viewEl;
  container.replaceChildren(
    el('div', { id: 'today-summary', class: 'today-summary' }),
    el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { text: '選擇商品' }),
        el('button', { class: 'btn', type: 'button', id: 'add-onfly-btn', text: '＋現場新增', onClick: toggleOnFlyForm }),
      ),
      el('div', { id: 'onfly-form', hidden: true }),
      el('div', { id: 'product-grid', class: 'grid' }),
    ),
    el('section', { class: 'card' },
      el('h2', { text: '本筆明細' }),
      el('ul', { id: 'cart', class: 'list' }),
      el('div', { class: 'cart-total' }, '合計 ', el('strong', { id: 'cart-total', text: '$0' })),
      el('label', { class: 'field' }, '付款方式',
        el('select', { id: 'pay-method' },
          el('option', { value: 'cash', text: '現金' }),
          el('option', { value: 'transfer', text: '轉帳' }),
        ),
      ),
      el('button', { class: 'btn accent', id: 'checkout-btn', type: 'button', text: '完成這筆', onClick: onCheckout }),
      el('p', { id: 'sale-msg', class: 'msg', hidden: true }),
    ),
  );
  renderCart();
  await show();
}

export async function show() {
  await renderGrid();
  await refreshToday();
}

async function renderGrid() {
  const products = await getActiveProducts();
  const grid = container.querySelector('#product-grid');
  if (!products.length) {
    grid.replaceChildren(el('p', { class: 'empty', text: '尚無在售商品,先到「商品」新增,或用「＋現場新增」。' }));
    return;
  }
  grid.replaceChildren(...products.map((p) =>
    el('button', { class: 'product-btn', type: 'button', dataset: { id: p.id }, onClick: () => addToCart(p) },
      el('span', { class: 'product-name', text: p.name }),
      el('span', { class: 'product-price', text: formatMoney(p.price) }),
    ),
  ));
}

function addToCart(p) {
  const existing = cart.find((i) => i.productId === p.id);
  if (existing) existing.qty += 1;
  else cart.push({ productId: p.id, name: p.name, price: p.price, qty: 1 });
  renderCart();
}

function changeQty(item, delta) {
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter((i) => i !== item);
  renderCart();
}

function renderCart() {
  const ul = container.querySelector('#cart');
  if (!cart.length) {
    ul.replaceChildren(el('li', { class: 'empty', text: '點上方商品加入這筆銷售。' }));
  } else {
    ul.replaceChildren(...cart.map((item) =>
      el('li', { class: 'cart-row', dataset: { id: item.productId } },
        el('span', { class: 'ci-name', text: item.name }),
        el('span', { class: 'ci-price', text: formatMoney(item.price) }),
        el('div', { class: 'qty' },
          el('button', { class: 'btn qbtn', type: 'button', text: '−', 'aria-label': '減少', onClick: () => changeQty(item, -1) }),
          el('span', { class: 'qv', text: String(item.qty) }),
          el('button', { class: 'btn qbtn', type: 'button', text: '＋', 'aria-label': '增加', onClick: () => changeQty(item, 1) }),
        ),
        el('span', { class: 'ci-sub', text: formatMoney(item.price * item.qty) }),
      ),
    ));
  }
  container.querySelector('#cart-total').textContent = formatMoney(computeTotal(cart));
}

function showMsg(text, isError) {
  const m = container.querySelector('#sale-msg');
  m.textContent = text;
  m.hidden = false;
  m.className = 'msg ' + (isError ? 'error' : 'ok');
}

async function onCheckout() {
  if (!cart.length) {
    showMsg('購物車是空的', true);
    return;
  }
  const paymentMethod = container.querySelector('#pay-method').value;
  const items = cart.map((i) => ({ productId: i.productId, name: i.name, price: i.price, qty: i.qty }));
  const total = computeTotal(items);
  await addSale({ items, total, paymentMethod });
  cart = [];
  renderCart();
  await refreshToday();
  showMsg('已記錄一筆 ' + formatMoney(total), false);
}

async function refreshToday() {
  const sales = await getSalesByDate(dateKey(new Date()));
  const sum = summarizeDay(sales);
  container.querySelector('#today-summary').replaceChildren(
    el('span', { class: 'ts-label', text: '今天累計' }),
    el('strong', { id: 'today-total', class: 'ts-total', text: formatMoney(sum.total) }),
    el('span', { id: 'today-count', class: 'ts-count', text: `${sum.count} 筆` }),
  );
}

function toggleOnFlyForm() {
  const wrap = container.querySelector('#onfly-form');
  if (wrap.dataset.open === '1') {
    wrap.dataset.open = '';
    wrap.hidden = true;
    wrap.replaceChildren();
    return;
  }
  wrap.dataset.open = '1';
  wrap.hidden = false;
  const nameInput = el('input', { id: 'of-name', type: 'text', maxlength: 40, placeholder: '品名' });
  const priceInput = el('input', { id: 'of-price', type: 'number', min: 1, step: 1, inputmode: 'numeric', placeholder: '單價' });
  const err = el('p', { id: 'of-error', class: 'error', hidden: true });
  const form = el('form', { class: 'onfly', novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const price = Number(priceInput.value);
      if (!name || !Number.isInteger(price) || price <= 0) {
        err.textContent = '品名必填,單價需為正整數';
        err.hidden = false;
        return;
      }
      const product = await addProduct({ name, price });
      await renderGrid();
      addToCart(product);
      toggleOnFlyForm();
    } },
    nameInput, priceInput,
    el('button', { class: 'btn primary', type: 'submit', text: '新增並加入' }),
    err,
  );
  wrap.replaceChildren(form);
  nameInput.focus();
}
