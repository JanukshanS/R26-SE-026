/**
 * Trade with garages. The things worth protecting: garages only order from
 * shops they added, trade prices and credit terms are applied, parts only
 * change hands against the receiving side's code (which the shop never
 * sees), stock and the account ledger move at handover, the parts reach the
 * garage's job even if that service was briefly down, and only the right
 * people see a pickup.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { setVehicleLookup } from '../src/services/kadunaVehicles';
import { retryJobSyncs } from '../src/services/orders';
import { prisma } from '../src/utils/prisma';
import { addPart, as, garageServiceDown, newGarage, newShop, owners } from './helpers';

afterEach(() => {
  setVehicleLookup(null);
  garageServiceDown(false);
});

async function linked() {
  const g = newGarage();
  const s = await newShop();
  const part = await addPart(s.client);
  expect((await g.owner.put(`/api/v1/garage/shops/${s.shop.id}/link`)).status).toBe(200);
  const accountId = (await s.client.get('/api/v1/shop/accounts')).body.data[0].id;
  return { ...g, ...s, part, accountId };
}

const catalogueOrder = (shopId: string, jobId: string, partId: string, extra: Record<string, unknown> = {}) => ({
  shopId,
  jobCardId: jobId,
  fulfilment: 'DELIVERY',
  items: [{ partId, quantity: 2 }],
  ...extra,
});

describe('finding shops and the catalogue', () => {
  it('only takes orders for shops the garage added, and lists what fits the job at trade price', async () => {
    const g = newGarage();
    const s = await newShop({ name: `Matara Motors ${Date.now()}`, city: 'Matara' });
    const pads = await addPart(s.client);
    await addPart(s.client, { name: 'Vitz pads', sku: 'VZ-9', fitments: [{ make: 'Toyota', model: 'Vitz' }] });
    await addPart(s.client, { name: 'Hidden', sku: 'HID-1', listed: false, universal: true, fitments: [] });

    expect((await g.owner.post('/api/v1/garage/orders', catalogueOrder(s.shop.id, g.job.id, pads.id))).status).toBe(409);
    const found = (await g.owner.get('/api/v1/garage/shops?q=matara')).body.data;
    expect(found).toEqual([expect.objectContaining({ id: s.shop.id, account: null })]);

    await g.owner.put(`/api/v1/garage/shops/${s.shop.id}/link`);
    const cat = (await g.owner.get(`/api/v1/garage/shops/${s.shop.id}/catalogue?jobCardId=${g.job.id}`)).body.data;
    expect(cat.vehicle).toMatchObject({ make: 'Toyota', model: 'Aqua', year: 2015 });
    expect(cat.parts).toEqual([expect.objectContaining({ id: pads.id, price: 4500, stockQty: 10 })]);
    expect(cat.parts[0].costPrice).toBeUndefined();

    // Mechanics can look but not order.
    expect((await g.mechanicClient.get(`/api/v1/garage/shops/${s.shop.id}/catalogue`)).status).toBe(200);
    expect((await g.mechanicClient.post('/api/v1/garage/orders', catalogueOrder(s.shop.id, g.job.id, pads.id))).status).toBe(403);
    // Someone with no garage can't use the garage side at all.
    expect((await as('nobody').get('/api/v1/garage/shops')).status).toBe(403);
  });
});

describe('ordering, handover and payment', () => {
  it('pays on handover without credit: confirmed at once, completed only with the code and a payment method', async () => {
    const t = await linked();
    const placed = await t.owner.post('/api/v1/garage/orders', catalogueOrder(t.shop.id, t.job.id, t.part.id));
    expect(placed.status).toBe(201);
    expect(placed.body.data).toMatchObject({ status: 'REQUESTED', deliveryAddress: '5 Galle Rd, Colombo', total: 9000, job: { number: 7 } });
    const code = placed.body.data.handoverCode;
    expect(t.garage.notes.at(-1)).toContain('Parts ordered');

    const inbox = (await t.client.get('/api/v1/shop/orders?open=true')).body.data;
    expect(inbox[0].handoverCode).toBeUndefined();
    expect(inbox[0].job).toMatchObject({ number: 7, vehicle: { plate: 'WP-CAB-1234', model: 'Aqua' } });

    const confirmed = (await t.client.post(`/api/v1/shop/orders/${inbox[0].id}/quote`, { items: [{ id: inbox[0].items[0].id, unitPrice: 4500 }] })).body.data;
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', paymentTerms: 'ON_HANDOVER' });

    const id = inbox[0].id;
    expect((await t.client.post(`/api/v1/shop/orders/${id}/complete`, { code: code === '000000' ? '111111' : '000000', paymentMethod: 'CASH' })).status).toBe(403);
    expect((await t.client.post(`/api/v1/shop/orders/${id}/complete`, { code })).status).toBe(422);
    const done = (await t.client.post(`/api/v1/shop/orders/${id}/complete`, { code, paymentMethod: 'CASH' })).body.data;
    expect(done).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CASH' });

    expect((await prisma.part.findUniqueOrThrow({ where: { id: t.part.id } })).stockQty.toNumber()).toBe(8);
    expect(t.garage.parts).toEqual([expect.objectContaining({ jobId: t.job.id, lines: [expect.objectContaining({ quantity: 2, unitPrice: 4500 })] })]);
    expect((await t.owner.get(`/api/v1/garage/orders/${id}`)).body.data.addedToJob).toBe(true);
    // Nothing on the account.
    expect((await t.client.get(`/api/v1/shop/accounts/${t.accountId}`)).body.data.balance).toBe(0);
  });

  it('puts orders on account within the credit limit, and the ledger tracks what is owed', async () => {
    const t = await linked();
    await t.client.patch(`/api/v1/shop/accounts/${t.accountId}`, { creditLimit: 10000, paymentDays: 30 });

    const first = (await t.owner.post('/api/v1/garage/orders', catalogueOrder(t.shop.id, t.job.id, t.part.id))).body.data;
    const item = (await t.client.get(`/api/v1/shop/orders/${first.id}`)).body.data.items[0];
    expect((await t.client.post(`/api/v1/shop/orders/${first.id}/quote`, { items: [{ id: item.id, unitPrice: 4500 }] })).body.data.paymentTerms).toBe('ACCOUNT');

    // 9000 committed: a second 9000 order doesn't fit in the 10000 limit.
    const second = (await t.owner.post('/api/v1/garage/orders', catalogueOrder(t.shop.id, t.job.id, t.part.id))).body.data;
    const item2 = (await t.client.get(`/api/v1/shop/orders/${second.id}`)).body.data.items[0];
    expect((await t.client.post(`/api/v1/shop/orders/${second.id}/quote`, { items: [{ id: item2.id, unitPrice: 4500 }] })).body.data.paymentTerms).toBe('ON_HANDOVER');

    await t.client.post(`/api/v1/shop/orders/${first.id}/complete`, { code: first.handoverCode });
    let account = (await t.client.get(`/api/v1/shop/accounts/${t.accountId}`)).body.data;
    expect(account).toMatchObject({ balance: 9000, overdue: 0 });
    expect(account.entries[0]).toMatchObject({ kind: 'CHARGE', amount: 9000, order: { number: first.number } });

    account = (await t.client.post(`/api/v1/shop/accounts/${t.accountId}/payments`, { amount: 5000, method: 'BANK_TRANSFER', reference: 'TT-77' })).body.data;
    expect(account.balance).toBe(4000);
    const theirs = (await t.owner.get(`/api/v1/garage/shops/${t.shop.id}/statement`)).body.data;
    expect(theirs).toMatchObject({ balance: 4000, creditLimit: 10000, available: 6000 });
  });

  it('sends a free-text request back as a quote, and the shop can match it to stock', async () => {
    const t = await linked();
    const order = (await t.owner.post('/api/v1/garage/orders', { shopId: t.shop.id, jobCardId: t.job.id, fulfilment: 'DELIVERY', items: [{ description: 'Front pads for Aqua', quantity: 1 }] })).body.data;
    expect(order.total).toBeNull();
    const quoted = (await t.client.post(`/api/v1/shop/orders/${order.id}/quote`, { items: [{ id: order.items[0].id, unitPrice: 4800, partId: t.part.id }], sellerNote: 'Bosch, in stock' })).body.data;
    expect(quoted).toMatchObject({ status: 'QUOTED', total: 4800 });
    expect((await t.client.post(`/api/v1/shop/orders/${order.id}/ready`)).status).toBe(409);
    expect((await t.owner.post(`/api/v1/garage/orders/${order.id}/accept`)).body.data.status).toBe('CONFIRMED');
    await t.client.post(`/api/v1/shop/orders/${order.id}/complete`, { code: order.handoverCode, paymentMethod: 'CARD' });
    // Matched to stock, so it came off the shelf.
    expect((await prisma.part.findUniqueOrThrow({ where: { id: t.part.id } })).stockQty.toNumber()).toBe(9);
  });

  it('gets the parts onto the job later if the garage service was down at handover', async () => {
    const t = await linked();
    const order = (await t.owner.post('/api/v1/garage/orders', catalogueOrder(t.shop.id, t.job.id, t.part.id))).body.data;
    await t.client.post(`/api/v1/shop/orders/${order.id}/quote`, { items: [{ id: order.items[0].id, unitPrice: 4500 }] });
    garageServiceDown(true);
    expect((await t.client.post(`/api/v1/shop/orders/${order.id}/complete`, { code: order.handoverCode, paymentMethod: 'CASH' })).body.data.status).toBe('COMPLETED');
    expect(t.garage.parts).toEqual([]);
    garageServiceDown(false);
    await retryJobSyncs(prisma);
    expect(t.garage.parts).toHaveLength(1);
  });

  it("refuses delivery from a shop that doesn't deliver", async () => {
    const g = newGarage();
    const s = await newShop({ delivers: false });
    const part = await addPart(s.client);
    await g.owner.put(`/api/v1/garage/shops/${s.shop.id}/link`);
    expect((await g.owner.post('/api/v1/garage/orders', catalogueOrder(s.shop.id, g.job.id, part.id))).status).toBe(409);
  });
});

describe('pickups', () => {
  it('shows a mechanic pickup to that mechanic only, and refuses one who has not joined', async () => {
    const t = await linked();
    expect((await t.owner.post('/api/v1/garage/orders', catalogueOrder(t.shop.id, t.job.id, t.part.id, { fulfilment: 'PICKUP', pickupBy: 'MECHANIC', pickupStaffId: t.notJoined.id }))).status).toBe(409);
    const order = (await t.owner.post('/api/v1/garage/orders', catalogueOrder(t.shop.id, t.job.id, t.part.id, { fulfilment: 'PICKUP', pickupBy: 'MECHANIC', pickupStaffId: t.mechanic.id }))).body.data;
    expect((await t.mechanicClient.get('/api/v1/pickups')).body.data).toEqual([]);
    await t.client.post(`/api/v1/shop/orders/${order.id}/quote`, { items: [{ id: order.items[0].id, unitPrice: 4500 }] });

    const mine = (await t.mechanicClient.get('/api/v1/pickups')).body.data;
    expect(mine).toEqual([expect.objectContaining({ id: order.id, as: 'MECHANIC', handoverCode: order.handoverCode, payOnCollection: true })]);
    expect(mine[0].items[0].unitPrice).toBeUndefined();
    expect((await as('someone-else').get('/api/v1/pickups')).body.data).toEqual([]);
    expect((await t.client.get(`/api/v1/shop/orders/${order.id}`)).body.data.collector).toMatchObject({ kind: 'MECHANIC', name: 'Kasun Silva' });
  });

  it("shows a vehicle-owner pickup to whoever registered the job's plate", async () => {
    const t = await linked();
    owners({ driver1: [{ plate: 'WPCAB1234', since: null }], driver2: [{ plate: 'ZZ9999', since: null }] });
    const opts = (await t.owner.get(`/api/v1/garage/orders/pickup-options?jobCardId=${t.job.id}`)).body.data;
    expect(opts).toMatchObject({ vehicleOwner: { plate: 'WP-CAB-1234', registered: true }, mechanics: expect.arrayContaining([expect.objectContaining({ name: 'Kasun Silva', joined: true })]) });

    const order = (await t.owner.post('/api/v1/garage/orders', catalogueOrder(t.shop.id, t.job.id, t.part.id, { fulfilment: 'PICKUP', pickupBy: 'VEHICLE_OWNER' }))).body.data;
    await t.client.post(`/api/v1/shop/orders/${order.id}/quote`, { items: [{ id: order.items[0].id, unitPrice: 4500 }] });
    expect((await as('driver1').get('/api/v1/pickups')).body.data).toEqual([expect.objectContaining({ id: order.id, as: 'VEHICLE_OWNER' })]);
    expect((await as('driver2').get('/api/v1/pickups')).body.data).toEqual([]);
  });

  it('refuses the vehicle owner when nobody registered the plate', async () => {
    const t = await linked();
    owners({}, false);
    expect((await t.owner.post('/api/v1/garage/orders', catalogueOrder(t.shop.id, t.job.id, t.part.id, { fulfilment: 'PICKUP', pickupBy: 'VEHICLE_OWNER' }))).status).toBe(409);
  });
});
