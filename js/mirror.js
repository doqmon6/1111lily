// mirror.js — 單向 Google Sheets 鏡像(M6)。
// 每筆 sale 的 create/update/delete「樂觀寫入當下」即入 localStorage 佇列(持久,
// 離線關 App 也不漏),flush 時取「當下最新狀態」推送 Apps Script,天然避免亂序。
// APPS_SCRIPT_URL = null → flush / fetch 均 no-op。
// 注意:flush 進行中新入列的 id 要等下一次觸發(下一筆寫入 / online / flush 尾端補跑)。
//
// 公開 API:
//   initMirror()     — 登入成功後由 app.js 呼叫一次(掛 online listener + 初始 flush)
//   _setUrl(u)       — 測試 hook,覆寫運行期 URL
import { APPS_SCRIPT_URL } from './firebase.js';
import { typeLabel, paymentLabel, itemsSummary } from './logic.js';
import { onSaleWritten, getSale, getOuting } from './db.js';

const QUEUE_KEY = 'market-sales:mirror-queue';

// 運行期 URL:預設取 firebase.js 的常數,測試可 _setUrl() 覆寫。
let _url = APPS_SCRIPT_URL;
export function _setUrl(u) { _url = u; }

// ─── localStorage 佇列工具 ───

function readQueue() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeQueue(q) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch { /* 無 localStorage 時靜默略過 */ }
}

// 同 id 覆蓋 deleted 旗標:去重語意,重送取最新狀態
function enqueue(id, deleted) {
  const q = readQueue();
  q[id] = { deleted };
  writeQueue(q);
}

// ─── payload 組裝 ───

function salePayload(sale, outingName) {
  const dt = new Date(sale.createdAt);
  const date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  const items = itemsSummary(sale.items ?? []);
  return {
    id: sale.id,
    date,
    time,
    outing: outingName ?? '',
    type: typeLabel(sale.type),
    items,
    total: sale.total,
    payment: paymentLabel(sale.paymentMethod),
    note: sale.note ?? '',
    deleted: false,
  };
}

// ─── flush ───

let flushing = false;

// 序列送出佇列中每個 id;失敗(非 2xx / throw)→ 保留該 id、停止本輪、不 throw 到外面。
async function flush() {
  if (!_url) return;
  if (flushing) return;
  flushing = true;
  let progressed = false; // 本輪是否成功送出過(失敗 break 時不補跑,避免熱迴圈)
  try {
    const q = readQueue();
    for (const id of Object.keys(q)) {
      const { deleted } = q[id];
      let payload;
      if (deleted) {
        payload = { id, deleted: true };
      } else {
        const sale = await getSale(id);
        if (!sale) {
          // getSale 傳回 null 代表已被刪除:補送刪除標記
          payload = { id, deleted: true };
        } else {
          let outingName = '';
          if (sale.outingId == null) {
            outingName = '線上';
          } else {
            const outing = await getOuting(sale.outingId);
            outingName = outing?.name ?? '';
          }
          payload = salePayload(sale, outingName);
        }
      }
      try {
        const res = await fetch(_url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const current = readQueue();
          delete current[id];
          writeQueue(current);
          progressed = true;
        } else {
          break; // 保留、停止本輪
        }
      } catch {
        break; // 網路錯誤、保留、停止本輪
      }
    }
  } finally {
    flushing = false;
  }
  // flush 期間新入列的 id 本輪快照看不到:有進展且佇列仍非空 → 補跑一輪
  if (progressed && Object.keys(readQueue()).length) flush();
}

// ─── onSaleWritten 掛載(module 載入時即掛,與 URL 是否設定無關)───
// callback 執行時才讀 _url,允許測試透過 _setUrl() 控制行為。

onSaleWritten(({ sale, deleted }) => {
  if (!_url) return; // URL 未設定:no-op
  if (!sale?.id) return; // 防空 id 入列(deleteSale 對不存在 id 的防禦邊界)
  enqueue(sale.id, deleted);
  flush();
});

// ─── initMirror ───

let _onlineAdded = false;

// 登入成功後由 app.js 呼叫一次:掛 online listener + flush 殘留佇列。
export function initMirror() {
  if (!_onlineAdded && typeof window !== 'undefined') {
    _onlineAdded = true;
    window.addEventListener('online', () => flush());
  }
  flush(); // 重送殘留(init 時 + 任何呼叫時均可重試)
}
