// Firebase App + Firestore 初始化。
// 瀏覽器環境:persistentLocalCache + persistentMultipleTabManager(離線持久化、多分頁安全)。
// Node/測試環境(FIRESTORE_EMULATOR_HOST 存在):memory cache + connectFirestoreEmulator。
// M7 runbook:把下方 firebaseConfig 佔位值換成真實專案 config。
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  memoryLocalCache,
} from 'firebase/firestore';

// TODO M7: 換成真實 Firebase 專案 config(apiKey 等)
const firebaseConfig = {
  apiKey: 'PLACEHOLDER',
  authDomain: 'demo-market-sales.firebaseapp.com',
  projectId: 'demo-market-sales',
  storageBucket: 'demo-market-sales.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000',
};

const app = initializeApp(firebaseConfig);

const isEmulator = typeof process !== 'undefined' && !!process.env.FIRESTORE_EMULATOR_HOST;
const isBrowser = typeof window !== 'undefined' && !isEmulator;

let db;
if (isBrowser) {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} else {
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
  if (isEmulator) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    connectFirestoreEmulator(db, host, parseInt(port, 10));
  }
}

export { db };
