# 雲端同步 v3 — Firebase(Auth + Firestore 離線持久化)+ Sheets 鏡像 + 資料遷移

- 日期:2026-07-04
- 狀態:DRAFT(待使用者審查後才進實作)
- 作者:spec-architect(reviewed by: larry)
- 前身:`2026-05-30-market-sales-pwa-v2.md`(v2 場次/成本/帶貨/特例資料模型與報表)
- 來源:兩輪 critical-discussion 訪談收斂(錨定需求 A–F、已決策 1–5,見下)

---

## Summary

v2 是純本機 IndexedDB PWA,單機資料有遺失風險,且無法「手機記帳、電腦看報表」。v3 在**不改 v2 記帳熱路徑與資料模型**的前提下,把資料層從自寫 IndexedDB 換成 **Firebase Firestore(含 `persistentLocalCache` 離線持久化)**,並加上 **Firebase Auth Google 登入**(僅創作者一個帳號可讀寫)。成果:手機離線可記、寫入即落地本機、上線後自動同步、電腦開同網址即見同一份資料、零手動同步。

額外交付:①**append-only 修改歷史**(每次 sale 的 create/update/delete 留前後值,App 內可查);②**單向鏡像到 Google Sheets**(給人看的流水帳,以 id upsert、刪除標記不消失,fire-and-forget 不影響主資料流);③**資料遷移**(舊站 JSON 匯出 → 新站匯入,upsert 冪等),「正在用舊站記帳的創作者」由工程師交接時一次無損搬遷;④**工程師一次性設定 runbook**。JSON 匯出與全部 CSV 匯出保留為逃生門。

對創作者(非技術者)而言:日常只有「打開 App、Google 登入一次、照舊記帳」。所有雲端設定由工程師(larry)一次性完成。全程使用 Firebase Spark 免費方案 + 創作者名下 Apps Script,零費用、資料主權在創作者自己的 Google 帳號。

---

## Scope(In)

- Firestore 取代 IndexedDB 成為唯一資料層:重寫 `js/db.js` 為 Firestore 版,**保持相同對外函式簽章**,使 `logic.js` 與所有 `js/ui/*` 幾乎不動。
- Firebase Auth Google 登入;未登入不顯示記帳 UI(gate)。
- Firestore Security Rules:僅固定 UID(創作者)可讀寫。
- 離線持久化:`persistentLocalCache` + `persistentMultipleTabManager`,離線可記、上線自動同步。
- append-only 修改歷史 collection(sale 的 create/update/delete 前後值)+ App 內查看 UI(最小形式)。
- 「N 筆尚未備份」語意改為「**N 筆尚未上雲**」(Firestore 待同步 pending writes 數)。
- 資料遷移(JSON 匯入):既有「還原」升級為「匯入 JSON → 寫入 Firestore」(以文件 id upsert,冪等),跨網址/換機通用;本次交接由工程師一次執行(舊站匯出 → 新站匯入)。
- 單向 Google Sheets 鏡像(創作者名下 Apps Script Web App,`doPost`):每筆 sale 一列、以 id upsert —— 新增/編輯更新對應列、刪除標「已刪除」不消失;失敗有重試佇列、不影響主資料流。
- 部署改 Firebase Hosting(唯一主網址,解 iOS 登入相容);GitHub Pages 凍結退役 —— 開發全程不推送其發佈分支,交接後不再使用。
- 工程師一次性設定 runbook(建專案 → Auth → Firestore → rules → 部署 → Apps Script → 手機加主畫面 → 填 UID)。
- 測試資產盡量保留;單元測試改用 Firestore emulator(見「測試策略」)。

## Non-scope(明列不做,進 BACKLOG)

- **多人帳號 / 多創作者** — 僅單一固定 UID。
- **即時協作 / 線上狀態 / 共同編輯** — 單人使用,不需要。
- **Notion 整合** — 訪談已否決(CORS 需中繼、資料模型不合)。
- **Supabase** — 訪談已否決(免費方案閒置 7 天暫停)。
- **同源自動遷移 / 再部署 GitHub Pages** — 使用者裁決舊站交接後直接不用、不需引導頁;同源自動搬移的唯一價值(省一次手動匯出匯入)不敵其代價(雙部署、SW 升級風險、best-effort 登入),遷移走 JSON 匯出→匯入,由工程師交接時一次完成。
- **分析儀表板 / 趨勢圖** — 沿用 v2 北極星,系統只記乾淨資料。
- **自動 Google Drive 快照 / 排程備份** — 進 BACKLOG。
- **雙向 Sheets 同步 / 從 Sheets 回寫** — 只做單向鏡像(App → Sheets)。
- **改用 build step / 前端框架 / npm 打包 SDK** — 維持零 build step,Firebase SDK 以 CDN(ESM)引入(見決策 D-02)。
- **v2 記帳流程 / 報表算法 / CSV 欄位變更** — 全數沿用不動。

---

## Acceptance criteria(每條可測)

> 標記 `[MANUAL]` 者為工程師/創作者手動驗收(需真 Firebase 專案),其餘由自動化測試覆蓋。

