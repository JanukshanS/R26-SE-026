/**
 * The counter: pricing (line and sale discounts, VAT per part, core
 * deposits), tax invoices, serial numbers and warranty, sales on account,
 * voids, and held sales and quotations.
 */
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/utils/prisma';
import { addPart, newShop } from './helpers';

const stockOf = async (id: string) => (await prisma.part.findUniqueOrThrow({ where: { id } })).stockQty.toNumber();
const historySum = async (id: string) =>
  (await prisma.stockMovement.aggregate({ where: { partId: id }, _sum: { quantityChange: true } }))._sum.quantityChange?.toNumber() ?? 0;

describe('pricing', () => {
  it('discounts by line and by sale, charges VAT per part, and adds core deposits', async () => {
    const { client } = await newShop({ taxRate: 18 });
    const battery = await addPart(client, { name: 'Battery 55D23', retailPrice: 20000, coreCharge: 2000, openingStock: 5 });
    const manual = await addPart(client, { name: 'Manual', retailPrice: 1000, taxRate: 0, openingStock: 5 });

    const sale = (
      await client.post('/api/v1/shop/sales', {
        items: [{ partId: battery.id, quantity: 1, discount: 1000 }, { partId: manual.id, quantity: 2 }],
        discount: 1000,
        paymentMethod: 'CARD',
      })
    ).body.data;
    // The 1000 off the sale is spread by value: 904.76 on the battery, 95.24 on the manuals (VAT exempt).
    // VAT: (19000 − 904.76) × 18% = 3257.14. The core deposit is neither discounted nor taxed.
    expect(sale).toMatchObject({ subtotal: 24000, discount: 2000, tax: 3257.14, total: 25257.14 });
    expect(sale.items.map((i: { kind: string }) => i.kind)).toEqual(['PART', 'CORE', 'PART']);
    expect(sale.items[1]).toMatchObject({ description: 'Core deposit: Battery 55D23', unitPrice: 2000, tax: 0 });

    // The old battery comes back: the deposit is refunded.
    const back = (await client.post(`/api/v1/shop/sales/${sale.id}/returns`, { items: [{ saleItemId: sale.items[1].id, quantity: 1, restock: false }], refundMethod: 'CARD' })).body.data;
    expect(back.refunded).toBe(2000);
    expect(await stockOf(battery.id)).toBe(4);

    // Brought the old one in already: no deposit.
    const exchanged = (await client.post('/api/v1/shop/sales', { items: [{ partId: battery.id, quantity: 1, coreReturned: true }], paymentMethod: 'CASH' })).body.data;
    expect(exchanged.items).toHaveLength(1);
    expect(exchanged.total).toBe(23600);
  });

  it('issues a VAT tax invoice only with the shop VAT number and the buyer name', async () => {
    const { client } = await newShop({ taxRate: 18 });
    const part = await addPart(client, { retailPrice: 1000, openingStock: 5 });
    const invoice = (extra: object) => client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 1 }], paymentMethod: 'CASH', taxInvoice: true, ...extra });
    expect((await invoice({ customerName: 'ABC Transport (Pvt) Ltd' })).status).toBe(409);
    await client.put('/api/v1/shop', { vatNumber: '114567890-7000' });
    expect((await invoice({})).status).toBe(422);
    const ok = await invoice({ customerName: 'ABC Transport (Pvt) Ltd', customerVatNo: '409876543-7000', customerAddress: '1 Main St, Kandy' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ taxInvoice: true, customerVatNo: '409876543-7000', tax: 180, total: 1180 });
  });

  it('takes a serial number per unit, never sells one twice, and finds the warranty', async () => {
    const { client } = await newShop();
    const alt = await addPart(client, { name: 'Alternator', retailPrice: 30000, serialized: true, warrantyMonths: 12, openingStock: 3 });

    const missing = await client.post('/api/v1/shop/sales', { items: [{ partId: alt.id, quantity: 2 }], paymentMethod: 'CASH' });
    expect(missing.body.code).toBe('SERIALS_REQUIRED');
    const sale = (await client.post('/api/v1/shop/sales', { items: [{ partId: alt.id, quantity: 2, serialNumbers: ['al-001', 'AL-002'] }], paymentMethod: 'CASH' })).body.data;
    expect(sale.items.map((i: { serialNumber: string }) => i.serialNumber)).toEqual(['AL-001', 'AL-002']);
    const until = new Date(sale.items[0].warrantyUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(360 * 86_400_000);
    expect((await client.post('/api/v1/shop/sales', { items: [{ partId: alt.id, quantity: 1, serialNumbers: ['AL-002'] }], paymentMethod: 'CASH' })).status).toBe(409);
    expect(await stockOf(alt.id)).toBe(1);

    const bySerial = (await client.get('/api/v1/shop/warranty?q=al-002')).body.data;
    expect(bySerial).toHaveLength(1);
    expect(bySerial[0]).toMatchObject({ covered: true, sale: { number: sale.number }, item: { serialNumber: 'AL-002' } });
    expect((await client.get(`/api/v1/shop/warranty?q=${sale.number}`)).body.data).toHaveLength(2);
  });
});

