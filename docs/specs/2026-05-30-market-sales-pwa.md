# 市集銷售記錄 PWA — 規格

- 日期:2026-05-30
- 狀態:草稿,待使用者審查
- 來源:critical-discussion 收斂結論(見本檔「決策紀錄」)

## Summary

給單一手作創作者擺攤使用的**純本機、離線優先手機網頁 App(PWA)**。解決三個手寫痛點:建商品檔、擺攤當下快速記每一筆銷售、收攤後依日期自動核銷。資料只存在使用者手機(IndexedDB),不需要後端伺服器、不需要登入、不需要網路即可運作;部署為靜態檔案到免費靜態主機(HTTPS),使用者「加到主畫面」即可離線使用。收攤可一鍵匯出 CSV 作為備份。

核心衡量準則(所有設計取捨以此為準):**在斷網、人多時,比手寫筆記本更快更準地記下一筆銷售,並在收攤後自動算對帳。** 單筆銷售輸入目標 ≤ 手寫時間(約 2~3 次點擊內完成一筆)。

## Scope

- **商品清單**:新增/編輯/停售(停售後不出現在記銷售清單,但歷史不受影響)。欄位僅「品名 + 單價(新台幣整數)」,**不追蹤庫存數量**。
- **現場臨時新增品項**:記銷售畫面可即時新增一個新商品(品名+單價)馬上開賣,並存進商品清單。
- **記一筆銷售**:點選商品 → 調數量 → 選付款方式 → 完成。一筆可含多樣商品(對應「買了 3 樣」);總額由各品項定價自動加總;記錄時間戳。
- **付款方式**:固定兩種 — 現金、轉帳。
- **改錯/刪除**:可編輯或刪除已記錄的銷售(直接解決手寫誤差痛點);編輯後重算總額。
- **依日期對帳**:選日期(預設今天),顯示 當日總營收、筆數、現金小計、轉帳小計,及當日銷售明細列表。
- **擺攤中即時累計**:記銷售畫面常駐顯示「今天累計:$X / N 筆」。
- **CSV 匯出備份**:可匯出指定日期(預設今天)或全部銷售為 CSV(UTF-8 BOM,Excel 可正確開繁中)。
- **離線與安裝**:首次載入後完全離線可用;可加到主畫面當 App 用。

## Non-scope(明確不做,理由見決策紀錄)

- 不做庫存/數量追蹤、扣庫存、低量提醒。
- 不做折扣/抹零(照定價加總)。
- 不做金流整合(付款方式只是記錄欄位,不經系統實際收款)。
- 不做雲端同步、多裝置、伺服器、登入帳號。→ BACKLOG
- 不做跨日區間加總(對帳一次看一天;匯出可選某一天或全部,但不提供「某區間總和」報表)。→ BACKLOG
- 不做多使用者。

## 已接受的已知風險

1. **單機資料風險**:手機遺失/損壞/重置 = 該裝置資料全失。緩解:匯出 CSV 做成顯眼功能 + 收攤提醒「本次已匯出?」;規格要求匯出易達。
2. **iOS Safari 儲存清除**:未加到主畫面、或長期閒置時,Safari 可能清除 PWA 的 IndexedDB。緩解:首次使用引導「加到主畫面」(取得較持久儲存)+ 每場匯出習慣;在 App 內與 README 標明此風險。
3. **依日期對帳的限制**:同一天若擺兩場,會合併計算、無法分場。使用者已選擇接受。

## 技術選型(自行決定,依核心目標)

**採用:零相依、免建置(no build step)的原生 PWA。**
- 原生 HTML / CSS / ES Modules JavaScript;資料層用 IndexedDB(以極小的 Promise 包裝,不引第三方 ORM)。
- 手寫 Service Worker 快取 App Shell 提供離線;Web App Manifest 提供安裝。
- 部署 = 複製靜態檔案到靜態主機;無 npm 執行期相依。
- 測試為**開發期相依**(Vitest + fake-indexeddb),不進入出貨產物。

**理由**:本 App 範圍小、由非技術擁有者長期運行。零執行期相依、免建置 = 沒有 toolchain/npm 腐化、部署即複製、最耐放。純邏輯抽成框架無關的函式即可充分測試,不需 UI 框架。

**被否決的替代方案**:輕量框架(Svelte/Vue + Vite + vite-plugin-pwa)。優點是 DX 與反應式 UI 較順、SW 自動產生;缺點是為一個小 App 引入建置工具鏈與 npm 維護負擔,與「最耐用、最好維護」目標相悖。若日後功能顯著膨脹可重新評估(BACKLOG)。

## Data model(IndexedDB)

DB:`market-sales-db`,version 1。

