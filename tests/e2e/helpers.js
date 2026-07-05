// e2e 共用 helper:emulator 模式登入 + 資料隔離清除。
// 所有 spec 在 emulator 模式下跑:URL 帶 ?emu=1,Auth emulator 完成登入。
import { DATA_ROOT_UID, ALLOWED_EMAILS } from '../rules-uid.js';

const PROJECT_ID = 'demo-market-sales';
const FIRESTORE_CLEAR_URL = `http://localhost:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_CLEAR_URL = `http://localhost:9099/emulator/v1/projects/${PROJECT_ID}/accounts`;

/** 清空 Firestore emulator 所有資料。在每個 test beforeEach 呼叫。 */
export async function clearFirestore() {
  await fetch(FIRESTORE_CLEAR_URL, { method: 'DELETE' });
}

/** 清空 Auth emulator 所有帳號。spec 間呼叫避免殘留 session。 */
export async function clearAuthAccounts() {
  // Bearer 任意非空字串 = emulator admin mode
  await fetch(AUTH_CLEAR_URL, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
}

const E2E_EMAIL = ALLOWED_EMAILS[0];
const E2E_PASSWORD = 'e2e-password-123';

/**
 * 以 admin REST 在 Auth emulator 預建帳號(email 屬白名單、emailVerified:true)。
 * firestore.rules 以 email 白名單 + email_verified 把關,讓 e2e 跑在「部署那份 rules」之下
 * (與 db.test.js 同一技巧)。
 * 註:signInWithCredential 的假 token 不會拿 sub 當 uid(emulator 隨機發),
 * 只有 admin API 的 localId 能指定 uid,故走 email/password。
 */
async function ensureCreatorAccount() {
  await fetch(
    `http://localhost:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        localId: DATA_ROOT_UID,
        email: E2E_EMAIL,
        password: E2E_PASSWORD,
        emailVerified: true,
        returnSecureToken: true,
      }),
    },
  );
}

/** 在 page 內完成 emulator 登入(白名單 email)。需先以 ?emu=1 開啟頁面。 */
export async function loginWithEmulator(page) {
  await ensureCreatorAccount();
  await page.evaluate(
    async ({ email, password }) => {
      const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
      await signInWithEmailAndPassword(getAuth(), email, password);
    },
    { email: E2E_EMAIL, password: E2E_PASSWORD },
  );
  // 等待 app 主介面出現(onAuth 完成後顯示)
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
}

/** goto 帶 ?emu=1 並完成登入,確保 app 主介面可見。 */
export async function gotoAndLogin(page, path = '/index.html') {
  await page.goto(`${path}?emu=1`);
  await loginWithEmulator(page);
}
