// 從 firestore.rules 動態抽取 isAllowed() 的白名單字面值。
// 測試以此值建立 Auth emulator 帳號,讓套件對齊實際部署的 rules(部署後測試不炸)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rulesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'firestore.rules');
const rules = fs.readFileSync(rulesPath, 'utf8');

const uidMatch = rules.match(/uid == '([^']+)'/);
if (!uidMatch) throw new Error('firestore.rules 找不到固定資料根 uid 字面值');
export const DATA_ROOT_UID = uidMatch[1];

const emailsMatch = rules.match(/email in \[([^\]]+)\]/);
if (!emailsMatch) throw new Error('firestore.rules 找不到 ALLOWED_EMAILS 陣列字面值');
export const ALLOWED_EMAILS = [...emailsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