1. **AC1 — 登入 gate**:未登入時只顯示登入畫面;Google 登入成功後顯示 v2 四分頁。登出後回登入畫面。→ 驗證:`auth.spec`(mock auth 狀態)+ `[MANUAL]` 真 Google 登入。
2. **AC2 — 僅創作者可讀寫**:Firestore rules 拒絕非固定 UID 的讀與寫。→ 驗證:`rules.test`(emulator + `@firebase/rules-unit-testing`,以他人 UID 讀寫應被 deny)。
3. **AC3 — 離線可記 + 寫入即落地**:斷網下記一筆銷售,重整頁面(仍離線)資料仍在;恢復連線後自動出現在另一裝置。→ 驗證:`sync.spec`(emulator + 模擬離線)+ `[MANUAL]` 雙裝置。
4. **AC4 — db.js 契約不變**:Firestore 版 `db.js` 對外函式簽章與回傳形狀與 v2 相同,既有 `logic.js`/`ui` 呼叫端不需改參數。→ 驗證:`db.test`(改跑 emulator)沿用 v2 的斷言集綠燈。
5. **AC5 — 資料模型對映**:products/sales/outings 三個 collection,文件 id 沿用既有 uuid;欄位與 v2 一致(見資料模型章)。→ 驗證:`db.test`「collection 對映」。
6. **AC6 — append-only changelog**:編輯一筆 sale 產生一筆 `type=update` 的 changelog(含 before/after);刪除產生 `type=delete`(含 before);新增產生 `type=create`(含 after)。changelog 不可被更新或刪除(rules 層擋)。→ 驗證:`changelog.test`(emulator)+ `rules.test`(update/delete changelog 應 deny)。
7. **AC7 — changelog 查看 UI**:App 內可開啟「修改歷史」清單,每列顯示「時間 / 動作(新增·編輯·刪除)/ 銷售摘要 / 改了什麼」。→ 驗證:`history.spec`。
8. **AC8 — 尚未上雲提醒**:有離線待同步寫入時顯示「N 筆尚未上雲」;全部同步後轉為「已全部上雲」。N 反映 Firestore pending writes(`snapshot.metadata.hasPendingWrites` / fromCache)。→ 驗證:`sync.spec`「pending writes 計數」。
9. **AC9 — 遷移(JSON 匯入)冪等**:匯入 v2 JSON 備份檔 → 三 collection 完整寫入 Firestore;以文件 id upsert,重複匯入不重複。→ 驗證:`migrate.test`「JSON 匯入冪等」+ `export.spec`。
10. **AC10 — 鏡像傳播編輯/刪除**:編輯一筆已鏡像的 sale → Sheet 對應列內容更新;刪除 → 該列「狀態」欄標「已刪除」而非消失。→ 驗證:`mirror.test`「upsert payload / 刪除標記 payload」+ `[MANUAL]` 真 Apps Script。
11. **AC11 — 開發期間舊站不受影響**:v3 所有變更於 feature branch 進行,交接完成前不推送 GitHub Pages 發佈分支(master);舊站全程維持 v2。→ 驗證:流程約束(交接前 `git log origin/master` 無 v3 commit),非自動化測試。
12. **AC12 — JSON 匯出保留**:仍可匯出完整 JSON 備份(逃生門),內容含 products/sales/outings。→ 驗證:`export.spec`「JSON 匯出」。
13. **AC13 — CSV 匯出不變**:v2 三種 CSV(場次明細 / 商品彙總 / 全部明細)欄位與 BOM 不變。→ 驗證:`export.spec` v2 既有斷言全綠。
14. **AC14 — Sheets 鏡像單向**:一筆 sale 同步成功後,對應列出現在創作者 Sheet;鏡像失敗(Apps Script 不可達)不影響 sale 已存 Firestore,且進重試佇列。→ 驗證:`mirror.test`(mock `fetch` 成功/失敗兩路徑)+ `[MANUAL]` 真 Apps Script 一次。
15. **AC15 — v2 熱路徑不退化**:商品 CRUD / 記銷售 / 場次報表 / 帶貨剩餘 / 特例類型 / 淨額全部行為與 v2 相同。→ 驗證:`products/sale/outing.spec` 沿用 v2 斷言(改跑於登入後狀態)全綠。
16. **AC16 — 全免費不觸發付費**:設定與日常使用維持 Spark 方案,無需綁信用卡 / 升 Blaze。→ 驗證:`[MANUAL]` runbook 檢查(專案計費為 Spark)。
17. **AC17 — 使用說明**:存在創作者使用說明文件(生活語言,含日常操作/離線行為/修改歷史/求助指引);App 內有低調「使用說明」連結導向 GitHub 說明頁,不干擾記帳熱路徑。→ 驗證:文件存在 + `shell.spec`「連結存在且 href 正確」+ `[MANUAL]` 點開可讀。

---

## 資料模型(Firestore)

### 頂層結構

所有資料放在**單一創作者文件下的子集合**,便於 rules 一句話鎖 UID,也預留日後(不在本次)多帳號隔離:

```
users/{uid}/products/{productId}
users/{uid}/sales/{saleId}
users/{uid}/outings/{outingId}
users/{uid}/changelog/{changeId}
```

- `{uid}` = 創作者 Firebase Auth UID(固定,由 runbook 填入 rules 與 App 設定)。
- `{productId}` / `{saleId}` / `{outingId}` = **沿用 v2 既有 uuid**(`crypto.randomUUID()`),確保遷移冪等 upsert。
- 欄位與 v2 IndexedDB 完全一致(`products`: id/name/price/cost/active/createdAt;`sales`: id/items/total/paymentMethod/outingId/type/createdAt/dateKey;`outings`: id/name/status/fixedCosts/brought/startedAt/closedAt)。
- **不新增業務欄位**;唯一新增為下方 changelog 子集合。

> 已確認(2026-07-04 使用者裁決):採「`users/{uid}/...` 巢狀」。理由:rules 最簡、資料主權邊界清晰、遷移路徑不受影響。

### changelog 子集合(append-only 修改歷史)

