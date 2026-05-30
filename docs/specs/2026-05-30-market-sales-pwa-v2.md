# 市集銷售記錄 PWA v2 — 規格(場次 / 成本 / 帶貨剩貨 / 匯出重設計)

- 日期:2026-05-30
- 狀態:已實作,待使用者審查
- 前身:`2026-05-30-market-sales-pwa.md`(v1,已上線)
- 來源:critical-discussion 收斂(見 v1 規格與本檔決策紀錄)

## Summary

v1 解決「擺攤更快記每筆銷售 + 依日期對帳 + CSV 備份」。v2 把**組織單位從「天」改為「場次(outing)」**,並補上創作者實際需要的:帶貨/剩貨盤點、商品成本、特例交易(贈送/補送不計營收)、匯出重設計、可還原備份與防遺失。

**北極星不變**:更快地記 + 記得更方便 + 留下乾淨、日後接得上分析的紀錄。**系統本身不做分析儀表板/趨勢圖**;只把資料記乾淨,讓後續(Excel/之後的工具)能接著算。「淨額」是核銷的延伸(一個數字,非圖表),不算儀表板。

## Scope(v2 新增/變更)

- **場次(outing)**:可命名(玩具展、松菸文創);同時僅一場「進行中」;含 1~N 天(由場內銷售的日期自動分計);可關閉。
- **記銷售綁定場次**:結帳自動歸入進行中場次;無進行中場次時擋下並引導開場。
- **帶貨/剩貨**:開場可輸入每商品帶幾個;`剩餘 = 帶量 − 出貨量`(出貨含贈送/補送)。現場新增商品無帶量,剩餘顯示「—」。
- **商品成本**:商品/現場新增多一欄「成本」(材料/進貨,整數 ≥ 0,選填);成交時快照進 `sale.items[].cost`。
- **特例交易類型**:一筆可標 `正常銷售 / 贈送 / 補送`;只有正常銷售計入營收,三者都算出貨(扣剩餘)。
- **場次報表(取代 v1「對帳」分頁)**:收入(只算正常銷售)/銷售筆數/現金・轉帳小計/商品成本/固定成本/**淨額**;**每日分計**(>1 天時);**商品彙總(帶/賣/剩/收入)+ 好賣排行/滯銷**;特例件數;可編輯/刪除單筆(可改類型)。
- **場次固定成本**:每場可填攤租/交通/住宿(選填)。
- **匯出重設計**:① 場次銷售明細 CSV(欄位 `日期,時間,場次,類型,商品明細,總金額,付款方式`,**移除 v1 冗餘的「件數」**);② 場次商品彙總 CSV(`商品,帶量,賣出,剩餘,收入,成本`);③ 全部明細 CSV。
- **備份與防遺失**:**JSON 備份檔**(完整資料)+「從備份還原」(覆蓋);`navigator.storage.persist()` 要求瀏覽器別清除;「**N 筆尚未備份**」提醒。

## Non-scope(維持 / 新明確不做)

- 不做損益儀表板/趨勢圖、客戶 CRM、雲端同步、金流刷卡、自動背景匯出(手機網頁辦不到)。
- **工時成本不算**(成本僅材料/進貨,避免毛利假象)。
- 固定成本僅攤租/交通/住宿三項具名欄位,**不做自訂成本項**。→ BACKLOG
- 取消 v1 的「匯出某天」(場次已取代「天」為匯出單位)。
- 商品彙總僅以「單一場次」為單位(剩餘需綁定該場帶貨)。

## 已接受的已知風險

1. **單機資料風險**:仍以單機為主。緩解升級:`storage.persist()` + 可還原 JSON 備份 + 未備份提醒(非消滅風險)。
2. **iOS Safari 儲存清除**:同上緩解;仍建議加到主畫面 + 每場備份。
3. **特例交易種類無法窮舉**:設計為可擴充的 `type`('sale'|'gift'|'replacement'),日後新增類型只需擴字典。

## Data model(IndexedDB `market-sales-db` **version 2**)

既有讀取一律給預設(`sale.type ?? 'sale'`、`sale.outingId ?? null`、`product.cost ?? 0`)。

### `products`(v2 加 `cost`)
| 欄位 | 型別 | 說明 |
|---|---|---|
| id / name / price / active / createdAt | — | 同 v1 |
| `cost` | integer ≥ 0 | 材料/進貨成本(選填,預設 0) |

### `sales`(v2 加 `outingId` / `type`,items 加 `cost` 快照)
| 欄位 | 型別 | 說明 |
|---|---|---|
| id / items / total / paymentMethod / createdAt / dateKey | — | 同 v1;`items[]` 增 `cost` 快照 |
| `outingId` | string \| null | 所屬場次;index |
| `type` | 'sale'\|'gift'\|'replacement' | 預設 'sale';只有 'sale' 計營收 |

### `outings`(新)
| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string(uuid) | keyPath |
| `name` | string | 場次名稱 |
| `status` | 'open'\|'closed' | 同時僅一場 open |
| `fixedCosts` | `[{label, amount}]` | 攤租/交通/住宿 |
| `brought` | `[{productId, broughtQty}]` | 帶貨清單 |
| `startedAt` / `closedAt` | ISO | — |

### 遷移(`onupgradeneeded` v1→v2)
建 `outings` store 與 `sales.outingId` index(保留 `dateKey` index)。資料層 `ensureMigrated()` 於啟動時冪等執行:無 `outingId` 的舊銷售 → 指派到自動建立的已關閉場次「舊紀錄」。

## Acceptance criteria(每條對應測試)

1. v1→v2 升級後,舊銷售保留且歸入「舊紀錄」場次;冪等。→ db.test「v1 → v2 遷移」
2. 商品可記成本,未填預設 0;可編輯。→ db.test「product cost」/ products.spec「成本…」
3. 場次:新增=進行中、同時僅一場、關閉後無進行中。→ db.test「outings」
4. 結帳綁進行中場次;無場次擋下。→ outing.spec「尚未開始場次」「開始場次後記銷售」
5. 收入只算正常銷售(贈送/補送排除)。→ logic.test「outingRevenue」/ outing.spec
6. 帶 N 賣 M(含贈送)→ 剩 N−M;現場新增剩餘為「—」。→ logic.test「productAggregate」/ outing.spec「帶貨剩餘」
7. 好賣排行依賣出件數;滯銷(賣 0)可見。→ logic.test「ranking / 滯銷」
8. 淨額 = 正常銷售收入 − 出貨商品成本 − 固定成本。→ logic.test「outingNet」/ outing.spec「淨額」
9. 編輯一筆改類型 → 收入即時重算;刪除 → 明細消失。→ outing.spec「編輯…贈送」「刪除…」
10. 場次明細 CSV:含 BOM、新表頭、無「件數」、帶場次/類型。→ logic.test「toSalesCSV」/ export.spec「場次明細 CSV」
11. 商品彙總 CSV:每商品帶/賣/剩/收入/成本。→ logic.test「toProductSummaryCSV」/ export.spec「商品彙總 CSV」
12. JSON 備份 → 清空資料 → 還原 → 完整回來。→ export.spec「JSON 備份 → 清空 → 還原」
13. 未備份提醒:有未備份顯示警告,備份後轉為已備份。→ export.spec「未備份提醒」
14. 既有 v1 功能(商品 CRUD/記銷售熱路徑/離線/安裝)不退化。→ products/sale/shell.spec 全綠

> 測試總數:單元/整合 32(vitest + fake-indexeddb)+ e2e 24(Playwright/Chromium、真 IndexedDB、真 SW/離線)。

## 自行判斷(已實作,待使用者於審查時否決)

- 場次固定成本(攤租/交通/住宿)納入(SD①)。
- 一行「淨額」(收入 − 出貨成本 − 固定成本),純數字無圖表(SD②)。
- 剩餘扣所有出貨、收入只算正常銷售、淨額成本含贈送耗材(SD③)。
- 舊資料遷移到「舊紀錄」場次(SD④);同時僅一場進行中(SD⑤)。

## 決策紀錄(v2 增補)

| 決策 | 選擇 | 否決/理由 |
|---|---|---|
| 組織單位 | 場次(含多天) | 最小增量(天+場並存)會「越走越彎」→ 重構 |
| 對帳分頁 | 改為場次中心(retire `ui/report.js`) | — |
| 庫存 | 重啟「帶貨/剩貨」 | v1 列 BACKLOG,觸發條件已成立 |
| 成本 | 重啟「逐商品 + 場次固定成本」,僅材料 | 工時成本=大坑,不做 |
| 備份格式 | JSON(可還原)+ CSV(給人看)雙軌 | 單 CSV 無法完整還原 |
| 防遺失 | persist() + 還原 + 未備份提醒 | 雲端同步仍過度設計 → BACKLOG |
| 匯出單位 | 場次/全部 | 取消「某天」(場次取代) |
