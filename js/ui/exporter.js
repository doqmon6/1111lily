// CSV 匯出備份:當天 / 全部。優先用 Web Share(iOS PWA 下載受限),否則用瀏覽器下載。
import { getSalesByDate, getAllSales } from '../db.js';
import { toCSV, dateKey } from '../logic.js';
import { el } from './dom.js';

let container;

export async function init(viewEl) {
  container = viewEl;
  const dateInput = el('input', { id: 'export-date', type: 'date' });
  dateInput.value = dateKey(new Date());

  container.replaceChildren(
    el('div', { class: 'card' },
      el('h2', { text: '匯出備份' }),
      el('p', { class: 'hint', text: '資料只存在這支手機。收攤後請務必匯出 CSV 備份,以免手機遺失或瀏覽器清除資料時失去紀錄。' }),
      el('label', { class: 'field' }, '選擇日期', dateInput),
      el('button', { class: 'btn primary', id: 'export-day-btn', type: 'button', text: '匯出當天 CSV',
        onClick: () => exportDay(dateInput.value) }),
      el('button', { class: 'btn', id: 'export-all-btn', type: 'button', text: '匯出全部 CSV', onClick: exportAll }),
      el('p', { id: 'export-msg', class: 'msg', hidden: true }),
    ),
  );
}

async function exportDay(key) {
  const sales = await getSalesByDate(key);
  await output(toCSV(sales), `銷售_${key}.csv`, sales.length);
}

async function exportAll() {
  const sales = await getAllSales();
  await output(toCSV(sales), '銷售_全部.csv', sales.length);
}

async function output(csv, filename, count) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], filename, { type: 'text/csv' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      showMsg(`已分享 ${count} 筆`);
      return;
    } catch {
      // 使用者取消分享 → 退回下載
    }
  }

  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showMsg(`已匯出 ${count} 筆`);
}

function showMsg(text) {
  const m = container.querySelector('#export-msg');
  m.textContent = text;
  m.hidden = false;
  m.className = 'msg ok';
}
