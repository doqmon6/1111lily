# 市集銷售記錄 PWA

給手作創作者擺攤用的**純本機、離線優先**手機網頁 App。商品清單點選快速記銷售、依日期自動對帳、CSV 匯出備份。資料只存在你的手機,不需要網路、不需要帳號、不需要伺服器。

## 功能

- **商品**:新增/編輯/停售商品(品名 + 單價,不管庫存)。
- **記銷售**:點選商品 → 調數量 → 選付款方式(現金/轉帳)→ 完成。一筆可含多樣商品,自動加總;可在現場臨時新增商品馬上開賣;畫面常駐「今天累計」。
- **對帳**:選日期看 總營收 / 筆數 / 現金小計 / 轉帳小計,並可編輯或刪除單筆銷售。
- **匯出**:把當天或全部銷售匯出成 CSV(UTF-8 BOM,Excel 開繁中不亂碼)備份。

## ⚠️ 資料安全(務必閱讀)

資料只存在這支手機的瀏覽器裡,所以:

1. **收攤後務必到「匯出」分頁匯出 CSV 備份**。手機遺失、損壞、重置都會讓未備份的紀錄消失。
2. **請把網站「加到主畫面」**再使用。iOS Safari 對「未加到主畫面、且長期未開啟」的網頁,可能清除其本機資料;加到主畫面能取得較持久的儲存。
3. 「依日期」對帳:同一天若擺兩場,會合併計算、無法分場。

## 本機執行 / 開發

需要 Node.js。

```bash
npm install                 # 安裝開發/測試相依(出貨產物本身零相依)
npm run serve               # 本機啟動 http://localhost:4173
npx playwright install chromium   # 首次跑 e2e 前安裝瀏覽器
npm run test:unit           # 單元 + 資料層(vitest + fake-indexeddb)
npm run test:e2e            # 端到端(Playwright,真瀏覽器 + 真 IndexedDB)
npm test                    # 全部
```

App 本身是原生 HTML/CSS/JS + IndexedDB + Service Worker,**沒有建置步驟**;`index.html`、`css/`、`js/`、`sw.js`、`manifest.webmanifest`、`icons/` 即為可部署的全部內容。`tools/`、`tests/` 僅供開發測試,不需部署。

## 部署(免費靜態主機)

PWA 的安裝與離線需要 HTTPS 來源(本機 `localhost` 也算安全來源)。建議部署到 GitHub Pages 或 Netlify:

- **GitHub Pages**:把專案推到 GitHub repo → Settings → Pages → 由 branch 根目錄發佈。
- **Netlify**:拖曳專案資料夾到 Netlify,或連接 GitHub repo;publish directory 設為專案根目錄(無 build command)。

部署後用手機開該網址 → 瀏覽器選單「加到主畫面」即可離線使用。

> 注意:`.gitignore` 已排除 `node_modules/`、測試產物與無關的設定備份資料夾。
