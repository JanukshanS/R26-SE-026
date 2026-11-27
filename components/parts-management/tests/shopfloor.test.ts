/**
 * Selling by measure, buying in bigger units and opening packs, kits,
 * exchanges and store credit, return rules, and warranty claims. Worth
 * protecting: units and costs convert exactly; kits move their components;
 * an exchange settles to the cent; credit never goes below zero and comes
 * back on a void; rules hold unless a manager overrides them; and a warranty
 * replacement keeps the original cover.
 */
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/utils/prisma';
import { addPart, newShop } from './helpers';

const stockOf = async (id: string) => (await prisma.part.findUniqueOrThrow({ where: { id } })).stockQty.toNumber();
const costOf = async (id: string) => (await prisma.part.findUniqueOrThrow({ where: { id } })).costPrice.toNumber();

describe('measures, purchase units, packs and kits', () => {
  it('sells by measure only where allowed, and buys oil by the drum', async () => {
    const { client } = await newShop();
    const pads = await addPart(client);
    expect((await client.post('/api/v1/shop/sales', { items: [{ partId: pads.id, quantity: 1.5 }], paymentMethod: 'CASH' })).status).toBe(422);

    const oil = await addPart(client, { name: 'Engine oil 10W-30', sku: 'OIL-L', unit: 'L', fractional: true, quickQtys: [0.5, 1, 4], purchaseUnit: 'drum', purchaseFactor: 208, costPrice: 0, retailPrice: 300, openingStock: 0, reorderLevel: 50, reorderQty: 300, fitments: [], universal: true });
    expect(oil).toMatchObject({ fractional: true, quickQtys: [0.5, 1, 4], purchaseUnit: 'drum', purchaseFactor: 208 });

    const supplier = (await client.post('/api/v1/shop/suppliers', { name: 'Oil Co' })).body.data;
    await client.patch(`/api/v1/shop/parts/${oil.id}`, { supplierId: supplier.id });
    // 300 L wanted is 2 drums of 208.
    const reorder = (await client.get('/api/v1/shop/reorder')).body.data.flatMap((g: { lines: { part: { id: string }; suggested: number }[] }) => g.lines);
    expect(reorder.find((l: { part: { id: string } }) => l.part.id === oil.id).suggested).toBe(2);

    const po = (await client.post('/api/v1/shop/purchases', { supplierId: supplier.id, items: [{ partId: oil.id, quantity: 2, unitCost: 41600 }] })).body.data;
    expect(po.items[0]).toMatchObject({ purchaseUnit: 'drum', unitFactor: 208, quantity: 2, unitCost: 41600 });
    await client.post(`/api/v1/shop/purchases/${po.id}/order`);
    expect((await client.get(`/api/v1/shop/parts/${oil.id}`)).body.data.onOrder).toBe(416);
    await client.post(`/api/v1/shop/purchases/${po.id}/receive`, { items: [{ itemId: po.items[0].id, quantity: 2 }] });
    expect(await stockOf(oil.id)).toBe(416);
    expect(await costOf(oil.id)).toBe(200);

    const sale = (await client.post('/api/v1/shop/sales', { items: [{ partId: oil.id, quantity: 1.5 }], paymentMethod: 'CASH' })).body.data;
    expect(sale.total).toBe(450);
    expect(await stockOf(oil.id)).toBe(414.5);
  });

  it('opens sealed packs into the loose part at the pack cost shared out', async () => {
    const { client } = await newShop();
    const loose = await addPart(client, { name: 'Oil (loose)', sku: 'L-1', unit: 'L', fractional: true, costPrice: 900, openingStock: 4 });
    const bottle = await addPart(client, { name: 'Oil 4 L bottle', sku: 'B-4', costPrice: 4000, openingStock: 3, breaksIntoId: loose.id, breaksIntoQty: 4 });
    expect(bottle.breaksInto).toMatchObject({ id: loose.id, qty: 4 });
    expect((await client.post(`/api/v1/shop/parts/${loose.id}/open`, { quantity: 1 })).status).toBe(422);
    const opened = await client.post(`/api/v1/shop/parts/${bottle.id}/open`, { quantity: 1 });
    expect(opened.status).toBe(200);
    expect(await stockOf(bottle.id)).toBe(2);
    expect(await stockOf(loose.id)).toBe(8);
    // (4 L × 900 + 4 L × 1000) / 8 L
    expect(await costOf(loose.id)).toBe(950);
    expect((await client.post(`/api/v1/shop/parts/${bottle.id}/open`, { quantity: 5 })).status).toBe(409);
  });

  it('sells a kit out of its components, and takes it back into them', async () => {
    const { client } = await newShop();
    const oil = await addPart(client, { name: 'Oil', sku: 'O', unit: 'L', fractional: true, costPrice: 200, retailPrice: 300, openingStock: 20 });
    const filter = await addPart(client, { name: 'Oil filter', sku: 'F', costPrice: 500, retailPrice: 900, openingStock: 5 });
    const kit = await addPart(client, { name: 'Oil change kit', sku: 'KIT', retailPrice: 2000, costPrice: 0, openingStock: 0 });
    const made = (await client.put(`/api/v1/shop/parts/${kit.id}/kit`, { components: [{ partId: oil.id, quantity: 4 }, { partId: filter.id, quantity: 1 }] })).body.data;
    expect(made).toMatchObject({ isKit: true, stockQty: 5, kitComponents: [expect.objectContaining({ partId: oil.id, quantity: 4 }), expect.objectContaining({ partId: filter.id, quantity: 1 })] });
    expect((await client.put(`/api/v1/shop/parts/${oil.id}/kit`, { components: [{ partId: kit.id, quantity: 1 }] })).status).toBe(409);
    expect((await client.post(`/api/v1/shop/parts/${kit.id}/adjust`, { change: 1 })).status).toBe(422);

    const sale = (await client.post('/api/v1/shop/sales', { items: [{ partId: kit.id, quantity: 2 }], paymentMethod: 'CASH' })).body.data;
    expect(await stockOf(oil.id)).toBe(12);
    expect(await stockOf(filter.id)).toBe(3);
    expect((await prisma.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } })).unitCost.toNumber()).toBe(1300);
    expect((await client.get(`/api/v1/shop/parts/${kit.id}`)).body.data.stockQty).toBe(3);

    await client.post(`/api/v1/shop/sales/${sale.id}/returns`, { items: [{ saleItemId: sale.items[0].id, quantity: 1 }], refundMethod: 'CASH' });
    expect(await stockOf(oil.id)).toBe(16);
    expect(await stockOf(filter.id)).toBe(4);
  });
});

