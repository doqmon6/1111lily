// Firebase App + Firestore 初始化。
// 瀏覽器環境:persistentLocalCache + persistentMultipleTabManager(離線持久化、多分頁安全)。
// 瀏覽器 emulator 模式:hostname=localhost 且 URL 含 ?emu=1 → connectFirestoreEmulator + connectAuthEmulator。
// Node/測試環境(FIRESTORE_EMULATOR_HOST 存在):memory cache + connectFirestoreEmulator。
//   同時若 FIREBASE_AUTH_EMULATOR_HOST 存在 → connectAuthEmulator(讓 auth token 能傳 Firestore)。
// M7 runbook:把下方 firebaseConfig 佔位值換成真實專案 config。
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  memoryLocalCache,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

// 正式專案 config(2026-07-04 runbook 填入;apiKey 為公開識別碼非機密)
const firebaseConfig = {
  apiKey: 'AIzaSyCBSD_z_2WYDv4e8S1vJDg2SOXgjMclTio',
  authDomain: 'market-sales-lily.firebaseapp.com',
  projectId: 'market-sales-lily',
  storageBucket: 'market-sales-lily.firebasestorage.app',
  messagingSenderId: '335096125048',
  appId: '1:335096125048:web:86a78b32b028623c20ff8d',
};

// 固定資料根 uid:兩位白名單使用者共用同一本帳,所有 Firestore 文件路徑都寫入此 uid
// (與 firestore.rules 路徑守衛的字面值一致)。M5 後授權判準已改為 email 白名單(見下方
// ALLOWED_EMAILS),此常數不再用於登入比對,僅作為 setUserId() 的固定目標。
export const CREATOR_UID = 'fEMuo2pogUXx6eKz3Ct33zSt9aM2';

// 授權白名單:僅此兩個 email(且 email_verified 必須為 true)可登入並存取上方固定資料根。
// 與 firestore.rules 的 isAllowed() 白名單字面值一致,兩處須同步維護。
export const ALLOWED_EMAILS = ['doqmon6@gmail.com', '1111l.i.lilyshu@gmail.com'];

const isNodeEmulator = typeof process !== 'undefined' && !!process.env.FIRESTORE_EMULATOR_HOST;
const isBrowserEmu =
  typeof window !== 'undefined' &&
  window.location.hostname === 'localhost' &&
  new URLSearchParams(window.location.search).get('emu') === '1';
const isBrowser = typeof window !== 'undefined' && !isNodeEmulator;

// emulator 模式一律用 demo project id:測試鏈(emulators:exec、REST 清庫、e2e helpers)
// 全部對準 demo-market-sales;真專案 config 填入後不可洩漏到測試路徑。
const activeConfig = (isNodeEmulator || isBrowserEmu)
  ? { ...firebaseConfig, projectId: 'demo-market-sales', authDomain: 'demo-market-sales.firebaseapp.com' }
  : firebaseConfig;

const app = initializeApp(activeConfig);

let db;
if (isNodeEmulator) {
  // Node 測試環境:Firestore 連 emulator
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, parseInt(port, 10));

  // 若 Auth emulator host 也設了,同時連 Auth emulator
  // 讓 db.test.js 裡的 signInWithEmailAndPassword 能傳 auth token 給 Firestore
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  }
} else if (isBrowserEmu) {
  // 瀏覽器 emulator 模式(e2e 測試用,hostname 守門)。
  // 與正式環境相同採 persistentLocalCache:e2e 才測得到「寫入落地本機、
  // reload 後未 ack 寫入不遺失」的真實行為(每個測試用全新 browser context,無殘留)。
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  connectFirestoreEmulator(db, 'localhost', 8080);
} else if (isBrowser) {
  // 正式瀏覽器:離線持久化
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} else {
  // fallback(不應出現)
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
}

// e2e / 開發用 emulator 模式旗標(app.js 的 fail-closed gate 依此跳過 ALLOWED_EMAILS 白名單檢查)
export const isEmulatorMode = isBrowserEmu || isNodeEmulator;

// M6 Sheets 鏡像端點。runbook 部署時填入 Apps Script Web App URL。
// null = 鏡像停用;mirror.js 讀此值,安靜 no-op。
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxS2mMZgbchU0MI89KBCEBnB0r_0sif6Q4SEPX9YCwuUDP94T7dTFyWSgmfgELwhOR9/exec';

export { app, db };
