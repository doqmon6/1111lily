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

// TODO M7: 換成真實 Firebase 專案 config(apiKey 等)
const firebaseConfig = {
  apiKey: 'PLACEHOLDER',
  authDomain: 'demo-market-sales.firebaseapp.com',
  projectId: 'demo-market-sales',
  storageBucket: 'demo-market-sales.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000',
};

// 固定 UID:runbook 部署時「必須」改為創作者真實 UID(Firebase Console → Authentication → User UID)。
// ⚠️ 留 null 上線 = App 登入 gate 直接拒絕所有人(fail-closed,提示「尚未完成設定」);
//    資料層另有 firestore.rules 以 FIXED_UID 把關,雙防線互相獨立。
// emulator / e2e(?emu=1 + localhost)下 null 視為不檢查,方便測試。
export const CREATOR_UID = null;

const app = initializeApp(firebaseConfig);

const isNodeEmulator = typeof process !== 'undefined' && !!process.env.FIRESTORE_EMULATOR_HOST;
const isBrowserEmu =
  typeof window !== 'undefined' &&
  window.location.hostname === 'localhost' &&
  new URLSearchParams(window.location.search).get('emu') === '1';
const isBrowser = typeof window !== 'undefined' && !isNodeEmulator;

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

// e2e / 開發用 emulator 模式旗標(app.js 的 fail-closed gate 依此放行 null CREATOR_UID)
export const isEmulatorMode = isBrowserEmu || isNodeEmulator;

export { app, db };
