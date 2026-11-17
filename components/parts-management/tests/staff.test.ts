/**
 * Staff, roles and approvals, the activity log, and cash drawers. Worth
 * protecting: each role can do its job and nothing more; a cashier can't give
 * a big discount, void or refund without a manager's PIN; everything is on
 * the record with who did it; and a drawer's expected cash adds up.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { addPart, as, newShop } from './helpers';

/** A signed-in person with an email (their token's claims). */
const person = (name: string) => {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.lk`;
  return { email, client: as(`u-${randomUUID()}`, { email, name }) };
};

async function hire(owner: ReturnType<typeof as>, name: string, role: 'MANAGER' | 'CASHIER' | 'STOREKEEPER') {
  const p = person(name);
  const res = await owner.post('/api/v1/shop/staff', { email: p.email, name, role });
  if (res.status !== 201) throw new Error(`hire failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...p, id: res.body.data.id as string };
}

describe('staff and roles', () => {
  it('lets the owner add staff by email, who then get in with their role and nothing more', async () => {
    const { client: owner, shop } = await newShop();
    const nimal = person('Nimal');
    expect((await nimal.client.get('/api/v1/shop/parts')).status).toBe(404);

    const added = await owner.post('/api/v1/shop/staff', { email: nimal.email.toUpperCase(), name: 'Nimal', role: 'CASHIER' });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ email: nimal.email, role: 'CASHIER', joined: false });
    expect((await owner.post('/api/v1/shop/staff', { email: nimal.email, name: 'Again', role: 'MANAGER' })).status).toBe(409);

    // Signing in with that email is enough.
    const me = (await nimal.client.get('/api/v1/me')).body.data;
    expect(me).toMatchObject({ shop: { id: shop.id }, role: 'CASHIER', name: 'Nimal', hasPin: false });
    expect(me.permissions).toEqual(['sell', 'payments', 'orders']);
    expect((await owner.get('/api/v1/shop/staff')).body.data[0]).toMatchObject({ name: 'Nimal', joined: true });

    // A cashier sells and sees prices, but not costs, stock changes, reports, staff or settings.
    const part = await addPart(owner);
    const seen = (await nimal.client.get(`/api/v1/shop/parts/${part.id}`)).body.data;
    expect(seen).toMatchObject({ retailPrice: 5000, costPrice: null });
    expect((await nimal.client.post(`/api/v1/shop/parts/${part.id}/adjust`, { change: -1 })).body.code).toBe('FORBIDDEN');
    expect((await nimal.client.get('/api/v1/shop/reports')).status).toBe(403);
    expect((await nimal.client.get('/api/v1/shop/staff')).status).toBe(403);
    expect((await nimal.client.put('/api/v1/shop', { name: 'Mine now' })).status).toBe(403);
    const sale = await nimal.client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 1 }], paymentMethod: 'CARD' });
    expect(sale.status).toBe(201);
    expect(sale.body.data.cashierName).toBe('Nimal');

    // A storekeeper looks after stock, and doesn't sell.
    const kumari = await hire(owner, 'Kumari', 'STOREKEEPER');
    expect((await kumari.client.post(`/api/v1/shop/parts/${part.id}/adjust`, { change: 2 })).status).toBe(200);
    expect((await kumari.client.get(`/api/v1/shop/parts/${part.id}`)).body.data.costPrice).toBe(3000);
    expect((await kumari.client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 1 }], paymentMethod: 'CASH' })).status).toBe(403);
    const history = (await owner.get(`/api/v1/shop/parts/${part.id}`)).body.data.movements;
    expect(history[0]).toMatchObject({ reason: 'ADJUSTMENT', quantityChange: 2, byName: 'Kumari' });

    // Taking access away.
    await owner.patch(`/api/v1/shop/staff/${added.body.data.id}`, { active: false });
    expect((await nimal.client.get('/api/v1/shop/parts')).status).toBe(404);
  });

  it("needs a manager's PIN for a big discount, a void or a refund, and logs who approved it", async () => {
    const { client: owner } = await newShop({ maxDiscountPct: 10 });
    const part = await addPart(owner, { retailPrice: 1000, openingStock: 10 });
    const ruwan = await hire(owner, 'Ruwan', 'CASHIER');
    const dilini = await hire(owner, 'Dilini', 'MANAGER');
    expect((await dilini.client.put('/api/v1/shop/pin', { pin: '4321' })).status).toBe(200);
    expect((await dilini.client.put('/api/v1/shop/pin', { pin: '12' })).status).toBe(422);

    // 5% off: within the cashier's limit.
    const small = await ruwan.client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 1, discount: 50 }], paymentMethod: 'CASH' });
    expect(small.status).toBe(201);

    // 20% off (a lower price): needs a manager.
    const big = { items: [{ partId: part.id, quantity: 1, unitPrice: 800 }], paymentMethod: 'CASH' };
    const refused = await ruwan.client.post('/api/v1/shop/sales', big);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('APPROVAL_REQUIRED');
    expect((await ruwan.client.post('/api/v1/shop/sales', { ...big, approvalPin: '0000' })).body.code).toBe('APPROVAL_REQUIRED');
    const approved = await ruwan.client.post('/api/v1/shop/sales', { ...big, approvalPin: '4321' });
    expect(approved.status).toBe(201);
    expect(approved.body.data).toMatchObject({ total: 800, cashierName: 'Ruwan', approvedByName: 'Dilini' });
    // A manager gives it on their own.
    expect((await dilini.client.post('/api/v1/shop/sales', big)).body.data.approvedByName).toBeNull();

    // Voids and refunds the same way.
    const saleId = small.body.data.id;
    expect((await ruwan.client.post(`/api/v1/shop/sales/${saleId}/void`, { reason: 'Wrong part' })).body.code).toBe('APPROVAL_REQUIRED');
    const voided = await ruwan.client.post(`/api/v1/shop/sales/${saleId}/void`, { reason: 'Wrong part', approvalPin: '4321' });
    expect(voided.body.data.voided).toMatchObject({ by: 'Ruwan (approved by Dilini)', reason: 'Wrong part' });
    const line = approved.body.data.items[0].id;
    expect((await ruwan.client.post(`/api/v1/shop/sales/${approved.body.data.id}/returns`, { items: [{ saleItemId: line, quantity: 1 }], refundMethod: 'CASH' })).body.code).toBe('APPROVAL_REQUIRED');
    const returned = await ruwan.client.post(`/api/v1/shop/sales/${approved.body.data.id}/returns`, { items: [{ saleItemId: line, quantity: 1 }], refundMethod: 'CASH', approvalPin: '4321' });
    expect(returned.body.data.returns[0]).toMatchObject({ total: 800, byName: 'Ruwan', approvedByName: 'Dilini' });

    // All of it on the record.
    const log = (await owner.get('/api/v1/shop/audit')).body.data as { action: string; actorName: string; summary: string }[];
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['sale', 'sale.void', 'sale.return', 'staff.add', 'staff.pin']));
    expect(log.find((e) => e.action === 'sale.void')).toMatchObject({ actorName: 'Ruwan' });
    expect(log.find((e) => e.action === 'sale.void')!.summary).toContain('approved by Dilini');
    expect((await owner.get('/api/v1/shop/audit?action=sale.void')).body.data).toHaveLength(1);
    expect((await dilini.client.get('/api/v1/shop/audit')).status).toBe(200);
    expect((await ruwan.client.get('/api/v1/shop/audit')).status).toBe(403);
  });
});

