// rules.test.js — 用 Firestore emulator + @firebase/rules-unit-testing 測試 Security Rules。
// 執行方式:npm run test:emulator(包含此檔)。
// firestore.rules 的 FIXED_UID 佔位在讀入時被字串替換為測試 UID,
// 確保測的就是部署那份 rules 的邏輯。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES_UID } from './rules-uid.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CREATOR_UID = 'test-creator-uid';
const OTHER_UID = 'other-user-uid';
// 與 db.test.js(demo-market-sales)分開:initializeTestEnvironment 會把本檔替換過 UID 的
// rules 蓋到「整個 project」上,共用 project 會讓 db.test 的 FIXED_UID 登入被 deny。
const PROJECT_ID = 'demo-market-sales-rules';

// 讀取 firestore.rules 並把 FIXED_UID 佔位換成測試 UID
const rawRules = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');
// 以動態抽取的 UID 字面值替換(佔位或真值都可,見 rules-uid.js)
const rules = rawRules.replaceAll(RULES_UID, CREATOR_UID);

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// helper:建立 authenticated context
function asCreator() {
  return testEnv.authenticatedContext(CREATOR_UID).firestore();
}
function asOther() {
  return testEnv.authenticatedContext(OTHER_UID).firestore();
}
function asAnon() {
  return testEnv.unauthenticatedContext().firestore();
}

import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, addDoc } from 'firebase/firestore';

describe('正確 UID 可讀寫', () => {
  it('可新增 product', async () => {
    const db = asCreator();
    const ref = doc(db, 'users', CREATOR_UID, 'products', 'p1');
    await assertSucceeds(setDoc(ref, { id: 'p1', name: '手鍊', price: 100 }));
  });

  it('可讀取 product', async () => {
    // 先以 admin 寫入
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', CREATOR_UID, 'products', 'p1'), { id: 'p1', name: '手鍊' });
    });
    const db = asCreator();
    await assertSucceeds(getDoc(doc(db, 'users', CREATOR_UID, 'products', 'p1')));
  });

  it('可新增 sale', async () => {
    const db = asCreator();
    const ref = doc(db, 'users', CREATOR_UID, 'sales', 's1');
    await assertSucceeds(setDoc(ref, { id: 's1', total: 100 }));
  });
});

describe('他人 UID 全 deny', () => {
  it('其他使用者無法讀取', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', CREATOR_UID, 'products', 'p1'), { id: 'p1' });
    });
    const db = asOther();
    await assertFails(getDoc(doc(db, 'users', CREATOR_UID, 'products', 'p1')));
  });

  it('其他使用者無法寫入', async () => {
    const db = asOther();
    await assertFails(setDoc(doc(db, 'users', CREATOR_UID, 'products', 'p2'), { id: 'p2' }));
  });

  it('其他使用者無法讀取自己路徑下的 creator 資料', async () => {
    const db = asOther();
    // 嘗試讀取 users/other-user-uid/products — 也應該 deny(因 isCreator() 只允許 CREATOR_UID)
    await assertFails(getDoc(doc(db, 'users', OTHER_UID, 'products', 'p1')));
  });
});

describe('未登入全 deny', () => {
  it('匿名使用者無法讀取', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', CREATOR_UID, 'sales', 's1'), { id: 's1' });
    });
    const db = asAnon();
    await assertFails(getDoc(doc(db, 'users', CREATOR_UID, 'sales', 's1')));
  });

  it('匿名使用者無法寫入', async () => {
    const db = asAnon();
    await assertFails(setDoc(doc(db, 'users', CREATOR_UID, 'sales', 's2'), { id: 's2' }));
  });
});

describe('changelog append-only', () => {
  it('創作者可新增 changelog', async () => {
    const db = asCreator();
    const ref = doc(db, 'users', CREATOR_UID, 'changelog', 'c1');
    await assertSucceeds(setDoc(ref, { id: 'c1', action: 'create', at: new Date().toISOString() }));
  });

  it('創作者可讀取 changelog', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', CREATOR_UID, 'changelog', 'c1'), { id: 'c1' });
    });
    const db = asCreator();
    await assertSucceeds(getDoc(doc(db, 'users', CREATOR_UID, 'changelog', 'c1')));
  });

  it('changelog 不可 update(內層 match 覆蓋外層萬用)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', CREATOR_UID, 'changelog', 'c1'), { id: 'c1', action: 'create' });
    });
    const db = asCreator();
    await assertFails(updateDoc(doc(db, 'users', CREATOR_UID, 'changelog', 'c1'), { action: 'tampered' }));
  });

  it('changelog 不可 delete(內層 match 覆蓋外層萬用)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', CREATOR_UID, 'changelog', 'c1'), { id: 'c1' });
    });
    const db = asCreator();
    await assertFails(deleteDoc(doc(db, 'users', CREATOR_UID, 'changelog', 'c1')));
  });

  it('他人無法新增 changelog', async () => {
    const db = asOther();
    await assertFails(setDoc(doc(db, 'users', CREATOR_UID, 'changelog', 'c2'), { id: 'c2' }));
  });
});
