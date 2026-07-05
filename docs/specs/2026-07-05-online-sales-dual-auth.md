# 線上銷售 + 雙人授權 + 明細分隔符統一

**Status:** DRAFT
**Date:** 2026-07-05
**Author:** spec-architect(審閱者:larry)
**Source request:** 三軌需求(訪談已定案):T1 線上銷售(記銷售切通路 + 新「線上」分頁)、T2 雙人 email 授權(共享同一本帳)、T3 人讀明細分隔符統一為 `、`。

## Summary

為市集擺攤記帳 PWA(vanilla JS、Firebase Auth + Firestore 離線優先、正式站 https://market-sales-lily.web.app)加入三項能力:

1. **線上銷售**:讓創作者記錄「非現場擺攤」的匯款/私訊成交,消除「無進行中場次就無法結帳」的死路;新增頂層「線上」分頁按月檢視、編輯、刪除,並讓所有銷售(含場次)都能補記自由文字備註。
2. **雙人授權**:把資料存取從「單一 UID」改為「email 白名單(創作者 + 一位協作者)」,兩人登入後共用同一本帳(固定資料根),前後端與 Security Rules 一致。
3. **分隔符統一**:把人讀明細的品項分隔符收斂為單一來源的 `、`,消除三處各自硬編碼。

對象是非技術手作創作者,判準是創作者 UX 與零維運。此版無正式資料,不需資料遷移或相容舊資料。

## Scope

In:
- 記銷售分頁支援「場次 / 線上」通路選擇;無進行中場次時自動進入線上模式(死路消除)。
- 線上筆資料模型:`outingId: null`;所有銷售新增選填 `note`。
- 新「線上」頂層分頁:按月分組、月營收小計(僅計 `type=sale`)、單筆編輯(含日期、備註)/刪除。
- 場次報表單筆編輯表單加備註欄(「全部銷售可備註」在此落地)。
- 匯出/鏡像涵蓋:明細 CSV 加「備註」欄、線上筆「場次」欄顯示「線上」;`mirror.js` payload 加 `note`、線上筆 `outing: '線上'`;Apps Script 表頭與映射同步;`saleChangeSummary` 加備註 diff。
- Security Rules 改 email 白名單(`request.auth.token.email` + `email_verified`),資料根固定 `users/fEMuo2pogUXx6eKz3Ct33zSt9aM2/...`,changelog append-only 不變。
- 前端登入 gate 改 email 白名單比對;通過後一律 `setUserId('fEMuo2pogUXx6eKz3Ct33zSt9aM2')`。
- T3:品項分隔符單一來源 `、`。
- 部署 runbook(rules + hosting CLI 自動、Apps Script 人工重新部署、正式站雙帳號驗收)、CHANGELOG 更新。

Out(明確不做):
- 線上銷售**不**扣帶貨/庫存(帶貨盤點仍是場次概念)。
- **不**做線上月報表匯出(全部明細 CSV 已涵蓋按月資料)。
- **不**記錄「誰記的帳」(兩人共用一本帳,不區分操作者)。
- **不**加 `channel` 欄位(`outingId === null` 即線上)。
- **不**改場次記銷售熱路徑加備註輸入框(保持快;事後編輯可補)。
- **不**動 CSV 既有欄位順序(僅在尾端加「備註」);不改 JSON 備份格式(全量 dump 自動涵蓋新欄位)。
- **不**支援三人以上、動態白名單、per-user 資料隔離(共享同一本帳是定案)。

## Acceptance criteria

每條可對應測試(單元 = Vitest 純函式;整合 = `test:emulator`;e2e = Playwright;rules = emulator rules 套件)。

1. **AC1**:`addSale` / `updateSale` 接受並持久化選填 `note`(字串),未給時為 `''`(或 `null`,見資料模型)。— verified by: db 整合測試 `addSale/updateSale 保存 note`。
2. **AC2**:記銷售分頁在「有進行中場次」時預設該場次、可切「線上」;在「無進行中場次」時自動線上模式且結帳成功(不再顯示「請先開場次」阻擋)。— verified by: e2e `無場次可直接記線上銷售` + `有場次可切線上`。
3. **AC3**:線上結帳寫入 `outingId: null`,`createdAt` = 選定日期(本地)+ 記帳當下時分秒,`dateKey` 等於選定日期。— verified by: e2e/整合 `線上筆 outingId 為 null 且 dateKey=選定日期`。
4. **AC4**:登入後執行任何流程都**不會**把 `outingId: null` 的線上筆吸進「舊紀錄」場次(`ensureMigrated` 已移除)。— verified by: db 整合測試 `無 v1→v2 遷移;outingId null 線上筆登入後仍為 null`。
5. **AC5**:「線上」分頁按月分組,月營收小計只計 `type=sale`(沿用 `outingRevenue`);贈送/補送不計。— verified by: e2e `線上分頁月營收只計正常銷售`。
6. **AC6**:線上分頁可編輯單筆(含改日期、改備註、改明細/付款/類型)與刪除,結果落地並反映在分組與小計。— verified by: e2e `線上筆編輯日期與備註` + `線上筆刪除`。
7. **AC7**:場次報表單筆編輯表單含備註欄,可對場次銷售補備註並落地。— verified by: e2e `場次銷售可補備註`。
8. **AC8**:`toSalesCSV` 表頭含「備註」欄,線上筆「場次」欄輸出「線上」,場次已刪筆「場次」欄輸出空字串(兩者可區分)。— verified by: 單元 `toSalesCSV 備註欄與線上/已刪場次區分`。
9. **AC9**:`mirror.js` payload 含 `note`;線上筆 `outing` 欄為 `'線上'`;場次筆為場次名(已刪為 `''`)。— verified by: mirror 單元 `payload 含 note 且線上 outing 為線上`。
10. **AC10**:`saleChangeSummary` 在備註變更時輸出一條備註 diff。— verified by: 單元 `saleChangeSummary 備註變更`。
11. **AC11**:品項分隔符全域為 `、`;`grep "'; '" js/ tools/` 對品項分隔歸零。— verified by: 單元 `toSalesCSV 品項以、分隔` + 部署前 grep 檢查(M1 verify)。
12. **AC12**:Security Rules 僅允許 `email_verified == true` 且 email ∈ 白名單者讀寫 `users/fEMuo2pogUXx6eKz3Ct33zSt9aM2/...`;名單外 email、未驗證 email、匿名皆 deny;changelog update/delete 仍 deny。— verified by: rules 套件(白名單兩人各可讀寫、名單外拒、未驗證拒、匿名拒、changelog 竄改拒)。
13. **AC13**:前端登入 gate 對名單外帳號 `signOut` 並顯示「此帳號無權限」;白名單內任一帳號通過後 `setUserId('fEMuo2pogUXx6eKz3Ct33zSt9aM2')`;fail-closed(名單空/未設定=拒絕)與 emulator 放行維持。— verified by: e2e/單元(依現有 gate 測試慣例)`名單外登入被拒` + `白名單登入綁固定資料根`。
14. **AC14**:兩個白名單帳號寫入的資料互相可見(同一本帳)。— verified by: rules 套件 `白名單 B 可讀白名單 A 寫入的 doc`。

## 資料模型變更

Firestore 路徑不變:`users/{uid}/products|sales|outings|changelog`,文件 id = 既有 uuid。

- **`sales` 文件新增欄位 `note`**:選填自由文字(買家 IG / email / 姓名 / 備註)。所有銷售通用,不只線上。
  - 預設值決策:未填時存 `''`(空字串),而非省略欄位或 `null`。理由:與 CSV / mirror / diff 的 `note ?? ''` 讀取一致,避免 `undefined` 與 `null` 兩種缺值分歧;`saleChangeSummary` 以 `(before.note ?? '') !== (after.note ?? '')` 比對,對舊筆(無此欄)也安全。
- **線上筆 = `outingId: null`**;不新增 `channel` 欄位。`outingId == null` 即線上,`outingId` 有值即場次筆。
- **線上筆 `createdAt` 語意(本規格定義)**:
  - `createdAt` = 使用者在線上模式選定的日期(本地 Y/M/D)+ **記帳當下的本地時分秒**,組成本地時間後 `toISOString()` 儲存;`dateKey` 由 `logic.dateKey(new Date(createdAt))` 推導,等於選定日期。
  - **建構方式(避免時區陷阱,實作必守)**:以 `new Date(y, m-1, d, hh, mm, ss)`(本地建構)產生,**不可**用 `new Date('YYYY-MM-DD')`(會被當 UTC 午夜,在 UTC+8 仍是同日但語意脆弱)。
  - 理由:(1) 日期是創作者在意的維度(對應匯款/成交日,支援補記舊匯款);(2) 保留記帳當下時分秒 → 同日多筆線上銷售 `createdAt` 不碰撞,`byCreatedAt` 穩定排序、CSV / Sheets「時間」欄有意義(若固定 00:00 會全部碰撞、排序不穩且時間欄無意義);(3) 選定日期若為今天,`createdAt` 等同 `new Date()`,與場次熱路徑零特例。
  - **編輯改日期時**:以「新日期 + 原 `createdAt` 的時分秒」重建 `createdAt`,保持同日排序穩定;`updateSale` 既有邏輯會據新 `createdAt` 重算 `dateKey`。
- **移除 `ensureMigrated`(v1→v2 孤兒銷售遷移)**:
  - 衝突事實:`db.js ensureMigrated()` 把所有 `!s.outingId` 的銷售視為孤兒、歸入已關閉的「舊紀錄」場次,且 `app.js` 在**每次登入**都呼叫它。線上筆刻意用 `outingId: null`,一旦存在,下次登入會被整批 `updateSale` 改成 `outingId: legacy.id` —— 直接摧毀線上筆語意。
  - 決策:**移除** `ensureMigrated`(函式本體 + `app.js` 呼叫 + `db.test.js` 遷移 describe 區塊)。依 T1 核心目標推導:線上筆必須以 `outingId: null` 存活,而本版無任何正式舊資料(背景事實),遷移既無對象又主動有害。
  - 為何不改成「線上感知」的遷移:定案決策不加 `channel` 欄位,線上筆與 v1 孤兒在資料上無法區分,無可靠判準保留遷移;移除是唯一乾淨解。
  - `[ARCHITECT DEFAULT — confirm]`:刪除既有且有測試覆蓋的程式碼屬架構決策,雖由核心目標可推導,仍請 larry 於審閱時確認。最小替代方案(僅供比較,不建議):保留 `ensureMigrated` 但改為「只在 outings 全空時才視為需遷移」等啟發式 —— 脆弱且會在正常刪光場次時誤觸,不採。

不需 migration 檔(Firestore 無 schema 遷移機制);不需 backfill(無正式資料)。

## Cross-cutting concerns

- **Auth / 權限(T2,HIGH)**:授權判準從 `request.auth.uid` 改為 `request.auth.token.email`(需 `email_verified`)白名單;資料根仍固定,兩人共享。前端 gate 與 rules 為雙防線、互相獨立。**本軌需 security-auditor 審查**(重點:email 比對正確性、`email_verified` 未檢查的旁路、fail-closed 是否保持、emulator 放行是否僅限 emulator)。
- **可觀測性**:登入被拒沿用現有 `console.warn`(名單外)/`console.error`(未設定)語意;不新增遙測(零維運原則)。
- **並行 / 一致性**:兩人同時編同一筆 → 沿用既有 last-write-wins + changelog 追溯(BACKLOG 已記錄的既有取捨),本規格不引入鎖。線上筆與場次筆走同一 `addSale/updateSale/deleteSale` 寫入路徑,樂觀更新 + pending overlay 不變式沿用。
- **冪等 / 離線**:沿用既有 latency-compensation 寫入與 localStorage 鏡像佇列;線上筆離線記帳與場次筆行為一致。
- **外部契約(Apps Script)**:`mirror.js` payload 新增 `note` 為**向前相容**——舊版 Apps Script 忽略未知欄位,`note` 在 Apps Script 重新部署前不落表,不會出錯。故前端(M4)可先上線,Apps Script 重新部署(M6)可稍後,無破壞窗口。

## Milestones

橫向切片,每個里程碑產出可獨立交付且已測試的系統切面。

### M1 — 人讀明細分隔符統一(T3)

- **Risk:** LOW
- **Rationale for risk tier:** 純函式格式變更,無 schema、無 auth、無外部契約破壞;僅影響人讀字串。
- **Files touched(estimated):** `js/logic.js`、`js/mirror.js`、`js/ui/outing.js`、`tests/logic.test.js`、`docs/BACKLOG.md`
- **Steps:**
  1. 在 `js/logic.js` 新增單一來源品項彙總 helper(例:`export function itemsSummary(items)`,回 `items.map((i) => \`${i.name}×${i.qty}\`).join('、')`) → verify: 單元測試呼叫 helper 得 `A×1、B×2`。
  2. `toSalesCSV` 內 `.join('; ')` 改用 `itemsSummary`;`saleChangeSummary` 的 `itemsStr` 改用 `itemsSummary` → verify: `logic.test.js` CSV/diff 既有斷言更新為 `、` 且通過。
  3. `js/mirror.js salePayload` 的 items join 改 import 並用 `itemsSummary`;`js/ui/outing.js` 本地 `itemsSummary` 改為 import 自 `logic.js`(消除重複定義) → verify: `mirror.test.js` 通過;outing e2e 明細顯示不變(仍 `、`)。
  4. 更新 `docs/BACKLOG.md`:移除「人讀明細分隔符不一致(v3)」條目,於「已完成」註記「已於 2026-07-05 規格統一為 `、`」 → verify: BACKLOG 不再含該延後條目。
- **Tests:**
  - unit: `toSalesCSV` 品項以 `、` 分隔;`saleChangeSummary` 明細 diff 以 `、`;`itemsSummary` 純函式。
  - integration: 無。
  - e2e: 無(既有 outing 明細 e2e 作為回歸)。
- **Verify(里程碑級)**:`grep -rn "'; '" js/ tools/` 對品項分隔歸零(基線:目前僅 `js/logic.js:123` 一處)。
- **Rollback:** 單一 commit revert;無資料面影響。

### M2 — 記銷售支援線上通路(記錄路徑)+ 移除遷移 + note 欄位

- **Risk:** MED
- **Rationale for risk tier:** 改動核心寫入路徑(新增 `note`、線上分支)並移除既有登入時遷移;無 schema 破壞、無 auth 變更,但屬關鍵路徑寫入行為變更。
- **Files touched(estimated):** `js/db.js`、`js/ui/sale.js`、`js/app.js`、`tests/db.test.js`、`tests/e2e/*`
- **Steps:**
  1. `js/db.js`:`addSale` / `updateSale` 帶入選填 `note`(缺值存 `''`);既有簽章相容 → verify: db 整合 `addSale({..., note})` 讀回 note;不給 note 讀回 `''`。
  2. `js/db.js`:移除 `ensureMigrated` 函式;`js/app.js`:移除 `ensureMigrated` import 與登入流程呼叫(連帶移除其 try/catch) → verify: `grep -rn ensureMigrated js/` 歸零;登入流程仍 `setUserId → initMirror → showApp`。
  3. `tests/db.test.js`:移除「v1 → v2 遷移」describe 區塊;新增 `outingId: null 線上筆登入/讀取後仍為 null`(以 addSale 寫 outingId:null,重讀確認未被改寫) → verify: `test:emulator` 通過且無遷移殘測。
  4. `js/ui/sale.js`:在靜態結構(`init`)加「記帳目標」選擇器(場次名 / 線上)與線上專屬欄位容器(日期 input 預設今天、備註 input),線上模式時顯示日期+備註,場次模式時隱藏 → verify: e2e 切換目標時日期/備註欄顯示切換正確。
  5. `js/ui/sale.js refreshToday`:無進行中場次時目標自動為「線上」(不再顯示阻擋警語,改示意「目前為線上銷售」);有場次時預設該場次、可切線上;`show()` 只重繪 grid/summary,不重建線上輸入欄(避免洗掉輸入) → verify: e2e `無場次時預設線上且可結帳`。
  6. `js/ui/sale.js onCheckout`:在點擊當下同步段一併快照「目標選擇 / 日期 / 備註」(與既有 paymentMethod/type 快照同段,防 await 後污染);線上分支呼叫 `addSale({items, total, paymentMethod, type, outingId: null, note, createdAt})`,`createdAt` 依資料模型節(本地建構,選定日期 + 當下時分秒);場次分支維持既有(帶 `note` 為 `''` 或不帶) → verify: e2e `線上結帳寫入 outingId=null 且 dateKey=選定日期`;整合斷言 createdAt/dateKey 對齊。
- **Tests:**
  - unit: 無(邏輯在 db 整合與 e2e)。
  - integration: `note` 持久化;無 `ensureMigrated`;線上筆 outingId 恆為 null。
  - e2e: 無場次可直接記線上;有場次可切線上;線上筆帶日期/備註;結帳競態(切換目標/類型後仍記到快照當下的目標)。
- **Rollback:** revert commit;因無正式資料,已寫入的線上筆(outingId:null)在回滾後會再次受 `ensureMigrated` 影響 —— 回滾前若已有線上筆需一併清除或接受其被歸入舊紀錄(部署順序上 M2 未上正式站前回滾無此問題)。

### M3 — 「線上」分頁(檢視/編輯/刪除)+ 場次編輯加備註(共用編輯器)

- **Risk:** MED
- **Rationale for risk tier:** 新增頂層分頁(關鍵路徑 UI)並重構既有且有 e2e 覆蓋的場次單筆編輯器;無 schema / auth / 外部契約變更。
- **Files touched(estimated):** `js/ui/online.js`(新)、`js/ui/sale-editor.js`(新,共用編輯器)、`js/ui/outing.js`、`js/app.js`、`index.html`、`tests/e2e/*`
- **Steps:**
  1. 抽共用單筆編輯器 `js/ui/sale-editor.js`:輸入 `{ sale, showDate }`,回傳編輯 DOM,含品項 +/− 數量、付款方式、類型、**備註**,以及 `showDate` 為真時的日期欄;儲存回呼回傳編輯後 `{ items, total, paymentMethod, type, note, createdAt? }`。決策依據:M2.1 後場次編輯與線上編輯僅差一個日期欄,重複的品項/付款/類型編輯邏輯抽為單一來源比雙份維護更可維護(符合「best implementation」;最小替代 = 兩處各自複製,已評估為較差,不採) → verify: 單元/e2e 編輯器對兩種模式渲染正確欄位。
  2. `js/ui/outing.js startEdit`:改用 `renderSaleEditor({ sale, showDate: false })`,新增備註欄(T1.4 落地);儲存沿用既有 `updateSale` → verify: e2e `場次銷售可補備註` 且既有場次編輯 e2e 回歸通過。
  3. 新增 `js/ui/online.js`:`getAllSales()` 濾 `outingId == null`,按 `dateKey.slice(0,7)`(YYYY-MM)月分組,每月標題顯示月營收 = `outingRevenue(該月筆)`(僅 type=sale);每筆列出時間/明細/類型/付款/金額/備註,提供編輯(用 `renderSaleEditor({ sale, showDate: true })`,含日期)與刪除;`isBusy()` 於編輯器開啟時回真(對齊 outing.js) → verify: e2e `線上分頁月分組與月營收只計正常銷售`。
  4. 線上編輯改日期:以「新日期 + 原時分秒」重建 `createdAt` 交給 `updateSale`(見資料模型) → verify: e2e `線上筆改日期後落到新月份分組`。
  5. `index.html`:導覽列加「線上」tab(`data-target="online"`)與 `#view-online` section;`js/app.js`:`VIEWS`/`TITLES` 註冊 `online` 模組 → verify: e2e 點「線上」tab 切換到線上分頁。
- **Tests:**
  - unit: `renderSaleEditor` 依 `showDate` 有無日期欄(若可在 jsdom 測);月分組 key 純函式(若抽出)。
  - integration: 無。
  - e2e: 線上分頁月分組/月營收;線上編輯備註+日期;線上刪除;場次補備註;場次編輯回歸。
- **Rollback:** revert commit;移除 `index.html` tab 與 `app.js` 註冊即隱藏分頁;資料面無殘留(線上筆本就相容)。

### M4 — 匯出 / CSV / Sheets 鏡像涵蓋 note 與線上通路(前端)

- **Risk:** MED
- **Rationale for risk tier:** 改鏡像寫入 payload 與外部 Sheets 契約(欄位新增);payload 對舊 Apps Script 向前相容,故無破壞窗口,但屬對下游有依賴的資料格式變更。
- **Files touched(estimated):** `js/logic.js`、`js/mirror.js`、`tests/logic.test.js`、`tests/mirror.test.js`
- **Steps:**
  1. `js/logic.js toSalesCSV`:表頭尾端加「備註」欄;資料列尾端加 `s.note ?? ''`;「場次」欄改 `s.outingId == null ? '線上' : (outingNameById[s.outingId] ?? '')`(線上→「線上」;已刪場次→`''`,兩者區分) → verify: 單元 `CSV 備註欄 + 線上/已刪場次區分`。
  2. `js/mirror.js salePayload`:payload 加 `note: sale.note ?? ''` → verify: mirror 單元 `payload 含 note`。
  3. `js/mirror.js flush`:組 `outingName` 時,`sale.outingId == null` → `'線上'`;有 outingId → `getOuting` 名稱(已刪 `''`) → verify: mirror 單元 `線上筆 outing 為線上`。
  4. `js/logic.js saleChangeSummary`:加備註 diff(`(before.note ?? '') !== (after.note ?? '')` → 推入 `備註 X → Y`,空以「(無)」呈現) → verify: 單元 `saleChangeSummary 備註變更`。
- **Tests:**
  - unit: `toSalesCSV` 備註欄與線上/已刪區分;`saleChangeSummary` 備註 diff。
  - integration: mirror 單元(既有慣例,`_setUrl` hook)payload note 與線上 outing。
  - e2e: 無(匯出/鏡像既有 e2e 作回歸)。
- **Rollback:** revert commit;Apps Script 未動,舊表頭仍可接收(忽略 note),無破壞。

### M5 — 雙人 email 授權(T2)

- **Risk:** HIGH
- **Rationale for risk tier:** 觸及 auth / Security Rules;改授權判準(uid→email)。**需 security-auditor 審查後方可部署**。
- **Files touched(estimated):** `firestore.rules`、`js/firebase.js`、`js/app.js`、`tests/rules-uid.js`、`tests/rules.test.js`、`tests/db.test.js`、`tests/changelog.test.js`、`tests/migrate.test.js`
- **Steps:**
  1. `firestore.rules`:以 email 白名單取代 `isCreator()` 的 uid 比對;資料根路徑仍固定 `fEMuo2pogUXx6eKz3Ct33zSt9aM2`;changelog append-only(update/delete deny)不變。契約如下 → verify: rules 套件全綠。
     ```
     function isAllowed() {
       return request.auth != null
         && request.auth.token.email_verified == true
         && request.auth.token.email in ['doqmon6@gmail.com', '1111l.i.lilyshu@gmail.com'];
     }
     // 各 match 的守衛:allow ...: if isAllowed() && uid == 'fEMuo2pogUXx6eKz3Ct33zSt9aM2';
     ```
  2. `js/firebase.js`:新增 `export const ALLOWED_EMAILS = ['doqmon6@gmail.com', '1111l.i.lilyshu@gmail.com'];`(部署常數集中處);保留 `CREATOR_UID` 常數作為固定資料根 uid(rename 語意可選,避免過度改動則保留原名並註記其現為「固定資料根」) → verify: import 可用。
  3. `js/app.js` 登入 gate:改比對 `user.email` ∈ `ALLOWED_EMAILS`(取代 `user.uid !== CREATOR_UID`);通過後 `setUserId('fEMuo2pogUXx6eKz3Ct33zSt9aM2')`(固定資料根,不再用 `user.uid`);名單外 → `signOut` + 顯示「此帳號無權限」;保留 fail-closed(`ALLOWED_EMAILS` 空/未設 = 拒絕所有人)與 emulator(`isEmulatorMode`)放行 → verify: e2e/單元 `名單外拒` + `白名單綁固定資料根`。
  4. `tests/rules-uid.js`:改為同時動態抽取 (a) 固定資料根 uid(從路徑守衛 `uid == '([^']+)'`)、(b) `ALLOWED_EMAILS`(從 `email in [...]` 陣列字面值),export `DATA_ROOT_UID` 與 `ALLOWED_EMAILS`,使測試對齊實際部署的 rules → verify: 匯出值等於 rules 內字面值。
  5. `tests/rules.test.js` 改寫為 email-based:以 `authenticatedContext(uid, { email, email_verified })` 建立情境 —— 白名單兩帳號各可讀寫固定資料根、且 B 可讀 A 寫入的 doc(同一本帳)、名單外 email 拒、白名單但 `email_verified:false` 拒、匿名拒、changelog update/delete 仍拒 → verify: rules 套件全綠(涵蓋 AC12/AC14)。
  6. `tests/db.test.js`、`tests/changelog.test.js`、`tests/migrate.test.js`:建立 Auth emulator 帳號時,email 改用白名單內 email 且加 `emailVerified: true`;`setUserId` 改用 `DATA_ROOT_UID`;登入後寫入應通過新 rules → verify: `test:emulator` 三檔全綠。
- **Tests:**
  - unit: 前端 gate email 比對(依現有 gate 測試慣例)。
  - integration/rules: rules 套件 email-based 全案;db/changelog/migrate 帳號白名單化後回歸。
  - e2e: 名單外登入被拒(若 e2e 具 auth emulator 情境);白名單登入進 App。
- **Rollback:** 前端 revert commit;rules 以 `firebase deploy --only firestore:rules` 重新部署前一版 `firestore.rules`(email→uid);資料根未變,回滾不影響既有資料。

### M6 — 部署 runbook + CHANGELOG(收尾)

- **Risk:** HIGH(含正式站 rules + hosting 部署與外部 Apps Script 重新部署)
- **Rationale for risk tier:** 動到正式站授權與線上收單鏡像契約;需按序執行並逐項驗收。
- **Files touched(estimated):** `CHANGELOG.md`、`js/firebase.js`(`APPS_SCRIPT_URL` 回填)、正式站(部署)、Apps Script(人工)
- **Steps(部署 runbook,按序):**
  1. **前置閘門**:M5 已通過 security-auditor 審查;`npm run test`(unit + emulator + e2e)全綠;`grep -rn "'; '" js/ tools/`(品項分隔)與 `grep -rn ensureMigrated js/` 均歸零 → verify: CI/本機全綠、grep 歸零。
  2. 更新 `CHANGELOG.md`:新增版本區塊(Added:線上銷售 + 線上分頁 + 全銷售備註;Changed:登入授權改 email 白名單雙人共帳、CSV/鏡像加備註與線上通路、品項分隔符統一 `、`;Removed:v1→v2 `ensureMigrated`),指向本規格 → verify: CHANGELOG 含新版本區塊。
  3. **rules + hosting 部署(CLI,可自動)**:`npx firebase deploy --only firestore,hosting`(本機 CLI 已登入 doqmon6@gmail.com) → verify: 部署成功回報;正式站載入新版。
  4. **Apps Script 重新部署(人工步驟,逐步引導)**:
     - 4a. `tools/apps-script-mirror.gs` 的 `HEADERS` 加「備註」欄(置於「付款方式」與「狀態」之間),`rowData` 對應加入 `payload.note || ''` → verify(本機):檔案含備註欄映射。
     - 4b. **人工**:開啟創作者帳號的 Apps Script 專案,貼上更新後 `apps-script-mirror.gs`。
     - 4c. **人工**:因表頭欄數由 9 增為 10,先清空鏡像試算表(刪除含表頭的所有列),讓 `ensureHeader` 於下次 POST 重建 10 欄表頭(無正式資料,可安全清空) → verify:試算表已清空。
     - 4d. **人工**:Deploy → New Deployment → Web App(Execute as: Me;Who has access: Anyone),複製新的 Web App URL。
     - 4e. **人工/本機**:把新 URL 填回 `js/firebase.js` 的 `APPS_SCRIPT_URL`,再次 `npx firebase deploy --only hosting` → verify:正式站記一筆銷售後,試算表出現含「備註」欄的新列。
  5. **正式站雙帳號登入驗收清單**(在正式站 https://market-sales-lily.web.app 執行):
     - [ ] doqmon6@gmail.com 可登入並記帳、看見資料。
     - [ ] 1111l.i.lilyshu@gmail.com 可登入,且看見與前者**同一本帳**(AC14)。
     - [ ] 任一名單外 Google 帳號登入 → 顯示「此帳號無權限」且被登出(AC13)。
     - [ ] 無進行中場次時可直接記一筆線上銷售(選日期、填備註),結帳成功(AC2)。
     - [ ] 「線上」分頁按月看見該筆,月營收正確,能編輯備註/日期與刪除(AC5/AC6)。
     - [ ] 有進行中場次時記銷售預設該場次、可切「線上」(AC2)。
     - [ ] 場次報表單筆編輯可補備註(AC7)。
     - [ ] 匯出「全部明細 CSV」含「備註」欄,線上筆「場次」欄為「線上」(AC8)。
     - [ ] 鏡像試算表新列含備註;線上筆「場次」欄為「線上」(AC9)。
- **Rollback:** hosting/rules 以 `firebase deploy` 重佈前一版(rules 回 uid 版、hosting 回前一 build);`APPS_SCRIPT_URL` 回填舊 URL 並重佈 hosting;Apps Script 於「管理部署」切回舊版本。

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Email 白名單漏檢 `email_verified` → 有人以未驗證同名 email 冒充 | 低 | 高(未授權讀寫整本帳) | rules 明確 `email_verified == true`;rules 套件含「白名單但未驗證 → deny」案;M5 security-auditor 審查 |
| `ensureMigrated` 未移除 → 線上筆登入後被吸進「舊紀錄」 | 中(若漏改) | 高(線上資料語意被摧毀) | M2 移除函式 + 呼叫 + 測試;AC4 專測「登入後 outingId 仍為 null」;`grep ensureMigrated` 歸零為部署閘門 |
| 線上筆 `createdAt` 以 `new Date('YYYY-MM-DD')` 建構 → 時區位移/同日碰撞 | 中 | 中(排序亂、時間欄失真) | 資料模型節明訂用 `new Date(y,m-1,d,hh,mm,ss)` 本地建構 + 保留時分秒;e2e 斷言 dateKey=選定日期 |
| Apps Script 表頭欄數變更但舊表頭殘留 → 欄位錯位 | 中 | 中(鏡像資料錯欄) | runbook 4c 清空試算表讓 `ensureHeader` 重建 10 欄表頭(無正式資料);payload 向前相容故前端可先上線 |
| 前端 gate 改 email 後 emulator/e2e 放行行為破壞 → 測試環境炸或正式旁路 | 低 | 中 | 保留 `isEmulatorMode` 放行僅限 emulator;fail-closed(名單空=拒);測試帳號白名單化 + emailVerified |
| rules 部署與前端 gate 版本不同步(其一先上) | 中 | 中(短暫登入被拒或雙防線不齊) | M6 以 `firebase deploy --only firestore,hosting` 同批部署;資料根不變使兩版對同資料一致 |

## Open questions

- **`ensureMigrated` 移除確認**(見資料模型 `[ARCHITECT DEFAULT — confirm]`)— owner: larry — due: 審閱本規格時。
- **`CREATOR_UID` 常數是否 rename** 為 `DATA_ROOT_UID` 以反映其新語意(現為固定資料根而非授權判準)— owner: larry — due: M5 實作前;預設保留原名 + 註記以縮小改動半徑。
- **協作者 email 是否確定為 `1111l.i.lilyshu@gmail.com`**(白名單將硬編碼進 rules 與前端,拼字錯誤 = 該帳號永遠被拒)— owner: 創作者 — due: M5 實作前。

## Out of scope but worth noting

- 線上筆不進帶貨/剩餘盤點:若未來線上出貨要併入庫存視角,需重啟 BACKLOG「跨場次商品彙總」討論。
- 白名單硬編碼於 rules + 前端兩處:三人以上或頻繁增減協作者時,應改 Firestore 中的授權文件(自訂 claim / allowlist doc),屆時記入 BACKLOG。
- 兩人同時編輯同一筆仍為 last-write-wins(BACKLOG 既有條目);雙人上線後若實際踩到,再評估欄位級合併或鎖。
- `changelog` 無限成長(BACKLOG 既有):雙人使用寫入量約增一倍,單人數年量級仍無虞,維持觀察觸發條件。
