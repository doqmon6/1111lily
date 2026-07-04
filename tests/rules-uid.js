// 從 firestore.rules 動態抽取 isCreator() 的 UID 字面值。
// 測試以此值建立 Auth emulator 帳號,讓套件在「佔位 FIXED_UID」與
// 「runbook 填入真實 UID 後」兩種狀態下都能跑(部署後測試不炸)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rulesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'firestore.rules');
const rules = fs.readFileSync(rulesPath, 'utf8');
const m = rules.match(/request\.auth\.uid == '([^']+)'/);
if (!m) throw new Error('firestore.rules 找不到 isCreator() 的 UID 字面值');

export const RULES_UID = m[1];
