// App 殼:登入 gate + 分頁切換 + Service Worker 註冊。
// 登入流程:onAuth → 有 user → setUserId → showApp
//           onAuth → null → showLoginScreen
// 每個分頁模組提供 init(el)(首次建立)與選用的 show()(每次顯示時刷新資料)。
import * as products from './ui/products.js';
import * as sale from './ui/sale.js';
import * as outing from './ui/outing.js';
import * as exporter from './ui/exporter.js';
import { setUserId, onDataChanged, _closeDb } from './db.js';
import { signInWithGoogle, signOutUser, onAuth } from './auth.js';
import { CREATOR_UID, isEmulatorMode } from './firebase.js';
import { initMirror } from './mirror.js';

const TITLES = {
  sale: '記銷售',
  products: '商品',
  outing: '場次',
  export: '匯出備份',
};

const VIEWS = {
  sale,
  products,
  outing,
  export: exporter,
};

const initialized = new Set();
let currentView = null;

// ---- 資料變更 → 當前分頁自動重繪 ----
// 遠端(另一台裝置)或本地寫入使 store 更新時,重跑當前分頁的 show()。
// 使用者正在輸入(焦點在表單控制項)時跳過,避免重繪洗掉輸入;
// 下一次變更或切分頁自然補上。
let refreshTimer = null;
function scheduleViewRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const ae = document.activeElement;
    if (ae && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName)) return;
    const mod = currentView && VIEWS[currentView];
    if (!mod || !initialized.has(currentView)) return;
    if (mod.isBusy?.()) return; // 分頁有進行中的編輯/表單,不可重繪洗掉
    mod.show?.();
  }, 150);
}
onDataChanged(scheduleViewRefresh);

// ---- 分頁 ----

async function showView(name) {
  currentView = name;
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

// ---- 登入 / 登出畫面切換 ----

function showLoginScreen(errorMsg) {
  document.getElementById('app').hidden = true;
  const screen = document.getElementById('login-screen');
  screen.hidden = false;
  const errEl = document.getElementById('login-error');
  if (errorMsg) {
    errEl.textContent = errorMsg;
    errEl.hidden = false;
  } else {
    errEl.hidden = true;
  }
}

function showApp() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app').hidden = false;
}

// ---- 登入按鈕 ----

document.getElementById('login-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('login-error');
  errEl.hidden = true;
  try {
    await signInWithGoogle();
    // onAuthStateChanged 會接手後續流程
  } catch (err) {
    console.error('Google 登入失敗', err);
    errEl.textContent = '登入失敗,請稍後再試。';
    errEl.hidden = false;
  }
});

// ---- SW 註冊 ----

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.error('Service Worker 註冊失敗', err);
    });
  });
}

// ---- Auth 狀態監聽(入口) ----

if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// 初始先顯示登入畫面,等 onAuth 判斷
showLoginScreen();

onAuth(async (user) => {
  if (!user) {
    _closeDb(); // 登出:卸掉 listeners、清空 store,不對舊 uid 保持訂閱
    showLoginScreen();
    return;
  }

  // 固定 UID 檢查(fail-closed:正式環境未填 CREATOR_UID = 拒絕所有人,
  // 避免 runbook 漏填時 gate 靜默失效;emulator/e2e 下 null 放行)
  if (CREATOR_UID === null && !isEmulatorMode) {
    console.error('CREATOR_UID 未設定,拒絕登入(runbook 未完成)');
    await signOutUser();
    showLoginScreen('App 尚未完成設定(未綁定創作者帳號),請聯絡工程師');
    return;
  }
  if (CREATOR_UID !== null && user.uid !== CREATOR_UID) {
    console.warn('UID 不符,拒絕登入:', user.uid);
    await signOutUser();
    showLoginScreen('此帳號無權限');
    return;
  }

  setUserId(user.uid);
  initMirror();
  showApp();
  // 確保 initNav 只跑一次
  if (!initialized.size) {
    initNav();
  }
});

registerServiceWorker();
