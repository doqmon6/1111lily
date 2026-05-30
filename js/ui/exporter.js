// 匯出與備份:
// - CSV(給人看 / Excel):場次明細、場次商品彙總、全部明細。
// - JSON 備份檔(可還原):防手機遺失 / 換機。附「未備份提醒」。
import {
  getAllSales, getSalesByOuting, getAllOutings, getOuting, getAllProducts, exportAll, importAll,
} from '../db.js';
import { toSalesCSV, toProductSummaryCSV, productAggregate, ranking, dateKey } from '../logic.js';
import { el } from './dom.js';

const LAST_BACKUP_KEY = 'market-sales:lastBackupAt';

let container;

export async function init(viewEl) {
  container = viewEl;
  const restoreInput = el('input', { id: 'restore-file', type: 'file', accept: '.json,application/json' });
  restoreInput.addEventListener('change', onRestore);

  const outingSelect = el('select', { id: 'export-outing' });

  container.replaceChildren(
    el('div', { id: 'backup-reminder', class: 'backup-reminder', hidden: true }),

    el('div', { class: 'card' },
      el('h2', { text: '場次匯出(CSV)' }),
      el('label', { class: 'field' }, '選擇場次', outingSelect),
      el('button', { class: 'btn primary', id: 'export-detail-btn', type: 'button', text: '匯出銷售明細 CSV',
        onClick: () => exportOutingDetail(outingSelect.value) }),
      el('button', { class: 'btn', id: 'export-summary-btn', type: 'button', text: '匯出商品彙總 CSV',
        onClick: () => exportOutingSummary(outingSelect.value) }),
    ),

    el('div', { class: 'card' },
      el('h2', { text: '全部 / 備份' }),
      el('button', { class: 'btn', id: 'export-all-btn', type: 'button', text: '匯出全部明細 CSV', onClick: exportAllDetail }),
      el('p', { class: 'hint', text: 'CSV 是給你看的報表;要能換手機/還原,請用下面的 JSON 備份。' }),
      el('button', { class: 'btn primary', id: 'backup-btn', type: 'button', text: '備份全部資料(JSON,可還原)', onClick: backupJSON }),
      el('label', { class: 'field' }, '從備份還原(覆蓋目前資料)', restoreInput),
      el('p', { id: 'export-msg', class: 'msg', hidden: true }),
    ),
  );
  await render();
}

export async function show() {
  await render();
}

async function render() {
  const outings = await getAllOutings();
  const select = container.querySelector('#export-outing');
  const prev = select.value;
  select.replaceChildren(...outings.map((o) =>
    el('option', { value: o.id, text: o.name + (o.status === 'open' ? '(進行中)' : '') })));
  if (prev && outings.some((o) => o.id === prev)) select.value = prev;
  const hasOutings = outings.length > 0;
  container.querySelector('#export-detail-btn').disabled = !hasOutings;
  container.querySelector('#export-summary-btn').disabled = !hasOutings;
  await renderReminder();
}

// ---- CSV ----

async function outingNames() {
  const outings = await getAllOutings();
  return Object.fromEntries(outings.map((o) => [o.id, o.name]));
}

async function exportOutingDetail(outingId) {
  if (!outingId) return;
  const sales = await getSalesByOuting(outingId);
  const outing = await getOuting(outingId);
  await output(toSalesCSV(sales, await outingNames()), `銷售明細_${safe(outing.name)}.csv`);
}

async function exportOutingSummary(outingId) {
  if (!outingId) return;
  const outing = await getOuting(outingId);
  const sales = await getSalesByOuting(outingId);
  const products = await getAllProducts();
  const agg = ranking(productAggregate({ brought: outing.brought, sales, products }));
  await output(toProductSummaryCSV(agg), `商品彙總_${safe(outing.name)}.csv`);
}

async function exportAllDetail() {
  const sales = await getAllSales();
  await output(toSalesCSV(sales, await outingNames()), '銷售明細_全部.csv');
}

// ---- JSON 備份 / 還原 ----

async function backupJSON() {
  const data = await exportAll();
  const payload = { app: 'market-sales', version: 2, exportedAt: new Date().toISOString(), ...data };
  await output(JSON.stringify(payload, null, 2), `備份_${dateKey(new Date())}.json`, 'application/json');
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  await renderReminder();
}

async function onRestore(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return showMsg('檔案格式錯誤,無法讀取', true);
  }
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.sales)) {
    return showMsg('這不是有效的備份檔', true);
  }
  if (!window.confirm('還原會以備份檔「覆蓋」目前手機上的所有資料,確定?')) return;
  await importAll({ products: data.products, sales: data.sales, outings: data.outings ?? [] });
  showMsg(`已還原:商品 ${data.products.length}、銷售 ${data.sales.length}、場次 ${(data.outings ?? []).length}`, false);
}

// ---- 未備份提醒 ----

async function renderReminder() {
  const last = localStorage.getItem(LAST_BACKUP_KEY);
  const sales = await getAllSales();
  const unbacked = last ? sales.filter((s) => s.createdAt > last).length : sales.length;
  const banner = container.querySelector('#backup-reminder');
  banner.hidden = false;
  if (unbacked > 0) {
    banner.className = 'backup-reminder warn';
    banner.replaceChildren(el('span', { text: `⚠️ 有 ${unbacked} 筆自上次備份後尚未備份。收攤後請「備份全部資料(JSON)」存到雲端或傳給自己。` }));
  } else {
    banner.className = 'backup-reminder ok';
    banner.replaceChildren(el('span', { text: '✓ 目前資料已備份。' }));
  }
}

// ---- 共用 ----

function safe(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}

async function output(text, filename, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const file = new File([blob], filename, { type: mime });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      showMsg('已分享 ' + filename, false);
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
  showMsg('已匯出 ' + filename, false);
}

function showMsg(text, isError) {
  const m = container.querySelector('#export-msg');
  m.textContent = text;
  m.hidden = false;
  m.className = 'msg ' + (isError ? 'error' : 'ok');
}
