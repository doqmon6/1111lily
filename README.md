# 市集銷售記錄 PWA

給手作創作者擺攤用的**離線優先**手機網頁 App。商品清單點選快速記銷售、依場次報表對帳、CSV/JSON 匯出。

v3 架構：PWA + Firebase Auth(Google 登入) + Firestore 離線持久化。資料主權在創作者自己的 Google 帳號;手機離線照記，連線後自動上雲；任何裝置登同一帳號即見同一份資料。

→ 創作者使用說明請見 [docs/USER-GUIDE.md](docs/USER-GUIDE.md)

---

## 功能

- **Google 登入**:創作者與一位協作者的 Google 帳號皆可登入（email 白名單），共用同一本帳；未登入不顯示記帳 UI。
- **雲端同步**:寫入即落地本機，上線自動上雲；「N 筆尚未上雲」提醒待同步筆數，不需手動操作。
- **商品**:新增/編輯/停售商品（品名、單價、成本）。
- **場次**:開/收場；帶貨量、固定成本；剩貨自動算。
- **記銷售**:點商品 → 調數量 → 選付款方式/類型 → 結帳；現場可新增商品；支援贈送/補送特例（出貨但不計收入）；無進行中場次時自動切換為線上模式。
- **線上銷售**:記帳目標可選「本場次」或「線上」（非擺攤現場的匯款/私訊成交），線上模式可選日期（補記舊匯款）並填備註（買家 IG/信箱/姓名等）；備註欄位所有銷售皆可填。
- **「線上」分頁**:按月檢視線上銷售、月營收小計，可編輯（含日期/備註）或刪除單筆。
- **場次報表**:收入 / 淨額 / 現金・轉帳 / 成本 / 每日分計 / 商品帶賣剩排行；可編輯或刪除單筆銷售。
- **修改歷史**:每次銷售新增/編輯/刪除都留前後值紀錄，App 內可查；append-only，不可改刪。
- **Google Sheets 鏡像**:每筆銷售自動同步到創作者名下試算表；以 id upsert（編輯更新列、刪除標「已刪除」不消失）；失敗自動重試，不影響主資料流。
- **匯出**:場次銷售明細 CSV、場次商品彙總 CSV、全部明細 CSV（UTF-8 BOM，Excel 開繁中不亂碼）。
- **JSON 備份/還原**:匯出完整 JSON；匯入時合併上傳到 Firestore（upsert 冪等，不刪既有資料）；換機/工程師交接用。

---

## 資料安全

三層保障：

1. **雲端自動同步**：每筆記帳寫入 Firestore，創作者 Google 帳號下的雲端是主要儲存位置。
2. **本機離線快取**：Firestore 離線持久化讓你的手機也常駐一份，斷網照用。
3. **JSON 逃生門**：隨時可從「匯出」分頁下載 JSON 備份檔；換機或需要保險時用。

> v2 的「資料只存在這支手機、務必手動備份」語意在 v3 已不適用。建議仍**把 App 加到主畫面**以確保 PWA 持久儲存許可。

---

## 開發與測試

需要 Node.js。

```bash
npm install                        # 安裝開發/測試相依
npm run serve                      # 本機啟動 http://localhost:4173
npx playwright install chromium    # 首次跑 e2e 前安裝瀏覽器
```

### npm scripts

| 指令 | 說明 |
|---|---|
| `npm run serve` | 本機靜態伺服器（port 4173） |
| `npm run test:unit` | 純函數層單元測試（vitest，不需 emulator） |
| `npm run test:emulator` | 資料層 + rules + 遷移 + changelog + 鏡像整合測試（需 emulator） |
| `npm run test:e2e:emulator` | Playwright e2e + emulator（完整整合驗收） |
| `npm test` | vitest 單元 + Playwright e2e |

### Firestore emulator 環境

`test:emulator` 與 `test:e2e:emulator` 需要 **JDK 11+**。

本 repo 以 **portable JDK** 方式處理，避免汙染系統：

- 放置路徑：`.tools/jdk-21.0.11+10-jre/`（gitignore，不進版控）
- 版本：`jdk-21.0.11+10-jre`（Adoptium/Temurin JRE 21）
- `tools/test-emulator.mjs` 在啟動 emulator 前自動設定 `JAVA_HOME` 指向此目錄

**首次設定步驟：**