### object store `products`
| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string (uuid) | keyPath,`crypto.randomUUID()` |
| `name` | string | 品名 |
| `price` | integer | 單價(新台幣整數,> 0) |
| `active` | boolean | 是否在售(停售=false) |
| `createdAt` | string (ISO) | 建立時間 |

### object store `sales`
| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string (uuid) | keyPath |
| `items` | array | 每項 `{ productId, name, price, qty }`,**name/price 為成交當下快照** |
| `total` | integer | 由 items 加總(`Σ price*qty`) |
| `paymentMethod` | enum | `'cash'` \| `'transfer'`(顯示:現金/轉帳) |
| `createdAt` | string (ISO) | 成交時間 |
| `dateKey` | string | 本地日期 `YYYY-MM-DD`(供當日查詢/對帳的 index) |

- index:`sales` 上對 `dateKey` 建索引,供依日期查詢。
- **設計理由(price/name 快照)**:商品日後改價或停售/刪除時,歷史銷售必須保留成交當下的品名與金額,否則對帳會被竄改。此為對帳準確性的關鍵。

## Acceptance criteria(每條對應測試)

1. 新增商品後重新整理頁面,商品仍在(IndexedDB 持久化)。→ test: products repo persist
2. 停售的商品不出現在「記銷售」可選清單,但歷史銷售明細仍顯示其品名/金額。→ test: active filter + snapshot
3. 一筆含多商品的銷售,`total === Σ price*qty`。→ test: computeTotal
4. 記一筆銷售後,「今天累計」金額與筆數即時增加且正確。→ test: summarizeDay + UI 行為(手動/E2E)
5. 現場新增一個新品項後可立即被選入該筆銷售,且該品項存入商品清單。→ test: on-the-fly add
6. 對帳選某日,總營收 = 該日所有銷售 total 之和;筆數 = 該日銷售數;現金小計 + 轉帳小計 = 總營收。→ test: summarizeDay by paymentMethod
7. 編輯一筆銷售(改數量/品項/付款方式)後,該筆 total 與當日對帳隨之重算正確。→ test: update sale recompute
8. 刪除一筆銷售後,當日對帳數字相應減少。→ test: delete sale
9. 匯出某日 CSV:含 UTF-8 BOM、欄位為(日期,時間,商品明細,件數,總金額,付款方式),金額/筆數與對帳一致,Excel 開啟繁中不亂碼。→ test: toCSV
10. 首次連網載入後,關閉網路仍能開啟 App、記銷售、看對帳(離線)。→ verify: 手動離線測試 / SW 快取
11. 在支援的瀏覽器可「加到主畫面」並以獨立視窗開啟(installable)。→ verify: Lighthouse PWA installable

## Milestones

> 風險分級:LOW / MED / HIGH。本 App 無 DB migration / auth / 金流,最高為 MED(資料完整性與核心輸入正確性)。

### M1 — App Shell + PWA 安裝 + 離線
- risk: LOW
- steps:
  1. 建立 `index.html` / `css/style.css` / `js/app.js` 骨架與分頁導覽(記銷售 / 商品 / 對帳 / 匯出) → verify: 本機開啟可在四個畫面間切換
  2. 加 `manifest.webmanifest` + icons(含 maskable) → verify: Chrome DevTools → Application 顯示可安裝
  3. 寫 `sw.js` 快取 App Shell(HTML/CSS/JS/manifest/icons),註冊 SW → verify: 首次載入後切離線(DevTools offline)重新整理仍可開啟
- tests: 手動 — Lighthouse PWA「Installable」通過;離線重載成功
- rollback: 還原靜態檔(git revert);未部署則無對外影響

### M2 — 資料層 + 純邏輯(含測試)
- risk: MED(資料完整性、持久化)
- steps:
  1. `js/db.js`:開 DB、建 `products`/`sales` store 與 `dateKey` index;products CRUD(含 active 切換)、sales CRUD、依 dateKey 查詢 → verify: fake-indexeddb 整合測試通過
  2. `js/logic.js` 純函式:`computeTotal(items)`、`summarizeDay(sales)`(回總額/筆數/各付款方式小計)、`dateKey(date)`(本地 YYYY-MM-DD)、`toCSV(sales)`(UTF-8 BOM)、`formatMoney` → verify: 單元測試覆蓋上述
- tests:
  - unit:computeTotal(多品項/零品項)、summarizeDay(混付款方式)、dateKey(跨午夜本地日界)、toCSV(欄位/BOM/特殊字元跳脫)
  - integration(fake-indexeddb):products 持久化、active 過濾、sales 新增/查詢/更新/刪除、依 dateKey 查當日
- rollback: 還原模組檔