describe('cash drawer', () => {
  it('works out what should be in the drawer and records the over or short', async () => {
    const { client: owner } = await newShop({ requireCashSession: true });
    const part = await addPart(owner, { retailPrice: 1000, openingStock: 20 });
    const saman = await hire(owner, 'Saman', 'CASHIER');
    const sell = (body: object) => saman.client.post('/api/v1/shop/sales', body);

    // No cash without an open drawer; card is fine.
    const closed = await sell({ items: [{ partId: part.id, quantity: 1 }], paymentMethod: 'CASH' });
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('DRAWER_CLOSED');
    expect((await sell({ items: [{ partId: part.id, quantity: 1 }], paymentMethod: 'CARD' })).status).toBe(201);

    const open = await saman.client.post('/api/v1/shop/cash/sessions', { openingFloat: 5000 });
    expect(open.status).toBe(201);
    expect((await saman.client.post('/api/v1/shop/cash/sessions', { openingFloat: 1 })).status).toBe(409);
    const id = open.body.data.id;

    // Split: part cash, part card. The change is on the cash part.
    const split = await sell({ items: [{ partId: part.id, quantity: 2 }], payments: [{ method: 'CASH', amount: 1500 }, { method: 'CARD', amount: 500, reference: 'SLIP-9' }], tendered: 2000 });
    expect(split.status).toBe(201);
    expect(split.body.data).toMatchObject({ paymentMethod: 'SPLIT', change: 500, payments: [{ method: 'CASH', amount: 1500 }, { method: 'CARD', amount: 500, reference: 'SLIP-9' }] });
    expect((await sell({ items: [{ partId: part.id, quantity: 1 }], payments: [{ method: 'CASH', amount: 900 }] })).status).toBe(422);

    // Petty cash out is for the owner or a manager.
    expect((await saman.client.post(`/api/v1/shop/cash/sessions/${id}/movements`, { kind: 'PAY_OUT', amount: 200, reason: 'Tea' })).status).toBe(403);
    expect((await owner.post(`/api/v1/shop/cash/sessions/${id}/movements`, { kind: 'PAY_OUT', amount: 200, reason: 'Tea' })).status).toBe(201);

    const now = (await saman.client.get('/api/v1/shop/cash/current')).body.data;
    // 5000 float + 1500 cash sales − 200 paid out
    expect(now).toMatchObject({ status: 'OPEN', expectedCash: 6300 });
    expect(now.summary).toMatchObject({ openingFloat: 5000, cashSales: 1500, payOuts: 200, sales: 1 });
    expect(now.summary.byMethod).toEqual(expect.arrayContaining([{ method: 'CASH', total: 1500 }, { method: 'CARD', total: 500 }]));

    const done = (await saman.client.post(`/api/v1/shop/cash/sessions/${id}/close`, { countedCash: 6200 })).body.data;
    expect(done).toMatchObject({ status: 'CLOSED', expectedCash: 6300, countedCash: 6200, difference: -100 });
    expect((await saman.client.get('/api/v1/shop/cash/current')).body.data).toBeNull();
    expect((await saman.client.post(`/api/v1/shop/cash/sessions/${id}/close`, { countedCash: 1 })).status).toBe(409);

    // Each person sees their own drawers; the owner sees all.
    const other = await hire(owner, 'Other', 'CASHIER');
    expect((await other.client.get(`/api/v1/shop/cash/sessions/${id}`)).status).toBe(403);
    expect((await other.client.get('/api/v1/shop/cash/sessions')).body.data).toHaveLength(0);
    expect((await owner.get('/api/v1/shop/cash/sessions')).body.data).toHaveLength(1);
    const log = (await owner.get('/api/v1/shop/audit?action=cash')).body.data.map((e: { summary: string }) => e.summary);
    expect(log[0]).toContain('100.00 short');
  });
});
