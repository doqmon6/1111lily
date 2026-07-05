// rules.test.js — 用 Firestore emulator + @firebase/rules-unit-testing 測試 Security Rules。
// 執行方式:npm run test:emulator(包含此檔)。
// 直接讀入 firestore.rules 原文(不做字面值替換),搭配動態抽取的 DATA_ROOT_UID /
// ALLOWED_EMAILS 建立情境,確保測的就是部署那份 rules 的邏輯。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_ROOT_UID, ALLOWED_EMAILS } from './rules-uid.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 白名單兩帳號各用「自己的 uid」登入(uid ≠ 固定資料根 uid)——
// 驗證雙人共帳的本質:授權判準是 email,不是 uid。
const UID_A = 'test-uid-a';
const UID_B = 'test-uid-b';
const EMAIL_A = ALLOWED_EMAILS[0];
const EMAIL_B = ALLOWED_EMAILS[1];
const OTHER_UID = 'other-user-uid';
const OTHER_EMAIL = 'not-allowed@example.com';
// 與 db.test.js(demo-market-sales)分開:initializeTestEnvironment 會把本檔的 rules 蓋到
// 「整個 project」上,共用 project 會讓 db.test 的帳號登入被 deny。
const PROJECT_ID = 'demo-market-sales-rules';

const rules = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');

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

// helper:建立 authenticated context(email + email_verified token claims)
function asUserA() {
  return testEnv.authenticatedContext(UID_A, { email: EMAIL_A, email_verified: true }).firestore();
}
function asUserB() {
  return testEnv.authenticatedContext(UID_B, { email: EMAIL_B, email_verified: true }).firestore();
}
function asUnverified() {
  return testEnv.authenticatedContext(UID_A, { email: EMAIL_A, email_verified: false }).firestore();
}
function asOther() {
  return testEnv.authenticatedContext(OTHER_UID, { email: OTHER_EMAIL, email_verified: true }).firestore();
}
function asAnon() {
  return testEnv.unauthenticatedContext().firestore();
}

import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

describe('白名單 email 可讀寫固定資料根(uid ≠ 路徑 uid)', () => {
  it('白名單 A 可新增 product', async () => {
    const db = asUserA();
    const ref = doc(db, 'users', DATA_ROOT_UID, 'products', 'p1');
    await assertSucceeds(setDoc(ref, { id: 'p1', name: '手鍊', price: 100 }));
  });

  it('白名單 A 可讀取 product', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', DATA_ROOT_UID, 'products', 'p1'), { id: 'p1', name: '手鍊' });
    });
    const db = asUserA();
    await assertSucceeds(getDoc(doc(db, 'users', DATA_ROOT_UID, 'products', 'p1')));
  });

  it('白名單 A 可新增 sale', async () => {
    const db = asUserA();
    const ref = doc(db, 'users', DATA_ROOT_UID, 'sales', 's1');
    await assertSucceeds(setDoc(ref, { id: 's1', total: 100 }));
  });

  it('白名單 B 可讀白名單 A 寫入的 doc(同一本帳,AC14)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', DATA_ROOT_UID, 'sales', 's1'), { id: 's1', total: 100 });
    });
    const db = asUserB();
    await assertSucceeds(getDoc(doc(db, 'users', DATA_ROOT_UID, 'sales', 's1')));
  });

  it('白名單 B 可寫入,白名單 A 可讀到(反向同一本帳)', async () => {
    const dbB = asUserB();
    await assertSucceeds(setDoc(doc(dbB, 'users', DATA_ROOT_UID, 'products', 'p2'), { id: 'p2', name: 'B 寫入' }));
    const dbA = asUserA();
    await assertSucceeds(getDoc(doc(dbA, 'users', DATA_ROOT_UID, 'products', 'p2')));
  });

  it('白名單 email 存取非資料根路徑仍 deny(路徑守衛)', async () => {
    const db = asUserA();
    await assertFails(setDoc(doc(db, 'users', OTHER_UID, 'products', 'p1'), { id: 'p1' }));
    await assertFails(getDoc(doc(db, 'users', OTHER_UID, 'products', 'p1')));
  });
});

describe('名單外 email 全 deny', () => {
  it('名單外 email 無法讀取', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', DATA_ROOT_UID, 'products', 'p1'), { id: 'p1' });
    });
    const db = asOther();
    await assertFails(getDoc(doc(db, 'users', DATA_ROOT_UID, 'products', 'p1')));
  });

  it('名單外 email 無法寫入', async () => {
    const db = asOther();
    await assertFails(setDoc(doc(db, 'users', DATA_ROOT_UID, 'products', 'p2'), { id: 'p2' }));
  });
});

describe('白名單但未驗證 email 全 deny', () => {
  it('email_verified:false 無法讀取', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', DATA_ROOT_UID, 'products', 'p1'), { id: 'p1' });
    });
    const db = asUnverified();
    await assertFails(getDoc(doc(db, 'users', DATA_ROOT_UID, 'products', 'p1')));
  });

  it('email_verified:false 無法寫入', async () => {
    const db = asUnverified();
    await assertFails(setDoc(doc(db, 'users', DATA_ROOT_UID, 'products', 'p2'), { id: 'p2' }));
  });
});

describe('未登入全 deny', () => {
  it('匿名使用者無法讀取', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', DATA_ROOT_UID, 'sales', 's1'), { id: 's1' });
    });
    const db = asAnon();
    await assertFails(getDoc(doc(db, 'users', DATA_ROOT_UID, 'sales', 's1')));
  });

  it('匿名使用者無法寫入', async () => {
    const db = asAnon();
    await assertFails(setDoc(doc(db, 'users', DATA_ROOT_UID, 'sales', 's2'), { id: 's2' }));
  });
});

describe('changelog append-only', () => {
  it('白名單可新增 changelog', async () => {
    const db = asUserA();
    const ref = doc(db, 'users', DATA_ROOT_UID, 'changelog', 'c1');
    await assertSucceeds(setDoc(ref, { id: 'c1', action: 'create', at: new Date().toISOString() }));
  });

  it('白名單可讀取 changelog', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', DATA_ROOT_UID, 'changelog', 'c1'), { id: 'c1' });
    });
    const db = asUserA();
    await assertSucceeds(getDoc(doc(db, 'users', DATA_ROOT_UID, 'changelog', 'c1')));
  });

  it('changelog 不可 update(append-only)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', DATA_ROOT_UID, 'changelog', 'c1'), { id: 'c1', action: 'create' });
    });
    const db = asUserA();
    await assertFails(updateDoc(doc(db, 'users', DATA_ROOT_UID, 'changelog', 'c1'), { action: 'tampered' }));
  });

  it('changelog 不可 delete(append-only)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', DATA_ROOT_UID, 'changelog', 'c1'), { id: 'c1' });
    });
    const db = asUserA();
    await assertFails(deleteDoc(doc(db, 'users', DATA_ROOT_UID, 'changelog', 'c1')));
  });

  it('名單外 email 無法新增 changelog', async () => {
    const db = asOther();
    await assertFails(setDoc(doc(db, 'users', DATA_ROOT_UID, 'changelog', 'c2'), { id: 'c2' }));
  });
});