describe('exchanges and store credit', () => {
  it('settles an exchange to the cent, keeps the rest as credit, and gives credit back on a void', async () => {
    const { client } = await newShop();
    const a = await addPart(client, { name: 'Pads A', sku: 'A', retailPrice: 5000, openingStock: 5 });
    const b = await addPart(client, { name: 'Pads B', sku: 'B', retailPrice: 6000, openingStock: 5 });
    const c = await addPart(client, { name: 'Pads C', sku: 'C', retailPrice: 3000, openingStock: 5 });
    const sell = async (partId: string) => (await client.post('/api/v1/shop/sales', { items: [{ partId, quantity: 1 }], paymentMethod: 'CASH', customerName: 'Kasun' })).body.data;

    // Dearer: they pay the difference.
    const first = await sell(a.id);
    const due = await client.post(`/api/v1/shop/sales/${first.id}/exchange`, { returnItems: [{ saleItemId: first.items[0].id, quantity: 1 }], items: [{ partId: b.id, quantity: 1 }] });
    expect(due.body.code).toBe('DIFFERENCE_DUE');
    const up = (await client.post(`/api/v1/shop/sales/${first.id}/exchange`, { returnItems: [{ saleItemId: first.items[0].id, quantity: 1 }], items: [{ partId: b.id, quantity: 1 }], paymentMethod: 'CARD' })).body.data;
    expect(up).toMatchObject({ returned: 5000, due: 1000, refunded: 0, credit: { balance: 0, status: 'USED' } });
    expect(up.sale.payments).toEqual([expect.objectContaining({ method: 'VOUCHER', amount: 5000 }), expect.objectContaining({ method: 'CARD', amount: 1000 })]);
    expect(up.sale.exchangeOfId).toBe(first.id);
    expect(await stockOf(a.id)).toBe(5);
    expect(await stockOf(b.id)).toBe(4);

    // Cheaper: the rest stays as store credit...
    const second = await sell(a.id);
    const down = (await client.post(`/api/v1/shop/sales/${second.id}/exchange`, { returnItems: [{ saleItemId: second.items[0].id, quantity: 1 }], items: [{ partId: c.id, quantity: 1 }] })).body.data;
    expect(down).toMatchObject({ returned: 5000, due: 0, credit: { balance: 2000, status: 'ACTIVE', customerName: 'Kasun' } });
    const code = down.credit.code;
    expect((await client.get(`/api/v1/shop/credits/${code.toLowerCase()}`)).body.data.balance).toBe(2000);

    // ...spent later, never past what it holds, and given back if that sale is voided.
    expect((await client.post('/api/v1/shop/sales', { items: [{ partId: b.id, quantity: 1 }], payments: [{ method: 'VOUCHER', amount: 3000, reference: code }, { method: 'CASH', amount: 3000 }] })).status).toBe(409);
    const spent = (await client.post('/api/v1/shop/sales', { items: [{ partId: b.id, quantity: 1 }], payments: [{ method: 'VOUCHER', amount: 2000, reference: code }, { method: 'CASH', amount: 4000 }] })).body.data;
    expect((await client.get(`/api/v1/shop/credits/${code}`)).body.data).toMatchObject({ balance: 0, status: 'USED' });
    await client.post(`/api/v1/shop/sales/${spent.id}/void`, { reason: 'Wrong car' });
    expect((await client.get(`/api/v1/shop/credits/${code}`)).body.data).toMatchObject({ balance: 2000, status: 'ACTIVE' });

    // Or paid out (a manager's call).
    const third = await sell(a.id);
    const cash = (await client.post(`/api/v1/shop/sales/${third.id}/exchange`, { returnItems: [{ saleItemId: third.items[0].id, quantity: 1 }], items: [{ partId: c.id, quantity: 1 }], balanceTo: 'CASH' })).body.data;
    expect(cash).toMatchObject({ refunded: 2000, credit: { balance: 0, status: 'USED' } });

    // A plain return straight to store credit, then cancelled.
    const fourth = await sell(c.id);
    const back = (await client.post(`/api/v1/shop/sales/${fourth.id}/returns`, { items: [{ saleItemId: fourth.items[0].id, quantity: 1 }], refundMethod: 'VOUCHER' })).body.data;
    const credit = (await client.get(`/api/v1/shop/credits?q=Kasun&status=ACTIVE`)).body.data.find((x: { id: string }) => x.id === back.returns[0].storeCreditId);
    expect(credit).toMatchObject({ amount: 3000, balance: 3000 });
    expect((await client.post(`/api/v1/shop/credits/${credit.id}/cancel`, { note: 'Customer took cash instead' })).body.data).toMatchObject({ status: 'CANCELLED', balance: 0 });
  });
});