describe('accounts at the counter', () => {
  it('sells on account within the credit limit, and credits returns back to it', async () => {
    const { client } = await newShop();
    const part = await addPart(client, { retailPrice: 1000, openingStock: 20 });
    const acct = (await client.post('/api/v1/shop/accounts', { name: 'Ceylon Fleet', phone: '0112345678', creditLimit: 3000, paymentDays: 30 })).body.data;
    expect(acct).toMatchObject({ kind: 'CUSTOMER', name: 'Ceylon Fleet', garage: null, balance: 0 });

    const onAccount = (qty: number) => client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: qty }], paymentMethod: 'ACCOUNT', accountId: acct.id });
    expect((await client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 1 }], paymentMethod: 'ACCOUNT' })).status).toBe(422);
    const first = await onAccount(2);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ account: { name: 'Ceylon Fleet' }, customerName: 'Ceylon Fleet', paymentMethod: 'ACCOUNT' });
    // 2000 owed + 2000 more is over the 3000 limit.
    expect((await onAccount(2)).status).toBe(409);
    // Part on account, part cash.
    const split = await client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 2 }], accountId: acct.id, payments: [{ method: 'ACCOUNT', amount: 1000 }, { method: 'CASH', amount: 1000 }] });
    expect(split.status).toBe(201);

    // One unit back, credited to the account.
    await client.post(`/api/v1/shop/sales/${first.body.data.id}/returns`, { items: [{ saleItemId: first.body.data.items[0].id, quantity: 1 }], refundMethod: 'ACCOUNT' });
    const detail = (await client.get(`/api/v1/shop/accounts/${acct.id}`)).body.data;
    expect(detail.balance).toBe(2000);
    expect(detail.entries[0]).toMatchObject({ kind: 'ADJUSTMENT', amount: -1000, sale: { number: first.body.data.number } });
    expect(detail.ageing).toMatchObject({ current: 2000, overdue: 0 });

    await client.post(`/api/v1/shop/accounts/${acct.id}/payments`, { amount: 2000, method: 'BANK_TRANSFER', reference: 'TT-1' });
    expect((await client.get(`/api/v1/shop/accounts/${acct.id}`)).body.data.balance).toBe(0);
    expect((await client.get(`/api/v1/shop/sales?accountId=${acct.id}`)).body.data).toHaveLength(2);
    // A garage's name comes from Kaduna; a customer's can be changed.
    expect((await client.patch(`/api/v1/shop/accounts/${acct.id}`, { name: 'Ceylon Fleet Services' })).body.data.name).toBe('Ceylon Fleet Services');
  });
});

describe('voids', () => {
  it('takes a whole sale back (stock, account charge), but not once items came back', async () => {
    const { client } = await newShop();
    const part = await addPart(client, { retailPrice: 1000, openingStock: 5 });
    const acct = (await client.post('/api/v1/shop/accounts', { name: 'Regular', creditLimit: 10000 })).body.data;
    const sale = (await client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 2 }], paymentMethod: 'ACCOUNT', accountId: acct.id })).body.data;
    expect(await stockOf(part.id)).toBe(3);

    const voided = await client.post(`/api/v1/shop/sales/${sale.id}/void`, { reason: 'Rang up twice' });
    expect(voided.body.data.voided).toMatchObject({ reason: 'Rang up twice' });
    expect(await stockOf(part.id)).toBe(5);
    expect(await historySum(part.id)).toBe(5);
    expect((await client.get(`/api/v1/shop/accounts/${acct.id}`)).body.data.balance).toBe(0);
    expect((await client.post(`/api/v1/shop/sales/${sale.id}/void`, { reason: 'again' })).status).toBe(409);

    const kept = (await client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 1 }], paymentMethod: 'CASH' })).body.data;
    await client.post(`/api/v1/shop/sales/${kept.id}/returns`, { items: [{ saleItemId: kept.items[0].id, quantity: 1 }], refundMethod: 'CASH' });
    expect((await client.post(`/api/v1/shop/sales/${kept.id}/void`, { reason: 'x' })).status).toBe(409);

    // Reports leave voided sales out.
    expect((await client.get('/api/v1/shop/reports')).body.data.totals).toMatchObject({ sales: 1, voided: 1 });
  });
});

describe('held sales and quotations', () => {
  it('holds a sale and writes a numbered quote without touching stock, then completes it once', async () => {
    const { client } = await newShop({ taxRate: 10 });
    const part = await addPart(client, { retailPrice: 1000, openingStock: 5 });
    const held = (await client.post('/api/v1/shop/drafts', { kind: 'HELD', items: [{ partId: part.id, quantity: 2 }], customerName: 'Waiting customer' })).body.data;
    expect(held).toMatchObject({ kind: 'HELD', number: null, status: 'OPEN', total: 2200 });
    expect(await stockOf(part.id)).toBe(5);

    const quote = (await client.post('/api/v1/shop/drafts', { kind: 'QUOTE', items: [{ partId: part.id, quantity: 1 }, { description: 'Fitting', quantity: 1, unitPrice: 500 }], validDays: 7 })).body.data;
    expect(quote).toMatchObject({ kind: 'QUOTE', number: 1, subtotal: 1500, tax: 150, total: 1650 });
    expect(quote.lines).toHaveLength(2);
    expect(new Date(quote.validUntil).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect((await client.get('/api/v1/shop/drafts?kind=QUOTE')).body.data).toHaveLength(1);

    const sale = await client.post('/api/v1/shop/sales', { items: held.items, paymentMethod: 'CASH', draftId: held.id });
    expect(sale.status).toBe(201);
    expect((await client.get(`/api/v1/shop/drafts/${held.id}`)).body.data).toMatchObject({ status: 'CONVERTED', saleId: sale.body.data.id });
    expect((await client.post('/api/v1/shop/sales', { items: held.items, paymentMethod: 'CASH', draftId: held.id })).status).toBe(409);
    expect((await client.post(`/api/v1/shop/drafts/${quote.id}/cancel`)).body.data.status).toBe('CANCELLED');
    expect((await client.get('/api/v1/shop/drafts')).body.data).toHaveLength(0);
  });
});
