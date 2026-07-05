// 共用單筆銷售編輯器:場次單筆編輯(showDate:false)與線上單筆編輯(showDate:true)
// 共用同一份品項 +/− / 付款方式 / 類型 / 備註編輯邏輯,兩者僅差一個日期欄。
import { computeTotal, formatMoney, onlineCreatedAt } from '../logic.js';
import { el } from './dom.js';

/**
 * 輸入 { sale, showDate, onSave, onCancel },回傳編輯器 DOM(class="sale-editor"),
 * 呼叫端自行掛到列表項目上取代原本內容。
 * - showDate 為真時多顯示日期欄(預設為 sale.dateKey),儲存時以「新日期 + 原
 *   createdAt 時分秒」重建 createdAt(沿用 onlineCreatedAt 語意,now 代入原 createdAt)。
 * - onSave(patch) 於按下儲存時呼叫,patch = { items, total, paymentMethod, type, note, createdAt? }
 *   (createdAt 僅 showDate 為真時附上)。items 為空陣列代表使用者把明細全部減到 0,
 *   呼叫端應視為刪除該筆(編輯器本身不判斷刪除,交由呼叫端決定)。
 * - onCancel() 於按下取消時呼叫。
 */
export function renderSaleEditor({ sale, showDate, onSave, onCancel }) {
  const draft = sale.items.map((i) => ({ ...i }));
  let method = sale.paymentMethod;
  let type = sale.type ?? 'sale';
  let note = sale.note ?? '';

  const itemsWrap = el('div', { class: 'edit-items' });
  const totalEl = el('strong', { class: 'edit-total' });
  const recalc = () => { totalEl.textContent = formatMoney(computeTotal(draft)); };

  function renderItems() {
    itemsWrap.replaceChildren(...draft.map((item) =>
      el('div', { class: 'edit-item' },
        el('span', { class: 'ei-name', text: item.name }),
        el('div', { class: 'qty' },
          el('button', { class: 'btn qbtn', type: 'button', text: '−', 'aria-label': '減少',
            onClick: () => { item.qty -= 1; if (item.qty <= 0) draft.splice(draft.indexOf(item), 1); renderItems(); recalc(); } }),
          el('span', { class: 'qv', text: String(item.qty) }),
          el('button', { class: 'btn qbtn', type: 'button', text: '＋', 'aria-label': '增加',
            onClick: () => { item.qty += 1; renderItems(); recalc(); } }),
        ),
      ),
    ));
  }

  const methodSelect = el('select', { class: 'edit-method' },
    el('option', { value: 'cash', text: '現金' }), el('option', { value: 'transfer', text: '轉帳' }));
  methodSelect.value = method;
  methodSelect.addEventListener('change', () => { method = methodSelect.value; });

  const typeSelect = el('select', { class: 'edit-type' },
    el('option', { value: 'sale', text: '正常銷售' }),
    el('option', { value: 'gift', text: '贈送(不計營收)' }),
    el('option', { value: 'replacement', text: '補送(不計營收)' }));
  typeSelect.value = type;
  typeSelect.addEventListener('change', () => { type = typeSelect.value; });

  const noteInput = el('input', { class: 'edit-note', type: 'text', maxlength: 200, placeholder: '備註(選填)' });
  noteInput.value = note;
  noteInput.addEventListener('input', () => { note = noteInput.value; });
  // trim 對齊 sale.js 線上記帳路徑的備註處理(儲存時去除前後空白)

  const dateInput = showDate
    ? el('input', { class: 'edit-date', type: 'date', value: sale.dateKey })
    : null;

  const editor = el('div', { class: 'sale-editor' },
    itemsWrap,
    dateInput ? el('label', { class: 'field' }, '日期', dateInput) : null,
    el('label', { class: 'field' }, '付款方式', methodSelect),
    el('label', { class: 'field' }, '類型', typeSelect),
    el('label', { class: 'field' }, '備註', noteInput),
    el('div', { class: 'cart-total' }, '合計 ', totalEl),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn accent', type: 'button', text: '儲存',
        onClick: () => {
          const patch = { items: draft, total: computeTotal(draft), paymentMethod: method, type, note: note.trim() };
          if (showDate) patch.createdAt = onlineCreatedAt(dateInput.value, new Date(sale.createdAt));
          onSave(patch);
        } }),
      el('button', { class: 'btn', type: 'button', text: '取消', onClick: onCancel }),
    ),
  );

  renderItems();
  recalc();
  return editor;
}
