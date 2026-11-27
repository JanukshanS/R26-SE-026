/**
 * The shop's own system: inventory, stock control, purchasing and counter
 * sales. The things worth protecting: stock always matches its history and
 * never goes below zero, costs follow what was actually paid, sales add up,
 * and returns never give back more than was sold.
 */
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/utils/prisma';
import { addPart, as, newShop } from './helpers';

const stockOf = async (id: string) => (await prisma.part.findUniqueOrThrow({ where: { id } })).stockQty.toNumber();
const historySum = async (id: string) =>
  (await prisma.stockMovement.aggregate({ where: { partId: id }, _sum: { quantityChange: true } }))._sum.quantityChange?.toNumber() ?? 0;

describe('shop setup', () => {
  it('lets any account open one shop and keeps each shop to itself', async () => {
    const me = as(`u-${Date.now()}`);
    expect((await me.get('/api/v1/shop')).body.data).toBeNull();
    expect((await me.get('/api/v1/shop/parts')).status).toBe(404);
    expect((await me.put('/api/v1/shop', { name: 'Kandy Spares', taxRate: 0 })).status).toBe(201);
    expect((await me.put('/api/v1/shop', { phone: '0771234567' })).body.data).toMatchObject({ name: 'Kandy Spares', phone: '0771234567', delivers: true });
    expect((await me.get('/api/v1/me')).body.data.shop).toMatchObject({ name: 'Kandy Spares' });

    const a = await newShop();
    const b = await newShop();
    const part = await addPart(a.client);
    expect((await b.client.get(`/api/v1/shop/parts/${part.id}`)).status).toBe(404);
  });
});

describe('inventory', () => {
  it('records opening stock, finds parts by any number or by the car they fit, and scans barcodes', async () => {
    const { client } = await newShop();
    const pads = await addPart(client, { barcode: '4047024123456', crossRefs: ['bp-alt-1'] });
    await addPart(client, { name: 'Oil 5W-30 4L', sku: 'OIL-1', oemNumber: null, universal: true, fitments: [] });
    await addPart(client, { name: 'Vitz pads', sku: 'VZ-1', oemNumber: '04466-52180', fitments: [{ make: 'Toyota', model: 'Vitz' }] });
    expect(pads.stockQty).toBe(10);
    expect(await historySum(pads.id)).toBe(10);

    const names = async (qs: string) => (await client.get(`/api/v1/shop/parts?${qs}`)).body.data.items.map((p: { name: string }) => p.name).sort();
    expect(await names('q=04465')).toEqual(['Front brake pads']);
    expect(await names('q=BP-ALT-1')).toEqual(['Front brake pads']);
    // An Aqua 2015: its pads and the universal oil, not the Vitz pads.
    expect(await names('make=toyota&model=aqua&year=2015')).toEqual(['Front brake pads', 'Oil 5W-30 4L']);
    // Outside the year range: only the universal part.
    expect(await names('make=Toyota&model=Aqua&year=2020')).toEqual(['Oil 5W-30 4L']);

    expect((await client.get('/api/v1/shop/parts/lookup?code=4047024123456')).body.data.id).toBe(pads.id);
  });

  it('counts stock to a number, records damage, and never goes below zero', async () => {
    const { client } = await newShop();
    const part = await addPart(client);
    expect((await client.post(`/api/v1/shop/parts/${part.id}/adjust`, { countedQty: 7 })).body.data.stockQty).toBe(7);
    expect((await client.post(`/api/v1/shop/parts/${part.id}/adjust`, { change: -1, reason: 'DAMAGED', note: 'Cracked' })).body.data.stockQty).toBe(6);
    expect((await client.post(`/api/v1/shop/parts/${part.id}/adjust`, { change: -50 })).status).toBe(409);
    expect(await stockOf(part.id)).toBe(6);
    expect(await historySum(part.id)).toBe(6);
    const low = (await client.get('/api/v1/shop/parts?lowStock=true')).body.data.items;
    expect(low).toEqual([]);
  });
});