1. 從 [Adoptium](https://adoptium.net/temurin/releases/) 下載 JRE 21（JRE，非 JDK；選對應作業系統）。
2. 解壓縮後，把整個資料夾放到 repo 根目錄下的 `.tools/`，確認路徑為 `.tools/jdk-21.0.11+10-jre/bin/java`（Windows 為 `java.exe`）。
3. 執行 `npm run test:emulator` 確認 emulator 正常啟動。

---

## 部署 runbook（工程師一次性設定）

以下步驟由工程師（larry）在交接前執行一次。**全程使用創作者的 Google 帳號**（資料主權在創作者名下）。

> ⚠️ **開發期間絕不 push master**：GitHub Pages 由本 repo 的 master 分支發佈，push master 會即時改掉創作者正在使用的舊站（v2）。v3 所有開發在 feature branch `v3-cloud-sync` 進行；Firebase Hosting 部署走 `firebase deploy`，與 GitHub Pages 完全無關。

### Step 1：建 Firebase 專案

1. 用**創作者的 Google 帳號**登入 [Firebase Console](https://console.firebase.google.com/)。
2. 點「新增專案」，輸入專案名稱。
3. 方案選「**Spark（免費）**」，不綁信用卡。

### Step 2：開啟 Authentication

1. 左側選單「Build → Authentication」→「開始使用」。
2. 在「Sign-in method」分頁，啟用「**Google**」登入提供者。
3. 部署 Hosting 後（Step 7），回到 Authentication → Settings → Authorized domains，確認 Firebase Hosting 網域在清單中。

### Step 3：建立 Firestore

1. 左側選單「Build → Firestore Database」→「建立資料庫」。
2. 選「**正式模式**」（Production mode），地區選台灣就近（asia-east1 或 asia-northeast1）。

### Step 4：取得創作者 UID(固定資料根)

1. 先完成 Step 7（部署 Hosting），讓創作者可以開啟網址。
2. 創作者用 Google 帳號登入 App 一次。
3. Firebase Console → Authentication → 找到該使用者 → 複製 **User UID**（一串英數字）。這組 UID 是**固定資料根路徑**，所有授權帳號的資料都寫入這一個路徑下（不分帳號）。

### Step 5：部署 Firestore rules（email 白名單）

1. 把 `firestore.rules` 裡 `isAllowed()` 的 email 白名單陣列，換成實際授權的 Google 帳號 email（創作者本人 + 協作者，可 1~N 位）；資料根路徑的 UID 換成第 4 步取得的值。
2. 部署前跑測試確認綠燈：
   ```bash
   npm run test:emulator
   ```
3. 部署 rules：
   ```bash
   npx firebase deploy --only firestore --project <你的專案ID>
   ```

> `firestore.indexes.json` 為空（v3 架構採長駐 listener + 記憶體 store + 本地過濾，無需複合索引）。

### Step 6：填入 App 端設定

開啟 `js/firebase.js`，填寫：

1. **`firebaseConfig`**：從 Firebase Console → 專案設定 → 一般 → 網頁應用程式（若無則新增）→ 複製整個 config 物件（`apiKey`、`authDomain` 等）貼入。
2. **`CREATOR_UID`**：把 `null` 改為第 4 步取得的固定資料根 UID。
3. **`ALLOWED_EMAILS`**：填入與 `firestore.rules` 白名單**完全一致**的 email 陣列(前端與 rules 是兩道獨立防線,兩邊字面值必須同步)。

> ⚠️ **`ALLOWED_EMAILS` 留空上線 = 所有人被拒(fail-closed 設計)**,登入 gate 會顯示「尚未完成設定」。這是刻意的防漏填保護,不是 bug。emulator 測試下不檢查白名單,不影響開發。

### Step 7：部署 Firebase Hosting

```bash
npx firebase deploy --only hosting --project <你的專案ID>
```

部署完成後取得正式網址（格式 `https://<專案ID>.web.app`），這就是創作者唯一主網址。

### Step 8：設定 Google Sheets 鏡像（可選）

若需要 Sheets 流水帳：

1. 用**創作者的 Google 帳號**開啟 [script.google.com](https://script.google.com/)，或從目標試算表「Extensions → Apps Script」進入，建立新 Apps Script 專案。
2. 將 `tools/apps-script-mirror.gs` 的內容貼入。
3. 部署為 Web App：
   - Execute as：**Me（創作者本人）**
   - Who has access：**Anyone**（匿名 POST，無 CORS preflight）
4. 複製 Web App URL，填入 `js/firebase.js` 的 `APPS_SCRIPT_URL`（目前為 `null`）。
5. 重新部署 Hosting：`npx firebase deploy --only hosting --project <你的專案ID>`

### Step 9：交接與驗收

> 交接時機：創作者當前場次結束後。

1. 創作者手機開**舊站**（GitHub Pages v2 網址）→「匯出」→「備份全部資料（JSON）」。
2. 開**新網址（Firebase Hosting）**→ Google 登入 → 「匯出」→「從備份還原」→ 選剛才的 JSON 檔。
3. 驗收：新站場次報表的筆數/金額與舊站一致；用電腦開新網址登入，也看得到相同資料。
4. 手機「更換主畫面捷徑」為新網址；告知創作者以後只用新的。

**驗收清單（逐項打勾）：**

- [ ] 創作者 Google 登入成功
- [ ] 協作者 Google 帳號登入成功，且看見與創作者相同的資料（同一本帳）
- [ ] 記一筆銷售後另一裝置可見
- [ ] 「N 筆尚未上雲」顯示正確，連線後消失
- [ ] Google Sheets 出現新列（編輯後更新、刪除後標「已刪除」）
- [ ] 他人 Google 帳號登入被拒（「此帳號無權限」）
- [ ] 匯入 JSON 備份後筆數與舊站一致
- [ ] Firebase Console 帳單顯示 Spark 免費方案

---

## 規格與 BACKLOG

- 完整規格：[docs/specs/2026-07-04-cloud-sync-firebase-v3.md](docs/specs/2026-07-04-cloud-sync-firebase-v3.md)
- 延後項目：[docs/BACKLOG.md](docs/BACKLOG.md)
