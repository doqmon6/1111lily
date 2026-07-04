// test-emulator.mjs
// 啟動 Firestore emulator 並執行 db.test.js。
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
};

// emulators:exec 的 <script> 參數必須是單一字串,這裡以字串指令執行避免 shell 拆參數。
const cmd = 'npx firebase emulators:exec --project demo-market-sales --only firestore "npx vitest run tests/db.test.js"';

const child = spawn(cmd, {
  env,
  stdio: 'inherit',
  shell: true,
  cwd: repoRoot,
});

child.on('exit', (code) => process.exit(code ?? 0));