describe('purchasing', () => {
  it('receives a purchase in parts, at the price paid, averaging the cost', async () => {
    const { client } = await newShop();
    const part = await addPart(client, { costPrice: 3000, openingStock: 10, reorderLevel: 12, reorderQty: 20 });
    const supplier = (await client.post('/api/v1/shop/suppliers', { name: 'Toyota Distributor' })).body.data;
    await client.patch(`/api/v1/shop/parts/${part.id}`, { supplierId: supplier.id });

    const reorder = (await client.get('/api/v1/shop/reorder')).body.data;
    expect(reorder[0]).toMatchObject({ supplier: { id: supplier.id }, lines: [{ part: { id: part.id }, suggested: 20 }] });

    const po = (await client.post('/api/v1/shop/purchases', { supplierId: supplier.id, items: [{ partId: part.id, quantity: 10, unitCost: 3600 }] })).body.data;
    expect(po).toMatchObject({ status: 'DRAFT', total: 36000 });
    expect((await client.post(`/api/v1/shop/purchases/${po.id}/receive`, { items: [{ itemId: po.items[0].id, quantity: 1 }] })).status).toBe(409);
    await client.post(`/api/v1/shop/purchases/${po.id}/order`);
    // Now on order: the reorder list doesn't ask for it again.
    expect((await client.get('/api/v1/shop/reorder')).body.data[0].lines[0].suggested).toBe(10);

    const half = (await client.post(`/api/v1/shop/purchases/${po.id}/receive`, { items: [{ itemId: po.items[0].id, quantity: 4 }] })).body.data;
    expect(half.status).toBe('PARTLY_RECEIVED');
    const done = (await client.post(`/api/v1/shop/purchases/${po.id}/receive`, { items: [{ itemId: po.items[0].id, quantity: 6 }] })).body.data;
    expect(done.status).toBe('RECEIVED');
    const after = (await client.get(`/api/v1/shop/parts/${part.id}`)).body.data;
    expect(after.stockQty).toBe(20);
    // (10 × 3000 + 10 × 3600) / 20
    expect(after.costPrice).toBe(3300);
    expect(await historySum(part.id)).toBe(20);
  });
});

describe('counter sales', () => {
  it('sells from stock with discount and tax, refuses to oversell, and returns at most what was sold', async () => {
    const { client } = await newShop({ taxRate: 10 });
    const part = await addPart(client, { retailPrice: 5000, openingStock: 3 });

    expect((await client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 5 }], paymentMethod: 'CASH' })).status).toBe(409);
    const sale = (
      await client.post('/api/v1/shop/sales', {
        items: [{ partId: part.id, quantity: 2 }, { description: 'Fitting', quantity: 1, unitPrice: 1000 }],
        discount: 1000,
        paymentMethod: 'CASH',
        tendered: 12000,
        plate: 'CAB-1234',
      })
    ).body.data;
    // (2 × 5000 + 1000 − 1000) + 10% tax
    expect(sale).toMatchObject({ number: 1, subtotal: 11000, discount: 1000, tax: 1000, total: 11000, change: 1000 });
    expect(await stockOf(part.id)).toBe(1);

    const line = sale.items.find((i: { partId: string | null }) => i.partId === part.id);
    const back = await client.post(`/api/v1/shop/sales/${sale.id}/returns`, { items: [{ saleItemId: line.id, quantity: 1 }], refundMethod: 'CASH' });
    expect(back.status).toBe(201);
    // Refund in proportion to what was paid: 5000 × (11000 / 11000).
    expect(back.body.data.refunded).toBe(5000);
    expect(await stockOf(part.id)).toBe(2);
    expect((await client.post(`/api/v1/shop/sales/${sale.id}/returns`, { items: [{ saleItemId: line.id, quantity: 2 }], refundMethod: 'CASH' })).status).toBe(409);
    expect(await historySum(part.id)).toBe(2);

    const report = (await client.get('/api/v1/shop/reports')).body.data;
    expect(report.totals).toMatchObject({ counter: 6000, refunds: 5000, sales: 1 });
  });
});
