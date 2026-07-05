# Changelog

本檔記錄市集銷售記錄 PWA 的重要變更。格式參考 [Keep a Changelog](https://keepachangelog.com/),版本依 [語意化版本](https://semver.org/lang/zh-TW/)。

## [0.3.0] - 2026-07-05

線上零售記帳 + 雙人共用帳號。規格見 `docs/specs/2026-07-05-online-sales-dual-auth.md`。

### Added
- **線上銷售**:記銷售分頁新增「記帳目標」(本場次 / 線上),無進行中場次時自動線上模式(不再擋下記帳);線上模式可選日期(預設今天,方便補記舊匯款)並填備註(買家 IG / 信箱 / 姓名等)。
- **「線上」分頁**:按月分組檢視線上銷售,月營收小計(僅計正常銷售),單筆可編輯(含日期、備註)、刪除。
- **銷售備註**:所有銷售(場次 + 線上)皆可加自由文字備註;場次報表單筆編輯同步補上備註欄。
- **雙人 Google 帳號登入**:創作者與一位協作者的 Google 帳號皆可登入,共用同一本帳(不分記錄者)。

### Changed
- **人讀明細分隔符統一為「、」**:CSV 原用 `; `,修改歷史與 Sheets 鏡像用「、」,現收斂為單一來源。
- **登入授權改為 email 白名單**:原以單一 Firebase UID 判斷,改為比對兩位協作者的 Google email(`firestore.rules` 與前端登入 gate 同步),資料根固定不變。
- **CSV / Sheets 鏡像涵蓋備註與線上通路**:明細 CSV 加「備註」欄,線上筆「場次」欄顯示「線上」;Sheets 鏡像表頭同步加「備註」欄。
- Service Worker 快取版本升至 `market-sales-v12`(新增 `online.js` / `sale-editor.js` 離線快取)。

### Removed
- **v1 → v2 一次性遷移 `ensureMigrated`**:線上銷售以 `outingId: null` 存在,與舊遷移邏輯(把無場次銷售歸入「舊紀錄」場次)衝突;此版無正式舊資料,遷移隨之移除。

### Notes
- Firebase Auth + Firestore 雲端同步、離線優先、樂觀寫入。
- 測試:單元 39、emulator 整合 52、端到端(Playwright)44,全數通過;雙人授權另經 code-reviewer + security-auditor 審查。

## [0.2.0] - 2026-05-30

以「場次」為主軸的重構版。組織單位從「天」改為「場次(可含多天)」,並補上帶貨盤點、成本、特例交易與可還原備份。規格見 `docs/specs/2026-05-30-market-sales-pwa-v2.md`。

### Added
- **場次(outing)**:可命名(玩具展、松菸文創…),一場含 1~N 天,同時僅一場進行中,可關閉。記銷售自動歸入進行中場次;無場次時擋下並引導開場。
- **帶貨/剩貨盤點**:開場可輸入每商品帶幾個,收場看「剩餘 = 帶量 − 出貨量」。
- **商品成本**:商品與現場新增多一欄成本(材料/進貨,選填),成交時快照進銷售明細。
- **特例交易類型**:贈送 / 補送(補寄)——計入出貨(扣剩餘)但不計營收。
- **場次報表**:收入 / 筆數 / 現金・轉帳 / 商品成本 / 固定成本 / 淨額、每日分計、商品彙總(帶/賣/剩/收入)與好賣排行/滯銷、特例件數。
- **場次固定成本**:每場可填攤租 / 交通 / 住宿(選填)。
- **商品彙總 CSV**:每商品一列(帶量/賣出/剩餘/收入/成本),供「這場共賣幾個」快速閱覽。
- **JSON 備份 / 還原**:匯出完整資料為 JSON,換手機或資料遺失時可「從備份還原」。
- **持久儲存**:啟動時以 `navigator.storage.persist()` 要求瀏覽器別清除資料。
- **未備份提醒**:顯示「N 筆尚未備份」。

### Changed
- **「對帳」分頁改為「場次」分頁**,以場次為中心(原 `js/ui/report.js` 退役為 `js/ui/outing.js`)。
- **CSV 重設計**:銷售明細移除冗餘的「件數」欄,改加「場次」「類型」欄,讓內容務實可用。
- **「今天累計」與場次收入只計入正常銷售**(排除贈送/補送)。
- IndexedDB 升至 version 2;啟動時冪等遷移:v1 舊銷售自動歸入已關閉場次「舊紀錄」。
- Service Worker 快取版本升至 `market-sales-v7`。

### Removed
- 取消 v1 的「匯出某天」(由「場次」匯出取代)。

### Notes
- 仍為純本機、離線優先、零執行期相依的原生 PWA。
- 測試:32 單元/整合(Vitest + fake-indexeddb)+ 25 端到端(Playwright/Chromium,真 IndexedDB / 真 Service Worker)。

## [0.1.0] - 2026-05-30

初版。給手作創作者擺攤用的純本機、離線優先手機網頁 App。規格見 `docs/specs/2026-05-30-market-sales-pwa.md`。

### Added
- 商品管理:新增 / 編輯 / 停售(品名 + 單價)。
- 記銷售熱路徑:點選商品 → 調數量 → 選付款方式(現金/轉帳)→ 完成;一筆可含多商品、自動加總;現場臨時新增商品;常駐「今天累計」。
- 依日期對帳:總營收 / 筆數 / 現金小計 / 轉帳小計,可編輯/刪除單筆。
- CSV 匯出(UTF-8 BOM,Excel 開繁中不亂碼)。
- PWA:Web App Manifest 可安裝、Service Worker 離線可用。

[0.3.0]: https://github.com/doqmon6/1111lily/releases/tag/v0.3.0
[0.2.0]: https://github.com/doqmon6/1111lily/releases/tag/v0.2.0
[0.1.0]: https://github.com/doqmon6/1111lily/releases/tag/v0.1.0
