import { describe, it, expect } from 'vitest';
import {
  computeTotal, summarizeDay, dateKey, formatMoney,
  outingRevenue, sumFixedCosts, soldCost, outingNet, productAggregate, ranking,
  toSalesCSV, toProductSummaryCSV,
} from '../js/logic.js';

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

describe('toSalesCSV', () => {
  const sales = [{
    items: [{ name: '手鍊', price: 100, qty: 2 }, { name: '耳環', price: 150, qty: 1 }],
    total: 350, paymentMethod: 'cash', type: 'sale', outingId: 'o1', createdAt: '2026-05-30T01:05:00.000Z',
  }];

  it('含 UTF-8 BOM、新表頭(有場次/類型、無冗餘件數)', () => {
    const csv = toSalesCSV(sales, { o1: '玩具展' });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('日期,時間,場次,類型,商品明細,總金額,付款方式');
    expect(csv).not.toContain('件數');
  });
  it('帶出場次名、類型、明細、總額、付款方式', () => {
    const csv = toSalesCSV(sales, { o1: '玩具展' });
    expect(csv).toContain('玩具展,正常銷售,手鍊×2; 耳環×1,350,現金');
  });
  it('贈送顯示類型;逗號與引號跳脫', () => {
    const csv = toSalesCSV([{
      items: [{ name: 'A,B"C', price: 10, qty: 1 }],
      total: 10, paymentMethod: 'transfer', type: 'gift', outingId: 'o1', createdAt: '2026-05-30T01:00:00.000Z',
    }], { o1: '松菸' });
    expect(csv).toContain('贈送');
    expect(csv).toContain('"A,B""C×1"');
  });
});

describe('toProductSummaryCSV', () => {
  it('一列一商品:帶/賣/剩/收入/成本;無帶貨欄留空', () => {
    const agg = [
      { name: '明信片', brought: 30, sold: 7, remaining: 23, revenue: 100, cost: 56 },
      { name: '現場小卡', brought: null, sold: 3, remaining: null, revenue: 150, cost: 0 },
    ];
    const csv = toProductSummaryCSV(agg);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('商品,帶量,賣出,剩餘,收入,成本');
    expect(csv).toContain('明信片,30,7,23,100,56');
    expect(csv).toContain('現場小卡,,3,,150,0');
  });
});

describe('formatMoney', () => {
  it('千分位', () => {
    expect(formatMoney(1234)).toBe('$1,234');
    expect(formatMoney(0)).toBe('$0');
  });
});

describe('outingRevenue', () => {
  it('只算正常銷售,排除贈送/補送;無 type 視為正常', () => {
    const sales = [
      { type: 'sale', total: 300 },
      { type: 'gift', total: 100 },
      { type: 'replacement', total: 50 },
      { total: 200 },
    ];
    expect(outingRevenue(sales)).toBe(500);
  });
});

describe('sumFixedCosts', () => {
  it('加總金額,容忍空與缺值', () => {
    expect(sumFixedCosts([{ label: '攤租', amount: 2000 }, { label: '交通', amount: 300 }])).toBe(2300);
    expect(sumFixedCosts()).toBe(0);
    expect(sumFixedCosts([{ label: 'x' }])).toBe(0);
  });
});

describe('productAggregate', () => {
  const brought = [{ productId: 'A', broughtQty: 30 }];
  const sales = [
    { type: 'sale', items: [{ productId: 'A', name: '明信片', price: 20, qty: 5 }] },
    { type: 'gift', items: [{ productId: 'A', name: '明信片', price: 20, qty: 2 }] },
    { type: 'sale', items: [{ productId: 'B', name: '現場小卡', price: 50, qty: 3 }] },
  ];
  const products = [{ id: 'A', name: '明信片' }, { id: 'B', name: '現場小卡' }];

  it('帶30賣7(含贈送)剩23;收入只算正常銷售', () => {
    const a = productAggregate({ brought, sales, products }).find((r) => r.productId === 'A');
    expect(a.brought).toBe(30);
    expect(a.sold).toBe(7);
    expect(a.remaining).toBe(23);
    expect(a.revenue).toBe(100);
  });

  it('現場新增(無帶貨)剩餘為 null,仍計賣出與收入', () => {
    const b = productAggregate({ brought, sales, products }).find((r) => r.productId === 'B');
    expect(b.brought).toBeNull();
    expect(b.remaining).toBeNull();
    expect(b.sold).toBe(3);
    expect(b.revenue).toBe(150);
  });

  it('帶了但完全沒賣的商品仍出現(滯銷可見)', () => {
    const agg = productAggregate({ brought: [{ productId: 'C', broughtQty: 10 }], sales: [], products: [{ id: 'C', name: '滯銷品' }] });
    const c = agg.find((r) => r.productId === 'C');
    expect(c.sold).toBe(0);
    expect(c.remaining).toBe(10);
    expect(c.name).toBe('滯銷品');
  });

  it('累計出貨成本(含贈送耗材)', () => {
    const agg = productAggregate({
      brought: [],
      sales: [
        { type: 'sale', items: [{ productId: 'A', name: 'A', price: 20, cost: 8, qty: 5 }] },
        { type: 'gift', items: [{ productId: 'A', name: 'A', price: 20, cost: 8, qty: 2 }] },
      ],
      products: [{ id: 'A', name: 'A' }],
    });
    expect(agg[0].cost).toBe(56);
  });
});

describe('ranking', () => {
  it('依賣出件數由多到少(同則依收入)', () => {
    const agg = [
      { productId: 'A', sold: 2, revenue: 200 },
      { productId: 'B', sold: 9, revenue: 90 },
      { productId: 'C', sold: 0, revenue: 0 },
    ];
    expect(ranking(agg).map((r) => r.productId)).toEqual(['B', 'A', 'C']);
  });
});

describe('soldCost / outingNet', () => {
  const sales = [
    { type: 'sale', total: 1000, items: [{ productId: 'A', price: 100, cost: 40, qty: 10 }] },
    { type: 'gift', total: 100, items: [{ productId: 'A', price: 100, cost: 40, qty: 1 }] },
  ];
  it('出貨成本含贈送耗材', () => {
    expect(soldCost(sales)).toBe(440);
  });
  it('淨額 = 收入 − 出貨成本 − 固定成本', () => {
    const fixed = [{ label: '攤租', amount: 500 }, { label: '交通', amount: 100 }];
    expect(outingNet(sales, fixed)).toBe(1000 - 440 - 600);
  });
});
