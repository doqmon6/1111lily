import { describe, it, expect } from 'vitest';
import { computeTotal, summarizeDay, dateKey, toCSV, formatMoney } from '../js/logic.js';

describe('computeTotal', () => {
  it('多品項加總', () => {
    expect(computeTotal([{ price: 100, qty: 2 }, { price: 50, qty: 3 }])).toBe(350);
  });
  it('空陣列為 0', () => {
    expect(computeTotal([])).toBe(0);
  });
});

describe('dateKey', () => {
  it('本地 YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 4, 30, 9, 5))).toBe('2026-05-30');
  });
  it('月日補零', () => {
    expect(dateKey(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});

describe('summarizeDay', () => {
  it('混付款方式小計,且兩小計相加=總額', () => {
    const sales = [
      { total: 300, paymentMethod: 'cash' },
      { total: 150, paymentMethod: 'transfer' },
      { total: 50, paymentMethod: 'cash' },
    ];
    const s = summarizeDay(sales);
    expect(s.total).toBe(500);
    expect(s.count).toBe(3);
    expect(s.byMethod.cash).toBe(350);
    expect(s.byMethod.transfer).toBe(150);
    expect(s.byMethod.cash + s.byMethod.transfer).toBe(s.total);
  });
  it('空日為 0', () => {
    expect(summarizeDay([])).toEqual({ total: 0, count: 0, byMethod: { cash: 0, transfer: 0 } });
  });
});

describe('toCSV', () => {
  const sales = [{
    items: [{ name: '手鍊', price: 100, qty: 2 }, { name: '耳環', price: 150, qty: 1 }],
    total: 350, paymentMethod: 'cash', createdAt: '2026-05-30T01:05:00.000Z',
  }];

  it('含 UTF-8 BOM 與表頭', () => {
    const csv = toCSV(sales);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('日期,時間,商品明細,件數,總金額,付款方式');
  });
  it('明細串接、件數、總額、付款方式', () => {
    const csv = toCSV(sales);
    expect(csv).toContain('手鍊×2; 耳環×1');
    expect(csv).toContain(',3,350,現金');
    expect(csv).toContain('現金');
  });
  it('逗號與引號跳脫', () => {
    const csv = toCSV([{
      items: [{ name: 'A,B"C', price: 10, qty: 1 }],
      total: 10, paymentMethod: 'transfer', createdAt: '2026-05-30T01:00:00.000Z',
    }]);
    expect(csv).toContain('"A,B""C×1"');
  });
});

describe('formatMoney', () => {
  it('千分位', () => {
    expect(formatMoney(1234)).toBe('$1,234');
    expect(formatMoney(0)).toBe('$0');
  });
});
