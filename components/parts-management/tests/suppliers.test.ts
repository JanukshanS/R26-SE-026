/**
 * What the shop owes its suppliers (landed cost, bills, payments, returns,
 * ageing), and the reports built on top: VAT by rate, cashiers, stock value
 * and dead stock.
 */
import { describe, expect, it } from 'vitest';

import { addDays, localDay } from '../src/services/shared';
import { prisma } from '../src/utils/prisma';
import { addPart, newShop } from './helpers';

const stockOf = async (id: string) => (await prisma.part.findUniqueOrThrow({ where: { id } })).stockQty.toNumber();

describe('suppliers', () => {
  it('puts freight and duty into the cost, records the bill, and ages what is owed', async () => {
    const { client } = await newShop();
    const supplier = (await client.post('/api/v1/shop/suppliers', { name: 'Japan Imports', paymentDays: 30 })).body.data;
    const a = await addPart(client, { costPrice: 1000, openingStock: 0 });
    const b = await addPart(client, { costPrice: 3000, openingStock: 0 });
    const po = (await client.post('/api/v1/shop/purchases', { supplierId: supplier.id, items: [{ partId: a.id, quantity: 10, unitCost: 1000 }, { partId: b.id, quantity: 10, unitCost: 3000 }] })).body.data;
    await client.post(`/api/v1/shop/purchases/${po.id}/order`);

    // Billed 45 days ago, so due 15 days ago.
    const billDate = addDays(localDay(new Date()), -45);
    const got = await client.post(`/api/v1/shop/purchases/${po.id}/receive`, {
      items: po.items.map((i: { id: string }) => ({ itemId: i.id, quantity: 10 })),
      extraCosts: 4000,
      bill: { reference: 'INV-77', billDate },
    });
    expect(got.status).toBe(200);
    // 4000 spread by value (10000 : 30000): +100 and +300 a unit.
    expect((await client.get(`/api/v1/shop/parts/${a.id}`)).body.data.costPrice).toBe(1100);
    expect((await client.get(`/api/v1/shop/parts/${b.id}`)).body.data.costPrice).toBe(3300);

    const st = (await client.get(`/api/v1/shop/suppliers/${supplier.id}/statement`)).body.data;
    expect(st).toMatchObject({ balance: 44000, ageing: { current: 0, d1_30: 44000, overdue: 44000 } });
    expect(st.entries[0]).toMatchObject({ kind: 'BILL', reference: 'INV-77', purchase: { number: po.number } });
    expect((await client.post(`/api/v1/shop/suppliers/${supplier.id}/bills`, { reference: 'INV-77', amount: 5 })).status).toBe(409);

    await client.post(`/api/v1/shop/suppliers/${supplier.id}/payments`, { amount: 30000, method: 'BANK_TRANSFER', reference: 'TT-88' });
    const ret = await client.post('/api/v1/shop/supplier-returns', { supplierId: supplier.id, purchaseId: po.id, items: [{ partId: b.id, quantity: 2 }], reason: 'Wrong size' });
    expect(ret.status).toBe(201);
    expect(ret.body.data).toMatchObject({ number: 1, total: 6600, supplier: { name: 'Japan Imports' } });
    expect(await stockOf(b.id)).toBe(8);

    const after = (await client.get(`/api/v1/shop/suppliers/${supplier.id}/statement`)).body.data;
    expect(after.balance).toBe(7400);
    expect(after.entries.map((e: { kind: string }) => e.kind)).toEqual(['RETURN', 'PAYMENT', 'BILL']);

    // A new bill, not due yet.
    await client.post(`/api/v1/shop/suppliers/${supplier.id}/bills`, { reference: 'INV-78', amount: 1000 });
    expect((await client.get('/api/v1/shop/payables')).body.data[0]).toMatchObject({ balance: 8400, ageing: { current: 1000, d1_30: 7400 } });
    expect((await client.get('/api/v1/shop/suppliers')).body.data[0].balance).toBe(8400);
    expect((await client.get('/api/v1/shop/reports/ageing')).body.data.payables[0]).toMatchObject({ name: 'Japan Imports', balance: 8400, overdue: 7400 });
    expect((await client.get('/api/v1/shop/dashboard')).body.data.suppliers).toMatchObject({ payable: 8400, overdue: 7400 });
  });
});

describe('reports', () => {
  it('splits VAT by rate, totals each cashier, values stock by category and finds dead stock', async () => {
    const { client } = await newShop({ taxRate: 18 });
    const pads = await addPart(client, { category: 'Brakes', costPrice: 3000, retailPrice: 5000, openingStock: 10 });
    const manual = await addPart(client, { category: 'Books', costPrice: 500, retailPrice: 1000, taxRate: 0, openingStock: 4 });
    await client.post('/api/v1/shop/sales', { items: [{ partId: pads.id, quantity: 1 }, { partId: manual.id, quantity: 1 }], paymentMethod: 'CASH' });

    const rep = (await client.get('/api/v1/shop/reports')).body.data;
    expect(rep.vat).toEqual([{ rate: 18, taxable: 5000, tax: 900 }, { rate: 0, taxable: 1000, tax: 0 }]);
    expect(rep.totals).toMatchObject({ tax: 900, revenue: 6900 });
    expect(rep.cashiers).toEqual([{ name: 'Owner', sales: 1, total: 6900, discounts: 0, voids: 0, refunds: 0 }]);

    const stock = (await client.get('/api/v1/shop/reports/stock?deadDays=7')).body.data;
    expect(stock.categories.map((c: { category: string }) => c.category)).toEqual(['Brakes', 'Books']);
    expect(stock.totals).toMatchObject({ cost: 28500, retail: 48000, deadLines: 0 });

    // A part bought a month ago that has never sold.
    const drum = await addPart(client, { name: 'Old drum', category: 'Brakes', costPrice: 100, openingStock: 2 });
    await prisma.part.update({ where: { id: drum.id }, data: { createdAt: new Date(Date.now() - 30 * 86_400_000) } });
    const dead = (await client.get('/api/v1/shop/reports/stock?deadDays=7')).body.data;
    expect(dead.dead).toEqual([expect.objectContaining({ partId: drum.id, stockQty: 2, value: 200, lastSoldAt: null })]);
  });
});