`users/{uid}/changelog/{changeId}`(`changeId` = `crypto.randomUUID()`):

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string(uuid) | 文件 id |
| `entity` | 'sale' | 本次僅記 sale(products/outings 不在需求範圍) |
| `entityId` | string | 對應 sale 的 uuid |
| `action` | 'create' \| 'update' \| 'delete' | 動作 |
| `before` | object \| null | 變更前完整 sale(create 為 null) |
| `after` | object \| null | 變更後完整 sale(delete 為 null) |
| `at` | ISO string | 發生時間 |

- **粒度**:每次 create/update/delete 一筆,存整份 before/after(sale 文件小,不需 diff 演算)。App 內查看時再由 UI 計算「哪些欄位變了」呈現。
- **append-only 保證**:靠 Firestore rules —— changelog 允許 `create`,禁止 `update` / `delete`(見 rules 草案)。
- **寫入時機**:與主資料寫入**同一批次**(`writeBatch`),保證「有改動必有紀錄」原子性(見「跨切面 — 原子性」)。

### Firestore Security Rules(草案)

工程師在 runbook 中把 `FIXED_UID` 換成創作者實際 UID(Firebase Console → Authentication → 該使用者 → User UID)。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 把 FIXED_UID 換成創作者的 Firebase Auth UID
    function isCreator() {
      return request.auth != null && request.auth.uid == 'FIXED_UID';
    }

    match /users/{uid}/{document=**} {
      allow read, write: if isCreator() && uid == 'FIXED_UID';
    }

    // changelog:append-only —— 僅允許新增,禁止改/刪
    match /users/{uid}/changelog/{changeId} {
      allow create: if isCreator() && uid == 'FIXED_UID';
      allow read:   if isCreator() && uid == 'FIXED_UID';
      allow update, delete: if false;
    }
  }
}
```

> 注意:`{document=**}` 的 write 規則會被更內層 `changelog` 的規則**覆蓋**(Firestore rules 內層 match 優先於外層萬用),故 changelog 的 update/delete deny 有效。`rules.test` 必須明確測此點。

---

## 跨切面(Cross-cutting concerns)

- **認證作為 gate**:`js/auth.js` 封裝 `onAuthStateChanged`;`app.js` 在拿到登入 user 前只 render 登入畫面。UID 不符固定值時登出並提示「此帳號無權限」。
- **多裝置衝突策略**:**Firestore 文件級 last-write-wins**(預設)。可接受理由:單人、低併發,同一人幾乎不會兩裝置同秒改同一筆;真的誤覆蓋時,append-only changelog 保留前後值可人工追溯還原。**不引入樂觀鎖 / 版本號**(過度設計)。
- **原子性**:主資料寫入 + 對應 changelog 寫入必須同批。用 Firestore `writeBatch`(update sale + create changelog 一起 commit)。離線時 batch 進 local queue,上線一起送。
- **冪等**:所有寫入以「既有 uuid 為文件 id」`set()`(upsert 語意),遷移可重跑不重複。
- **鏡像 fire-and-forget**:Sheets 推送在**寫入 Firestore 成功之後**觸發(非交易內),失敗不 rollback、不擋 UI;失敗列進 localStorage 重試佇列,下次上線/開 App 重送。
- **可觀測性**:遷移上傳、鏡像推送、rules 拒絕、登入失敗都 `console.*` 記錄(無後端,不設 metrics/alert)。「N 筆尚未上雲」是給創作者的可視指標。
- **離線持久化**:`initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })`。多分頁(電腦可能開多分頁)需 multi-tab manager 避免鎖衝突。

---

## 測試策略(單元測試如何處理 Firestore)

**選定:Firestore Emulator(`firebase-tools` + `@firebase/rules-unit-testing`),不做抽象層 mock。**

取捨說明:

- **選 emulator 的理由**:符合 user 準則「整合測試打真 DB,不用 mock,避免 mock 與遷移悄悄分歧」。`db.js` 的價值正是 Firestore 讀寫語意(offline cache、batch、rules),抽象層 mock 會把這些語意掏空,測了等於沒測;rules 更是只有 emulator 能測。
- **否決抽象層 mock 的理由**:為了讓 vitest 不碰 Firestore 而抽一層 `Repository` interface,是「為測試而生的抽象」,違反簡潔原則(單一實作不抽介面),且無法覆蓋 AC2/AC6 的 rules 行為。
- **代價與緩解**:emulator 需 Java + `firebase-tools`,CI 較重,本機首跑要 `firebase emulators:start`。緩解:測試分兩層 ——
  - **純函數層(`logic.test`)**:與 Firestore 無關,維持 vitest 原樣、零改動、最快。
  - **資料層 + rules + 遷移(`db.test` / `rules.test` / `changelog.test` / `migrate.test`)**:vitest 連 Firestore emulator(`FIRESTORE_EMULATOR_HOST`)。`migrate.test` 以 v2 JSON 備份檔 fixture 為來源,寫端用 emulator(目標)。
  - **e2e(Playwright)**:auth-mock + emulator Firestore 跑熱路徑;真 Google 登入為 `[MANUAL]`。
- `package.json` 加 `test:emulator` script 包 `firebase emulators:exec`。emulator 設定 `firebase.json` + `firestore.rules`(即上線用的同一份 rules,確保測的就是部署的)。
- **真 config 需求時點(流程閉環保證)**:M1–M6 全部開發與自動化測試以 **emulator + demo project id**(如 `--project demo-market-sales`)執行,**不需要真 Firebase 專案、真 config、真帳號或網路**;`js/firebase.js` 以佔位 config + emulator 偵測(測試旗標時 `connectFirestoreEmulator`)設計。真 config 只在 **M7** 部署與 `[MANUAL]` 驗收時由工程師依 runbook 提供——這是全計畫唯一需要人類帳號的停點。
- **環境需求**:Firestore emulator 需 **JDK 11+**;本機以 portable JDK 置於 repo `.tools/`(gitignore,不污染系統),`test:emulator` script 自設 `JAVA_HOME`(README 開發章節記載)。

> 已確認(2026-07-04 使用者裁決):e2e 採 auth-mock + emulator Firestore(避免 Playwright 跑真 Google OAuth 的脆弱性),真登入以 `[MANUAL]` 驗收。

---

## Milestones

> 排序原則:**雲端同步核心最早可驗證**。M1 先把「Firestore 資料層 + 離線持久化 + db.js 契約不變」立起來並用 emulator 驗證(此時尚未上線、不碰真帳號、不碰 auth),風險最小卻是全案地基;M2 加登入 + rules(HIGH);M3 加遷移(HIGH);M4 changelog;M5 上雲提醒語意;M6 Sheets 鏡像;M7 部署與發布順序(含 auth 真環境驗收)。每個 milestone 各自獨立可交付、可驗證。

### M1 — Firestore 資料層(離線持久化,契約不變)

- **Risk:** MED
- **風險分級理由**:新增寫路徑到「先前不存在的資料儲存」,屬關鍵路徑資料寫入;但此階段在 emulator、未上線、未碰 auth/真資料,故 MED 非 HIGH。
- **Files touched(估計)**:`js/db.js`(重寫)、`js/firebase.js`(新增:init app + firestore)、`firebase.json`+`firestore.rules`(emulator 用)、`package.json`(emulator script)、`tests/db.test.js`(改連 emulator)、`index.html`(引入 Firebase CDN ESM,import map)。
- **Steps:**
  1. 加 `js/firebase.js`:CDN ESM 引入 Firebase App + Firestore,`initializeFirestore` 開 `persistentLocalCache` + multi-tab → verify:`js/firebase.js` 匯出 `db`;`db.test` setup 能連 emulator 建連線。
  2. 重寫 `js/db.js` 全部函式為 Firestore 版,**保持相同簽章與回傳形狀**(products/sales/outings 的 add/get/getAll/update/delete/close/getOpenOuting/exportAll/importAll)→ verify:`db.test`(v2 斷言集)改連 emulator 後全綠。
  3. `addSale`/`updateSale` 保留 `dateKey` 計算與 `items` 快照語意不變 → verify:`db.test`「dateKey / items 快照」通過。
  4. `getSalesByOuting` / `getSalesByDate` 改 Firestore query(`where('outingId','==',...)` / `where('dateKey','==',...)`)→ verify:`db.test` 對應查詢測試通過。
  5. `logic.test` 完全不改仍全綠(證明純函數層零影響)→ verify:`npm run test:unit` logic 部分綠。
- **Tests:**
  - 單元/整合:`db.test`(products/sales/outings CRUD、query、exportAll/importAll)改連 emulator。
  - `logic.test` 原樣回歸。
- **Rollback**:此階段不上線、不動 GitHub Pages。回退 = 保留舊 `db.js`(IndexedDB)於 git 歷史,revert 該 commit 即回 v2。

### M2 — Google 登入 + Security Rules(權限閘門)

- **Risk:** HIGH
- **風險分級理由**:碰 auth / session;Firestore rules 是資料唯一防線,填錯 UID = 全世界可讀寫或創作者自己被鎖。
- **Files touched(估計)**:`js/auth.js`(新增)、`js/app.js`(登入 gate)、`index.html`(登入畫面容器)、`css/style.css`(登入畫面)、`firestore.rules`(正式 rules)、`tests/rules.test.js`(新增)、`tests/e2e/auth.spec.js`(新增)。
- **Steps:**
  1. `js/auth.js` 封裝 Firebase Auth Google provider + `onAuthStateChanged` + `signIn`/`signOut` → verify:`auth.spec`(mock)登入狀態切換觸發對應 render。
  2. `app.js`:未登入只 render 登入畫面;登入後才 `showView`;UID ≠ 固定值則登出並提示無權限 → verify:`auth.spec`「未登入不顯示分頁」「錯帳號被擋」。
  3. 寫正式 `firestore.rules`(上方草案),`FIXED_UID` 以佔位 + runbook 指示 → verify:`rules.test` —— 正確 UID 可讀寫、他人 UID 全 deny。
  4. changelog update/delete 於 rules 層 deny → verify:`rules.test`「changelog append-only」。
  5. `[MANUAL]` 真專案:創作者 Google 登入成功、他人帳號無法讀資料 → verify:runbook 驗收表打勾。
- **Tests:**
  - `rules.test`(emulator + `@firebase/rules-unit-testing`):固定 UID vs 他人 UID vs 未登入。
  - `auth.spec`(Playwright,auth 狀態 mock)。
- **Rollback**:登入 gate 以 feature flag(常數)包住,可暫時放行(僅開發用)。rules 部署錯 → Firebase Console 立即改回全 deny(`allow read,write: if false`)止血,再修 UID。**rules 部署前必經 `rules.test` 綠燈**。

### M3 — 資料遷移(JSON 匯入 → Firestore,冪等)

- **Risk:** HIGH
- **風險分級理由**:一次性搬移創作者「正在進行中的場次」真實資料;錯誤 = 重複列或丟資料。
- **Files touched(估計)**:`js/db.js`(`importAll` 走 Firestore upsert)、`js/ui/exporter.js`(JSON 匯入寫 Firestore、按鈕文案)、`tests/migrate.test.js`(新增)。
- **Steps:**
  1. `db.js` 的 `importAll`:接收 v2 JSON 備份物件(products/sales/outings),批次 `set()`(以既有 uuid 為文件 id)upsert 到 Firestore → verify:`migrate.test`「匯入後三 collection 筆數與內容正確」。
  2. 冪等:重複匯入同一份 JSON 不新增重複文件、不覆壞後續新增的資料 → verify:`migrate.test`「匯入兩次結果相同」「匯入後新增一筆再重匯,新筆仍在」。
  3. `exporter.js` 的 `onRestore`:語意由「覆蓋本機」改為「匯入並上傳雲端」(upsert,不清空既有雲端資料);文案更新並顯示匯入筆數摘要 → verify:`export.spec`「JSON 匯入 → Firestore」。
  4. 匯入含格式檢查:非 v2 備份格式給明確錯誤訊息、不寫入任何資料 → verify:`migrate.test`「壞檔不寫入」。
- **Tests:**
  - `migrate.test`(emulator):JSON fixture 匯入、冪等雙跑、壞檔防護。
  - `export.spec`(Playwright):UI 匯入流程 + 匯入後報表可見資料。
- **Rollback**:遷移是**加法**(upsert),不刪任何來源;JSON 檔與舊站 IndexedDB 都完好。出錯可清空 Firestore(創作者專案)後重匯。

### M4 — append-only 修改歷史(changelog + 查看 UI)

- **Risk:** MED
- **風險分級理由**:新增寫路徑(每次 sale 變更多寫一筆),與主寫入同 batch;非 auth/migration,故 MED。
- **Files touched(估計)**:`js/db.js`(`addSale`/`updateSale`/`deleteSale` 併寫 changelog via `writeBatch`)、`js/ui/history.js`(新增查看 UI)、`index.html`+分頁或入口、`tests/changelog.test.js`(新增)、`tests/e2e/history.spec.js`(新增)。
- **Steps:**
  1. `db.js`:`addSale`/`updateSale`/`deleteSale` 用 `writeBatch`,同批寫 sale 文件 + changelog(create/update/delete,含 before/after)→ verify:`changelog.test`「三種動作各產生一筆正確 before/after」。
  2. 原子性:batch commit 失敗則 sale 與 changelog 都不寫 → verify:`changelog.test`「batch 失敗不留半筆」(以 emulator 觸發錯誤或斷言批次語意)。
  3. `history.js`:讀 changelog(依 `at` 倒序),每列「時間 / 動作 / 銷售摘要 / 改了什麼(UI 端比對 before/after 欄位)」→ verify:`history.spec`「編輯一筆後歷史出現 update 列並標示變更欄位」。
  4. changelog 唯讀入口(App 內,不提供刪改)→ verify:`history.spec` 無編輯/刪除控制項。
- **Tests:**
  - `changelog.test`(emulator):create/update/delete 前後值、batch 原子性。
  - `history.spec`(Playwright):歷史列表呈現與變更標示。
- **Rollback**:changelog 為附加資料,移除入口 UI + 還原 `db.js` 為單寫(不 batch changelog)即回 M3 狀態;既有 changelog 文件無害保留。

### M5 — 「N 筆尚未上雲」提醒(語意置換)

- **Risk:** LOW
- **風險分級理由**:唯讀狀態呈現,以 Firestore metadata 計 pending;不改寫路徑、不改資料。
- **Files touched(估計)**:`js/ui/exporter.js`(提醒文案與計數來源)或抽 `js/ui/syncStatus.js`、`tests/e2e/sync.spec.js`(新增/改)。
- **Steps:**
  1. 以 Firestore `onSnapshot` 的 `snapshot.metadata.hasPendingWrites` / `fromCache` 計算未同步寫入數 → verify:`sync.spec`「離線寫入 → 顯示 N 筆尚未上雲」。
  2. 全部同步後轉「已全部上雲」→ verify:`sync.spec`「恢復連線 → 歸零」。
  3. 移除 v2 基於 `localStorage lastBackupAt` 的「尚未備份」語意(JSON 備份改為純逃生門,不再驅動提醒)→ verify:`export.spec` 不再斷言舊「尚未備份」文案。
- **Tests:**
  - `sync.spec`(Playwright + emulator + 模擬離線):pending 計數、歸零。
- **Rollback**:提醒為純資訊,移除元件不影響資料。可暫回顯示固定提示「請確認已連線」。

### M6 — Google Sheets 單向鏡像(fire-and-forget + 重試佇列)

- **Risk:** MED
- **風險分級理由**:新增外部 I/O(HTTP 到 Apps Script),但在交易外、失敗不影響主資料;非關鍵路徑。
- **Files touched(估計)**:`js/mirror.js`(新增:推送列 + 重試佇列)、`js/db.js` 或同步層(sale 寫成功後觸發)、`tests/mirror.test.js`(新增)、runbook(Apps Script 設定)。
- **方案選定**:**創作者名下 Apps Script Web App(`doPost`,`Content-Type: text/plain` 繞 CORS preflight)**。
  - 否決 Cloud Functions:需 Blaze(違反全免費 E)。
  - 否決依賴 Auth OAuth access token 背景寫 Sheets:token 一小時過期、Firebase 不自動刷新,不可靠。
  - Apps Script 以創作者身分部署(資料主權在創作者)、一次性設定、免費、`text/plain` 避開 preflight。
- **鏡像語意(2026-07-04 使用者裁決後重設計)**:**每筆 sale 一列、以 sale id upsert;列永不消失**。
  - 否決 append-only 只追加:App 端編輯/刪除後試算表會殘留錯誤舊資料,直接違反創作者核心需求「資料正確性」(需求 C)。
  - **欄位**(單一工作表,首欄 id 供 upsert 定位,可設窄/隱藏):`id | 日期 | 時間 | 場次 | 類型 | 商品明細 | 總金額 | 付款方式 | 狀態`。商品明細為人讀格式(如「娃娃×2、鑰匙圈×1」);`狀態` = 空(正常)/「已刪除」。
  - 選「每筆一列」而非「每商品一列」:試算表職責是人看的流水帳與對帳(總金額欄可直接 SUM),商品維度分析 App 場次報表已做得更好;每商品一列會使總金額重複、加總出錯。
  - **傳播規則**:create/update → 推送該 sale 最新完整狀態(Apps Script 依 id 找列,有則整列更新、無則追加);delete → 推送刪除標記(該列 `狀態`=已刪除,其餘欄保留供對帳)。
  - **重試佇列存 sale id 而非事件**:重送時取該筆「目前」狀態推送,天然避免離線多次修改後亂序覆蓋。
- **Steps:**
  1. Apps Script `doPost` 腳本(runbook 交付物):接 `text/plain` JSON `{id, date, time, outing, type, items, total, payment, deleted}`,依首欄 id upsert 列;`deleted=true` 時標「已刪除」→ verify:`[MANUAL]` 腳本單獨測三動作(新增/更新/刪除標記)。
  2. `mirror.js`:sale create/update/delete 成功寫入 Firestore 後(非交易內),組列 payload `fetch(APPS_SCRIPT_URL, { method:'POST', body: JSON.stringify(payload), headers:{'Content-Type':'text/plain'} })` → verify:`mirror.test`「三種動作 payload 欄位正確(含刪除標記)」。
  3. 失敗(網路/非 2xx)→ sale id 進 localStorage 重試佇列,不擋 UI、不影響 Firestore 已寫 → verify:`mirror.test`「失敗不 throw、id 入佇列去重」。
  4. 開 App / 恢復連線時重送佇列:以佇列中 id 取 Firestore 目前狀態(已刪除者送刪除標記)推送,成功出列 → verify:`mirror.test`「重送取最新狀態、成功後清空」。
  5. `[MANUAL]` 真 Apps Script:記一筆 → Sheet 出現列;編輯 → 列更新;刪除 → 列標已刪除 → verify:runbook 驗收。
- **Tests:**
  - `mirror.test`(vitest,mock `fetch`):三動作 payload、失敗入佇列去重、重送取最新狀態、成功清空。
- **Rollback**:鏡像完全獨立,設 `APPS_SCRIPT_URL` 為空即停用,主資料流不受影響。

### M7 — 部署與發布(Firebase Hosting + 交接)

- **Risk:** MED
- **風險分級理由**:auth 真環境相容性(iOS Safari)與首次上線;已無「舊站時序耦合」(舊站凍結不再部署,新站是全新網址、無 in-flight 使用者)。真正的交接風險由發布順序專章的 JSON 交接流程 + M3 冪等守住。
- **Files touched(估計)**:`sw.js`(快取版本升 `market-sales-v8`、ASSETS 加新檔)、`firebase.json`(Hosting)、可選 `.github/workflows/deploy.yml`(僅部署 Firebase Hosting,見 AC11 約束)、`README.md`/runbook。
- **Steps:**
  1. `sw.js`:CACHE 升版、ASSETS 補入 `firebase.js`/`auth.js`/`mirror.js`/`history.js`;Firebase SDK 由 CDN(不進 precache,走網路,離線由 Firestore persistent cache 兜底)→ verify:`shell.spec`「SW 啟用、離線 App shell 可開」。
  2. 部署 Firebase Hosting(唯一主網址)→ verify:`[MANUAL]` 網址可開、可 Google 登入(手機 + 電腦)。
  3. 依發布順序專章完成交接(舊站 JSON 匯出 → 新站匯入)→ verify:`[MANUAL]` 交接驗收(筆數/報表與舊站一致)。
  4. 可選 `.github/workflows/deploy.yml`:push 自動部署 **Firebase Hosting**(不得觸發 GitHub Pages 更新;交接完成前 v3 不進 master)→ verify:`[MANUAL]` push 後線上更新。
- **Tests:**
  - `shell.spec`(Playwright):SW 版本、離線 App shell。
- **Rollback**:Firebase Hosting `firebase hosting:rollback` 回上一版;舊站(GitHub Pages v2)全程未動,資料在創作者手機 IndexedDB + JSON 檔,隨時可退回舊站繼續記。

### M8 — 文件(README v3 + 創作者使用說明 + App 內連結)

- **Risk:** LOW
- **風險分級理由**:純文件與一個靜態連結,不動資料與熱路徑。
- **Files touched(估計)**:`README.md`(v3 改寫:功能/資料安全新語意/開發測試含 emulator+JDK/部署)、`docs/USER-GUIDE.md`(新增:創作者使用說明,生活語言)、`index.html`(匯出/關於區域加「使用說明」連結)、runbook 段落定稿。
- **Steps:**
  1. `docs/USER-GUIDE.md`:創作者視角——登入、記帳照舊、離線會自動補傳、「N 筆尚未上雲」是什麼、電腦看報表、修改歷史怎麼看、Sheet 流水帳、出問題找工程師的檢查清單 → verify:文件涵蓋 AC17 列點。
  2. `README.md` 改寫:v3 架構、資料安全段更新(雲端同步後的語意)、開發/測試(emulator、portable JDK)、部署與 runbook 連結 → verify:人工核對與規格一致。
  3. `index.html` 於匯出分頁尾部加「使用說明」外連(GitHub `docs/USER-GUIDE.md` 頁面,`target=_blank`),樣式低調 → verify:`shell.spec`「連結存在、href 正確」。
- **Tests:** `shell.spec` 連結斷言。
- **Rollback**:移除連結與文件即可,無資料影響。

---

## 遷移與發布順序(硬約束:創作者正在用舊站記帳)

創作者「今天(2026-07-04)」正用 **GitHub Pages 舊站**記一場四天場次(第一天未記、今天起記)。使用者已裁決:交接後舊站直接不再使用、不需引導頁。

**最高優先硬約束 —— master 凍結**:GitHub Pages 由本 repo 的 **master 分支根目錄**發佈,**開發期間任何 push 到 origin/master 都會即時改掉創作者正在用的舊站**。因此:

- v3 全部開發在 feature branch(如 `v3-cloud-sync`)進行,**交接驗證完成前絕不 push master**(AC11)。
- Firebase Hosting 部署走 `firebase deploy`(讀本機/branch 檔案),與 GitHub Pages 無關,可在交接前先上線。

**時序安排:**

1. **開發期(創作者無感)**:M1–M6 於 feature branch 完成並過測試;工程師依 runbook 完成 Firebase 專案設定(`FIXED_UID`、rules、Apps Script);部署 Firebase Hosting(新網址,尚無人使用)。線上舊站全程維持 v2,creator 照舊記帳。
2. **交接(場次結束後,工程師親自執行一次)**:
   1. creator 手機開**舊站** → 匯出「JSON 備份」(v2 既有功能,含這幾天記的全部資料)。
   2. 開**新網址** → Google 登入 → 「從備份匯入」該 JSON → M3 upsert 寫入 Firestore。
   3. 驗收:新站場次報表筆數/金額與舊站一致;電腦開新網址登入,同樣看得到。
   4. 手機「加到主畫面」換成新網址;告知 creator 以後只用新的。
3. **交接後**:所有記帳直接進 Firestore(離線亦可,「N 筆尚未上雲」提醒);舊站不再使用。手機裡舊站的 IndexedDB **不主動清除**(留作二次逃生)。
4. **收尾(可選)**:交接驗證成功後,v3 合併回 master;GitHub Pages 可於 repo Settings 直接停用(或放著,反正已無人使用且新版本身也能跑)。
5. **逃生門**:匯入若失敗,JSON 檔本身就是完整備份、舊站與其本機資料原封不動,隨時可退回舊站繼續記,擇日重試。

---

## 工程師設定 runbook(交付物,由 larry 一次性執行)

> 這是 v3 交付的一部分,寫入 `README.md` 或 `docs/` 對應段落。以下為內容大綱,實作時填實際點擊路徑。

1. **建 Firebase 專案**:用**創作者的 Google 帳號**登入 Firebase Console → 新增專案(資料主權在創作者名下)→ 保持 **Spark(免費)方案**,不綁信用卡。
2. **開 Authentication**:啟用 **Google** 登入提供者;把 Firebase Hosting 網域加入授權網域。
3. **開 Firestore**:建立 Cloud Firestore(正式模式)。
4. **取得創作者 UID**:創作者先在部署好的 App 用 Google 登入一次 → Console → Authentication → 該使用者 → 複製 **User UID**。
5. **填 rules**:把 `firestore.rules` 的 `FIXED_UID` 換成該 UID → `firebase deploy --only firestore:rules`(或 Console 貼上)。**部署前先跑 `npm run test:emulator` 確認 rules 綠燈**。
6. **設 App 端 Firebase config**:把專案的 web config(apiKey 等)填入 `js/firebase.js`。
7. **部署 Hosting**:`firebase deploy --only hosting`(唯一主網址;**不碰 GitHub Pages / master**)。
8. **設 Apps Script 鏡像**:在**創作者 Google 帳號**新增 Apps Script → 綁定目標試算表 → 貼 `doPost` 腳本(接 `text/plain` JSON、依首欄 id upsert 列、刪除標記)→ 部署為 Web App(執行身分=創作者、存取=任何人)→ 取得 URL 填入 `js/mirror.js` 的 `APPS_SCRIPT_URL`。
9. **交接**(場次結束後):舊站匯出 JSON → 新站登入匯入 → 驗證筆數/報表一致 → 手機「加到主畫面」換新網址(見發布順序專章)。
10. **驗收清單**:登入成功、記一筆同步、另一裝置可見、Sheet 出現列(編輯會更新、刪除有標記)、rules 擋他人、匯入筆數一致、`[MANUAL]` AC 逐項打勾。

---

## 決策紀錄表

| # | 決策點 | 選擇 | 否決 / 理由 | 來源 |
|---|---|---|---|---|
| D-01 | 後端平台 | Firebase(Firestore + Auth + Hosting) | Notion(CORS 需中繼、模型不合)、Supabase(閒置 7 天暫停) | 訪談已決策 1 |
| D-02 | 引入 SDK 方式 | CDN ESM(維持零 build step) | npm 打包(需引入 build,違反現有零 build 原則) | 訪談技術事實 + user 準則 |
| D-03 | 資料層策略 | 重寫 `db.js` 為 Firestore、**保持函式簽章不變** | 大改 UI(所有 ui 都只透過 db.js,契約不變即免動) | 程式碼證實(5 個 ui 檔僅 import db.js)|
| D-04 | 離線持久化 | `persistentLocalCache` + multi-tab manager | memoryCache(不落地,違反需求 A);single-tab(電腦多分頁會鎖) | 訪談需求 A + 決策 1 |
| D-05 | Firestore 結構 | `users/{uid}/{collection}` 巢狀 | 頂層集合 + 每文件檢查 uid(rules 較繁) | 2026-07-04 已確認 |
| D-06 | 衝突策略 | 文件級 last-write-wins | 樂觀鎖/版本號(單人低併發過度設計);changelog 兜可追溯 | 訪談要求 + user 準則(不過度設計)|
| D-07 | changelog 粒度 | 存整份 before/after,UI 端算 diff | 存欄位級 diff(sale 小,不值得複雜化);僅記 sale(products/outings 非需求) | 訪談需求 C② |
| D-08 | changelog append-only 保證 | Firestore rules deny update/delete | 僅靠 App 端不寫(不可信,rules 才是防線) | 訪談需求 C② |
| D-09 | 測試 Firestore | Emulator（rules+data） | 抽象層 mock（掏空語意、測不到 rules、為測試而抽象) | user 準則(整合打真 DB)|
| D-10 | Sheets 鏡像通道 | 創作者 Apps Script `doPost`(text/plain 繞 preflight)| Cloud Functions(需 Blaze);依賴 Auth OAuth token(1 小時過期不刷新) | 訪談技術事實 + 需求 E |
| D-11 | 鏡像失敗語意 | fire-and-forget + localStorage 重試佇列 | 擋 UI / rollback 主寫(鏡像非關鍵路徑) | 訪談要求 |
| D-12 | 「尚未備份」提醒 | 改語意為「N 筆尚未上雲」(pending writes) | 保留舊 localStorage 備份語意(雲端後已無意義) | 訪談要求 |
| D-13 | JSON / CSV 匯出 | 全數保留(JSON 為逃生門,CSV 不動) | 移除(逃生門與資料主權需要) | 訪談需求 C③ / F |
| D-14 | 主網址 | Firebase Hosting 唯一;GitHub Pages 凍結退役(開發期間 master 凍結,交接後不用、不設引導頁) | 只留 GitHub Pages(iOS 登入相容性);雙網址並行(誤入風險、雙入口混淆) | 2026-07-04 使用者裁決 |
| D-15 | 遷移策略 | 單一路徑:舊站 JSON 匯出 → 新站匯入(upsert 冪等、不刪來源),工程師交接一次執行 | 同源自動上傳(需再部署舊站,與 D-14 退役矛盾;省一次手動的價值不敵雙部署/SW 風險) | 2026-07-04 使用者裁決 + 推導 |
| D-16 | Sheets 鏡像語意 | 每筆 sale 一列、以 id upsert;刪除標「已刪除」列不消失;重試佇列存 id 取最新狀態 | append-only 只追加(編輯/刪除後表格殘留錯誤資料,違反需求 C);每商品一列(總金額重複、SUM 出錯) | 2026-07-04 使用者授權自行設計 |
| D-17 | e2e auth 處理 | auth-mock + emulator Firestore;真 Google 登入 `[MANUAL]` | Playwright 跑真 OAuth(脆弱、依賴真帳號) | 2026-07-04 已確認 |

---

## Open questions — 已全數裁決(2026-07-04)

1. **Firestore 結構** → 採 `users/{uid}/...` 巢狀(D-05)。
2. **e2e auth 處理** → auth-mock + emulator Firestore,真登入 `[MANUAL]`(D-17)。
3. **GitHub Pages 定位** → 凍結退役、不設引導頁;開發期間 master 凍結為硬約束(D-14 / AC11);同源自動遷移一併移出範圍(D-15)。
4. **Sheets 鏡像 schema** → 使用者授權自行設計:每筆一列 + id upsert + 刪除標記(D-16)。
5. **Hosting 免費流量額度查證** — Firebase 官方 pricing(查證日 2026-07-04)標示 Hosting **storage 10 GB、data transfer 360 MB/day(≈10.8 GB/月)**;Spark 方案文件未明列「閒置暫停」,依訪談事實與 Firestore/Hosting 性質判定**不會閒置暫停**(有別於 Supabase)。runbook 首月觀察用量(本 App 流量極小,遠低於額度)。

---

## Out of scope but worth noting

- **Firestore 每日讀額度(50K)**:本 App 單人使用遠低於額度;但若日後把「全部 sales」在每次開 App 全量 `getAll` 會隨資料成長吃讀數。目前 v2 报表就是全量讀,量級對單人無虞;**若未來資料量大,考慮改 query 分頁**(進 BACKLOG,非本次)。
- **changelog 只記 sale**:products/outings 的修改歷史不在需求內;若日後要「改價/改帶貨也留痕」,同一 changelog 結構可擴 `entity`(進 BACKLOG)。
- **自動 Drive 快照 / 排程 JSON 備份**:進 BACKLOG(訪談明列非目標)。
- **多帳號 / 多創作者**:`users/{uid}` 結構已為未來預留隔離邊界,但 rules 目前硬鎖單一 UID;真要多人需重開需求(進 BACKLOG)。

---

**下一步**:Open questions 已全數裁決並修訂入規格(2026-07-04),使用者已核准進 Phase 4。實作順序 M1 → M8,雲端同步核心(M1–M3)最早可獨立驗證。**全程於 feature branch `v3-cloud-sync` 開發,逐 milestone commit,交接前不 push master(AC11);真 Firebase config 僅 M7 需要(唯一人類停點)。**
