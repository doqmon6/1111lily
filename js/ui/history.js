// 修改歷史:唯讀 changelog 檢視(append-only,無任何編輯/刪除控制)。
// renderHistoryCard() 回傳一個 card 元素,掛入 exporter.js init 尾端。
// 展開狀態存模組變數 _expanded:show()/重繪時保留使用者展開選擇。
import { getChangelog } from '../db.js';
import { saleChangeSummary, formatMoney } from '../logic.js';
import { el } from './dom.js';

let _expanded = false;

const ACTION_LABEL = { create: '新增', update: '編輯', delete: '刪除' };
const ACTION_CLASS = { create: 'badge-create', update: 'badge-update', delete: 'badge-delete' };

function formatTime(isoStr) {
  const d = new Date(isoStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function saleSummary(sale) {
  if (!sale) return '';
  const items = (sale.items ?? []).map((i) => `${i.name}×${i.qty}`).join('、');
  return `${items}  ${formatMoney(sale.total)}`;
}

function renderList(entries) {
  if (!entries.length) {
    return el('p', { class: 'hint', text: '尚無修改歷史。' });
  }
  return el('ul', { class: 'list history-list' }, ...entries.map((entry) => {
    const sale = entry.after ?? entry.before;
    const changes = saleChangeSummary(entry.before, entry.after);
    const nodes = [
      el('span', { class: 'history-time', text: formatTime(entry.at) }),
      el('span', { class: `badge ${ACTION_CLASS[entry.action] ?? ''}`, text: ACTION_LABEL[entry.action] ?? entry.action }),
      el('span', { class: 'history-summary', text: saleSummary(sale) }),
    ];
    if (changes.length) {
      nodes.push(el('ul', { class: 'history-changes' }, ...changes.map((c) => el('li', { text: c }))));
    }
    return el('li', { class: 'history-row' }, ...nodes);
  }));
}

export function renderHistoryCard() {
  const body = el('div', { class: 'history-body', hidden: !_expanded });
  const toggleBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: _expanded ? '收起' : '查看',
  });

  async function toggle() {
    _expanded = !_expanded;
    toggleBtn.textContent = _expanded ? '收起' : '查看';
    body.hidden = !_expanded;
    if (_expanded) {
      body.replaceChildren(el('p', { class: 'hint', text: '載入中…' }));
      const entries = await getChangelog();
      body.replaceChildren(renderList(entries));
    }
  }

  toggleBtn.addEventListener('click', toggle);

  // 若已展開(重繪時保留狀態),立即填入資料
  if (_expanded) {
    getChangelog().then((entries) => body.replaceChildren(renderList(entries)));
  }

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', { text: '修改歷史' }),
      toggleBtn,
    ),
    body,
  );
}
