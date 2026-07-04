/**
 * apps-script-mirror.gs — Google Sheets 鏡像接收端 (M6)
 *
 * 部署方式 (runbook step 8):
 *   1. 開啟 Google Apps Script (script.google.com)
 *   2. 建立新專案並「綁定」到目標試算表 (Extensions → Apps Script)
 *   3. 貼上此檔案內容
 *   4. Deploy → New Deployment → Web App
 *      - Execute as: 創作者本人 (Me)
 *      - Who has access: Anyone (匿名 POST,無 CORS preflight)
 *   5. 複製 Web App URL → 填入 js/firebase.js 的 APPS_SCRIPT_URL
 *
 * 接收格式 (Content-Type: text/plain, body 為 JSON 字串):
 *   新增/更新: { id, date, time, outing, type, items, total, payment, deleted: false }
 *   刪除標記: { id, deleted: true }
 *
 * 試算表規格:
 *   - 第一個工作表 (index 0)
 *   - 第 1 列為表頭: id | 日期 | 時間 | 場次 | 類型 | 商品明細 | 總金額 | 付款方式 | 狀態
 *   - 第 1 欄 (A) 為 id,用於 upsert 定位
 *   - 「狀態」欄: 空 = 正常;「已刪除」= 已刪除
 */

var HEADERS = ['id', '日期', '時間', '場次', '類型', '商品明細', '總金額', '付款方式', '狀態'];

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    // 確保表頭存在
    ensureHeader(sheet);

    var id = payload.id;
    var rowIndex = findRowById(sheet, id);

    if (payload.deleted) {
      // 刪除標記:找到列 → 更新「狀態」欄;找不到 → append 只含 id/狀態/時間
      if (rowIndex > 0) {
        var statusCol = HEADERS.indexOf('狀態') + 1;
        sheet.getRange(rowIndex, statusCol).setValue('已刪除');
      } else {
        var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
        var newRow = new Array(HEADERS.length).fill('');
        newRow[0] = id;                          // id
        newRow[HEADERS.indexOf('狀態')] = '已刪除'; // 狀態
        newRow[HEADERS.indexOf('日期')] = now;    // 日期(記錄刪除時間)
        sheet.appendRow(newRow);
      }
    } else {
      // 新增或更新:組整列資料
      var rowData = [
        id,
        payload.date    || '',
        payload.time    || '',
        payload.outing  || '',
        payload.type    || '',
        payload.items   || '',
        payload.total   != null ? payload.total : '',
        payload.payment || '',
        '',  // 狀態:正常為空
      ];

      if (rowIndex > 0) {
        // 找到既有列 → 整列更新
        sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([rowData]);
      } else {
        // 找不到 → append
        sheet.appendRow(rowData);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** 確保第 1 列為表頭;若不存在或第一欄不是 'id' 則在最前插入一列。 */
function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() !== 'id') {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

/** 依第 1 欄 id 找列號(1-based)。找不到回傳 -1。從第 2 列起找(跳過表頭)。 */
function findRowById(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var col = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]) === String(id)) return i + 2;
  }
  return -1;
}
