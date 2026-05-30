// App 殼:分頁切換 + Service Worker 註冊。
// 每個分頁模組提供 init(el)(首次建立)與選用的 show()(每次顯示時刷新資料)。
import * as products from './ui/products.js';
import * as sale from './ui/sale.js';
import * as report from './ui/report.js';
import * as exporter from './ui/exporter.js';

const TITLES = {
  sale: '記銷售',
  products: '商品',
  report: '當日對帳',
  export: '匯出備份',
};

const VIEWS = {
  sale,
  products,
  report,
  export: exporter,
};

const initialized = new Set();

async function showView(name) {
  for (const v of document.querySelectorAll('.view')) {
    v.hidden = v.dataset.view !== name;
  }
  for (const t of document.querySelectorAll('.tab')) {
    t.setAttribute('aria-current', t.dataset.target === name ? 'page' : 'false');
  }
  const title = document.getElementById('app-title');
  if (title) title.textContent = TITLES[name] ?? '';

  const mod = VIEWS[name];
  if (!mod) return;
  if (!initialized.has(name)) {
    initialized.add(name);
    await mod.init(document.querySelector(`#view-${name}`));
  } else if (mod.show) {
    await mod.show();
  }
}

function initNav() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showView(tab.dataset.target));
  }
  showView('sale');
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.error('Service Worker 註冊失敗', err);
    });
  });
}

initNav();
registerServiceWorker();