describe('return rules', () => {
  it('blocks what the rules say no to unless overridden, and keeps restocking fees', async () => {
    const { client } = await newShop();
    const rules = await client.put('/api/v1/shop/return-rules', {
      rules: [{ days: 7 }, { category: 'Electrical', returnable: false, note: 'once fitted' }, { category: 'Oils', feePct: 10 }],
    });
    expect(rules.body.data).toHaveLength(3);
    expect((await client.put('/api/v1/shop/return-rules', { rules: [{ days: 7 }, { days: 9 }] })).status).toBe(422);
    const bulb = await addPart(client, { name: 'Headlamp bulb', sku: 'H4', category: 'Electrical', retailPrice: 1000 });
    const oil = await addPart(client, { name: 'Gear oil', sku: 'GO', category: 'Oils', retailPrice: 2000 });
    const pads = await addPart(client, { category: 'Brakes' });
    const sale = (await client.post('/api/v1/shop/sales', { items: [{ partId: bulb.id, quantity: 1 }, { partId: oil.id, quantity: 1 }, { partId: pads.id, quantity: 1 }], paymentMethod: 'CASH' })).body.data;
    const line = (partId: string) => sale.items.find((i: { partId: string }) => i.partId === partId).id;

    const no = await client.post(`/api/v1/shop/sales/${sale.id}/returns`, { items: [{ saleItemId: line(bulb.id), quantity: 1 }], refundMethod: 'CASH' });
    expect(no.status).toBe(409);
    expect(no.body.code).toBe('RETURN_RULE');
    const yes = (await client.post(`/api/v1/shop/sales/${sale.id}/returns`, { items: [{ saleItemId: line(bulb.id), quantity: 1 }], refundMethod: 'CASH', override: true })).body.data;
    expect(yes.returns[0]).toMatchObject({ overridden: true, total: 1000 });

    const fee = (await client.post(`/api/v1/shop/sales/${sale.id}/returns`, { items: [{ saleItemId: line(oil.id), quantity: 1 }], refundMethod: 'CASH' })).body.data;
    expect(fee.returns[1]).toMatchObject({ total: 1800, fee: 200 });

    await prisma.sale.update({ where: { id: sale.id }, data: { createdAt: new Date(Date.now() - 10 * 86_400_000) } });
    expect((await client.post(`/api/v1/shop/sales/${sale.id}/returns`, { items: [{ saleItemId: line(pads.id), quantity: 1 }], refundMethod: 'CASH' })).body.code).toBe('RETURN_RULE');
  });
});

