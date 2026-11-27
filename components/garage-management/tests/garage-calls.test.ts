/**
 * Calls customers place to garages through Kaduna, and the admin view of
 * them. What matters: only listed garages can be called, the caller gets the
 * number to dial, a double tap is one call, and only administrators see the
 * figures.
 */
import { describe, expect, it } from 'vitest';

import { asOps, asUser, newGarage } from './helpers';

const ALL_DAY = { open: '00:00', close: '23:00' };
const listing = {
  enabled: true,
  listed: true,
  slotMinutes: 60,
  capacity: 1,
  leadHours: 0,
  daysAhead: 3,
  hours: { mon: ALL_DAY, tue: ALL_DAY, wed: ALL_DAY, thu: ALL_DAY, fri: ALL_DAY, sat: ALL_DAY, sun: ALL_DAY },
  services: ['Full service'],
};

async function listedGarage(name: string, phone: string | null = '0771234567') {
  const g = await newGarage({ name, phone });
  expect((await g.client.put('/api/v1/booking-settings', listing)).status).toBe(200);
  return g;
}

describe('calling a garage', () => {
  it('logs the call and returns the number to dial; a quick redial is the same call', async () => {
    const { garage } = await listedGarage('Call Me Motors', '0112345678');
    const driver = asUser(`driver-${garage.id}`);

    const first = await driver.post('/api/v1/garage-calls', { garageId: garage.id });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ garageId: garage.id, garageName: 'Call Me Motors', phone: '0112345678', counted: true });

    const again = await driver.post('/api/v1/garage-calls', { garageId: garage.id, source: 'app' });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ id: first.body.data.id, counted: false });
  });

  it('refuses unlisted garages, unknown ones and garages without a phone', async () => {
    const hidden = await newGarage({ name: 'Not Listed', phone: '0770000000' });
    const noPhone = await listedGarage('No Phone Garage', null);
    const driver = asUser('driver-x');
    expect((await driver.post('/api/v1/garage-calls', { garageId: hidden.garage.id })).status).toBe(404);
    expect((await driver.post('/api/v1/garage-calls', { garageId: 'nope' })).status).toBe(404);
    expect((await driver.post('/api/v1/garage-calls', { garageId: noPhone.garage.id })).status).toBe(409);
    expect((await driver.post('/api/v1/garage-calls', {})).status).toBe(422);
  });
});

describe('admin call figures', () => {
  it('counts calls, unique callers and calls per garage', async () => {
    const a = await listedGarage('Alpha Auto');
    const b = await listedGarage('Beta Garage');
    const before = (await asOps().get('/api/v1/admin/garage-calls')).body.data;

    await asUser(`u1-${a.garage.id}`).post('/api/v1/garage-calls', { garageId: a.garage.id });
    await asUser(`u2-${a.garage.id}`).post('/api/v1/garage-calls', { garageId: a.garage.id, source: 'web' });
    await asUser(`u1-${a.garage.id}`).post('/api/v1/garage-calls', { garageId: b.garage.id });

    const res = await asOps().get('/api/v1/admin/garage-calls');
    expect(res.status).toBe(200);
    const stats = res.body.data;
    expect(stats.total - before.total).toBe(3);
    expect(stats.uniqueCallers - before.uniqueCallers).toBe(2);
    expect(stats.byGarage.find((g: { garageId: string }) => g.garageId === a.garage.id)).toMatchObject({ name: 'Alpha Auto', calls: 2 });
    expect(stats.byGarage.find((g: { garageId: string }) => g.garageId === b.garage.id)).toMatchObject({ name: 'Beta Garage', calls: 1 });
    expect(stats.byDay.length).toBeGreaterThanOrEqual(30);
    expect(stats.byDay.at(-1).calls).toBeGreaterThanOrEqual(3);
    expect(stats.recent[0]).toMatchObject({ garageName: 'Beta Garage', source: 'app' });

    const today = new Date().toISOString().slice(0, 10);
    const oneDay = (await asOps().get(`/api/v1/admin/garage-calls?from=${today}&to=${today}`)).body.data;
    expect(oneDay.byDay).toEqual([{ date: today, calls: oneDay.total }]);
  });

  it('is for administrators only', async () => {
    const { client } = await newGarage();
    expect((await asUser('just-a-driver').get('/api/v1/admin/garage-calls')).status).toBe(403);
    expect((await client.get('/api/v1/admin/garage-calls')).status).toBe(403);
    expect((await asOps().get('/api/v1/admin/garage-calls?from=yesterday')).status).toBe(422);
  });
});
