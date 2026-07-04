// test-emulator.mjs
// 啟動 Firestore + Auth emulator 並執行指定測試。
// 預設:db.test.js + rules.test.js。
// 可傳自訂測試指令作為第一個參數,例如:
//   node tools/test-emulator.mjs "npx vitest run tests/rules.test.js"
// 自動設定 JAVA_HOME 指向 repo 內的 portable JDK,不依賴系統 Java。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const jdkDir = resolve(repoRoot, '.tools', 'jdk-21.0.11+10-jre');

const sep = process.platform === 'win32' ? ';' : ':';
const env = {
  ...process.env,
  JAVA_HOME: jdkDir,
  PATH: `${resolve(jdkDir, 'bin')}${sep}${process.env.PATH}`,
  // 讓 firebase.js 在 Node 環境也連 Auth emulator
  // db.test.js 的 signInWithEmailAndPassword 才能傳 auth token 給 Firestore
  FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
};

// 允許外部傳入自訂測試指令(e2e emulator script 用)
const customCmd = process.argv[2];
// --fileParallelism=false:db.test / migrate.test 共用同一個 emulator project 並各自清庫,
// 平行執行會互相清掉對方的資料與 Auth 帳號,必須序列。
const testCmd = customCmd
  ?? 'npx vitest run --fileParallelism=false --sequence.concurrent=false tests/db.test.js tests/rules.test.js tests/migrate.test.js tests/changelog.test.js tests/mirror.test.js';

// emulators:exec 的 <script> 參數必須是單一字串
const cmd = `npx firebase emulators:exec --project demo-market-sales --only firestore,auth "${testCmd}"`;

const child = spawn(cmd, {
  env,
  stdio: 'inherit',
  shell: true,
  cwd: repoRoot,
});

child.on('exit', (code) => process.exit(code ?? 0));