describe('warranty claims', () => {
  it('replaces pro rata keeping the original cover, and claims the faulty unit back from the supplier', async () => {
    const { client } = await newShop();
    const supplier = (await client.post('/api/v1/shop/suppliers', { name: 'Battery Distributor' })).body.data;
    const battery = await addPart(client, { name: 'Battery 55D23', sku: 'BAT', serialized: true, warrantyMonths: 12, warrantyFreeMonths: 6, costPrice: 18000, retailPrice: 24000, openingStock: 3, supplierId: supplier.id });
    const sale = (await client.post('/api/v1/shop/sales', { items: [{ partId: battery.id, quantity: 1, serialNumbers: ['B-1'] }], paymentMethod: 'CASH', customerName: 'Nimal' })).body.data;
    const nineMonthsAgo = new Date();
    nineMonthsAgo.setUTCMonth(nineMonthsAgo.getUTCMonth() - 9);
    await prisma.sale.update({ where: { id: sale.id }, data: { createdAt: nineMonthsAgo } });

    expect((await client.post('/api/v1/shop/warranty/claims', { serialNumber: 'NOPE', fault: 'x' })).status).toBe(404);
    const claim = (await client.post('/api/v1/shop/warranty/claims', { serialNumber: 'b-1', fault: 'Dead cell, won’t hold charge' })).body.data;
    // 9 of 12 months used, past the 6 free: 24000 × 9 / 12.
    expect(claim).toMatchObject({ number: 1, status: 'OPEN', covered: true, suggestedCharge: 18000, customerName: 'Nimal', part: { id: battery.id } });
    expect((await client.post('/api/v1/shop/warranty/claims', { serialNumber: 'B-1', fault: 'again' })).status).toBe(409);
    expect((await client.post(`/api/v1/shop/warranty/claims/${claim.id}/resolve`, { outcome: 'REPLACE', serialNumber: 'B-2' })).status).toBe(422);

    const done = (await client.post(`/api/v1/shop/warranty/claims/${claim.id}/resolve`, { outcome: 'REPLACE', serialNumber: 'B-2', paymentMethod: 'CASH' })).body.data;
    expect(done).toMatchObject({ status: 'REPLACED', charged: 18000 });
    const replacement = (await client.get(`/api/v1/shop/sales/${done.replacementSaleId}`)).body.data;
    expect(replacement.items[0]).toMatchObject({ serialNumber: 'B-2', unitPrice: 18000 });
    expect(replacement.items[0].warrantyUntil).toBe(sale.items[0].warrantyUntil);
    expect(await stockOf(battery.id)).toBe(1);
    const reasons = (await client.get(`/api/v1/shop/parts/${battery.id}`)).body.data.movements.map((m: { reason: string }) => m.reason);
    expect(reasons[0]).toBe('WARRANTY');

    const sent = (await client.post(`/api/v1/shop/warranty/claims/${claim.id}/supplier`, { action: 'SEND' })).body.data;
    expect(sent.supplier).toMatchObject({ id: supplier.id, status: 'PENDING' });
    expect((await client.get('/api/v1/shop/warranty/claims?supplier=PENDING')).body.data).toHaveLength(1);
    const credited = (await client.post(`/api/v1/shop/warranty/claims/${claim.id}/supplier`, { action: 'CREDITED' })).body.data;
    expect(credited.supplier).toMatchObject({ status: 'CREDITED', credit: 18000 });
    expect((await client.get(`/api/v1/shop/suppliers/${supplier.id}/statement`)).body.data.balance).toBe(-18000);

    // Rejecting needs a reason.
    const other = (await client.post('/api/v1/shop/sales', { items: [{ partId: battery.id, quantity: 1, serialNumbers: ['B-3'] }], paymentMethod: 'CASH' })).body.data;
    const c2 = (await client.post('/api/v1/shop/warranty/claims', { saleItemId: other.items[0].id, fault: 'Cracked case' })).body.data;
    expect((await client.post(`/api/v1/shop/warranty/claims/${c2.id}/resolve`, { outcome: 'REJECT' })).status).toBe(422);
    expect((await client.post(`/api/v1/shop/warranty/claims/${c2.id}/resolve`, { outcome: 'REJECT', note: 'Physical damage' })).body.data.status).toBe('REJECTED');
  });
});