### M3 — 商品管理
- risk: LOW
- steps:
  1. 商品列表 + 新增/編輯表單(品名、單價驗證 > 0 整數) → verify: 新增後列表出現、重載仍在
  2. 停售/恢復切換 → verify: 停售後不進記銷售清單;恢復後回來
- tests: integration — 透過 db 層驗證 CRUD 與 active;UI 手動冒煙
- rollback: 還原相關 UI 模組

### M4 — 記銷售(核心熱路徑)
- risk: MED(核心流程、總額與快照正確性、輸入速度)
- steps:
  1. 在售商品大按鈕格 → 點選加入購物車(同品再點+1) → verify: 點兩下同商品數量為 2
  2. 購物車顯示明細 + 即時總額 + 數量增減 + 移除 → verify: 改數量總額即時重算
  3. 付款方式選擇(現金/轉帳,預設現金) + 「完成這筆」存檔並清空購物車 → verify: 存檔後 sales 多一筆且 items 含快照、total 正確
  4. 「今天累計:$X / N 筆」常駐並於存檔後即時更新 → verify: 連記兩筆後數字正確
  5. 「＋現場新增商品」:輸入品名+單價即存入清單並可立即選入本筆 → verify: 新商品出現在格中且可下單
- tests: unit(computeTotal 已於 M2);integration — 存一筆多品項銷售後查回比對;UI 手動冒煙(速度感)
- rollback: 還原記銷售模組(不影響已存資料)

### M5 — 當日對帳 + 編輯/刪除銷售
- risk: MED
- steps:
  1. 日期選擇(預設今天)+ 當日:總營收 / 筆數 / 現金小計 / 轉帳小計 → verify: 數字 = 該日銷售加總且兩小計相加 = 總額
  2. 當日銷售明細列表(時間、商品摘要、總額、付款方式) → verify: 列表筆數 = 筆數
  3. 點一筆可編輯(改品項/數量/付款方式,重算 total)或刪除 → verify: 編輯/刪除後對帳數字即時更新
- tests: integration — 建多筆混付款方式銷售,summarizeDay 驗證;編輯後 total 重算;刪除後加總減少
- rollback: 還原對帳模組

### M6 — CSV 匯出 + 備份提醒
- risk: LOW
- steps:
  1. 匯出指定日期/全部為 CSV(UTF-8 BOM)下載 → verify: 下載檔 Excel 開啟繁中正常、數字與對帳一致
  2. 顯眼的「匯出/備份」入口 + 對帳頁提示「收攤記得匯出備份」 → verify: 入口可一鍵觸發匯出
  3. iOS 下載/分享相容處理(必要時用分享而非直接下載) → verify: iOS Safari PWA 可取得 CSV
- tests: unit — toCSV(M2 已涵蓋,補 iOS 分支若需);手動 — 實機匯出開檔
- rollback: 還原匯出模組

## 部署與環境(需使用者參與)

- 出貨產物為靜態檔案,可部署到 GitHub Pages / Netlify(免費、HTTPS)。
- **實際部署需要使用者的帳號授權**(GitHub/Netlify 登入、建 repo / 連接專案)。此步驟我無法代為登入;到該步會請使用者以 `! <command>` 或自行於平台操作完成連接,我再協助設定。
- 本機目前非 git 倉庫;為利版本控管與 GitHub Pages,M1 前會 `git init`(待使用者同意)。

## 決策紀錄(來自需求討論)

| 決策 | 選擇 | 否決項與理由 |
|---|---|---|
| 自建 vs 現成 | 自建輕量 | 現成 POS 功能過重拖慢記帳;試算表手機輸入慢易錯;雲端後端對單人單機過度設計 |
| 資料架構 | 純本機 + 匯出備份 | 雲端同步(後端/登入/同步衝突)成本不值 → BACKLOG |
| 庫存 | 只記銷售流水帳 | 不追庫存數量 |
| 商品模型 | 品名+單價,可現場新增 | — |
| 付款方式 | 現金、轉帳 | 不做金流整合 |
| 折扣/抹零 | 不做 | 照定價加總 |
| 對帳單位 | 依日期 | 不分場次;跨日區間加總 → BACKLOG |
| 部署 | 免費靜態主機 | 本機 file:// 無法裝 SW、離線安裝體驗差 |

## 測試紀律

- 純邏輯(computeTotal / summarizeDay / dateKey / toCSV)為框架無關函式 → 單元測試先行或同步。
- 資料層用 fake-indexeddb 做整合測試(對應真實 IndexedDB 行為,避免 mock 漂移)。
- UI 熱路徑(記銷售、對帳)以手動冒煙為主;如需自動化 E2E,Playwright 列為選配(BACKLOG)。
