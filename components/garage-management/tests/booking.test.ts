/**
 * Online booking through the garage's link. What matters: only real free
 * slots can be booked, a slot is never over-filled (online or by staff), the
 * link and a customer's booking are their own keys, and spam is turned away.
 */
import { describe, expect, it } from 'vitest';

import { anonymous, newGarage, newMechanic } from './helpers';

const ALL_DAY = { open: '00:00', close: '23:00' };
const settings = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  slotMinutes: 60,
  capacity: 1,
  leadHours: 0,
  daysAhead: 3,
  hours: { mon: ALL_DAY, tue: ALL_DAY, wed: ALL_DAY, thu: ALL_DAY, fri: ALL_DAY, sat: ALL_DAY, sun: ALL_DAY },
  services: ['Full service', 'Oil change'],
  note: 'Please bring your service book',
  ...overrides,
});

type Day = { date: string; open: boolean; slots: { startsAt: string; time: string; free: number }[] };

async function openGarage(overrides: Record<string, unknown> = {}) {
  const g = await newGarage();
  const saved = await g.client.put('/api/v1/booking-settings', settings(overrides));
  expect(saved.status).toBe(200);
  const token: string = saved.body.data.token;
  const days: Day[] = (await anonymous().get(`/api/v1/public/book/${token}/slots?days=3`)).body.data;
  // Tomorrow's first slot: always in the future whatever the time of day.
  const slot = days[1].slots[0];
  const bookIt = (body: Record<string, unknown> = {}) =>
    anonymous().post(`/api/v1/public/book/${token}`, { startsAt: slot.startsAt, service: 'Oil change', name: 'Ama Perera', phone: '077 123 4567', plate: 'cab 1234', vehicle: 'Toyota Aqua', ...body });
  return { ...g, token, days, slot, bookIt };
}

describe('booking link setup', () => {
  it('starts off, and the first save makes the link', async () => {
    const { client } = await newGarage();
    const before = (await client.get('/api/v1/booking-settings')).body.data;
    expect(before).toMatchObject({ token: null, settings: { enabled: false, slotMinutes: 60 } });
    const saved = (await client.put('/api/v1/booking-settings', settings({ enabled: false }))).body.data;
    expect(saved.token).toMatch(/^[\w-]{22}$/);
    const page = (await anonymous().get(`/api/v1/public/book/${saved.token}`)).body.data;
    expect(page).toMatchObject({ enabled: false, services: ['Full service', 'Oil change'], note: 'Please bring your service book', garage: { name: 'Test Motors' } });
    expect((await anonymous().get(`/api/v1/public/book/${saved.token}/slots`)).body.data).toEqual([]);
    expect((await client.put('/api/v1/booking-settings', settings({ hours: { ...settings().hours, mon: { open: '17:00', close: '08:00' } } }))).status).toBe(422);
  });

  it('is for the owner only', async () => {
    const { client } = await newGarage();
    const { client: mechanic } = await newMechanic(client);
    expect((await mechanic.get('/api/v1/booking-settings')).status).toBe(403);
    expect((await mechanic.put('/api/v1/booking-settings', settings())).status).toBe(403);
  });

  it('offers slots only inside opening hours and the booking window', async () => {
    const { days } = await openGarage({ hours: { ...settings().hours, sun: null } });
    expect(days).toHaveLength(3);
    for (const d of days) {
      if (!d.open) {
        expect(d.slots).toEqual([]);
        continue;
      }
      expect(d.slots.every((s) => s.time >= '00:00' && s.time <= '22:00')).toBe(true);
    }
    // Tomorrow is a full day: 00:00 to 22:00 in hour slots.
    if (days[1].open) expect(days[1].slots).toHaveLength(23);
  });
});

describe('booking a slot', () => {
  it('books a free slot, shows it to the garage as online, and fills the slot', async () => {
    const { client, token, slot, bookIt } = await openGarage();
    const res = await bookIt();
    expect(res.status).toBe(201);
    expect(res.body.data.booking).toMatchObject({ service: 'Oil change', status: 'BOOKED', plate: 'CAB-1234', cancellable: true });

    const list = (await client.get('/api/v1/appointments')).body.data;
    expect(list).toEqual([expect.objectContaining({ source: 'ONLINE', customerName: 'Ama Perera', phone: '0771234567', notes: 'Vehicle: Toyota Aqua', durationMin: 60 })]);

    const again = await bookIt({ name: 'Someone else', phone: '0719999999' });
    expect(again.status).toBe(409);
    const days: Day[] = (await anonymous().get(`/api/v1/public/book/${token}/slots?days=3`)).body.data;
    expect(days.flatMap((d) => d.slots).find((s) => s.startsAt === slot.startsAt)?.free).toBe(0);
  });

  it('counts staff bookings against the same slots', async () => {
    const { client, slot, bookIt } = await openGarage();
    await client.post('/api/v1/appointments', { customerName: 'Walk-in regular', service: 'Brakes', startsAt: slot.startsAt, durationMin: 60 });
    expect((await bookIt()).status).toBe(409);
  });

  it('turns away made-up times, unknown services, spam and a link that is off', async () => {
    const { client, slot, bookIt } = await openGarage();
    const offGrid = new Date(new Date(slot.startsAt).getTime() + 15 * 60_000).toISOString();
    expect((await bookIt({ startsAt: offGrid })).status).toBe(422);
    expect((await bookIt({ service: 'Engine rebuild' })).status).toBe(422);
    expect((await bookIt({ website: 'http://spam.example' })).status).toBe(422);
    await client.put('/api/v1/booking-settings', settings({ enabled: false }));
    expect((await bookIt()).status).toBe(409);
  });

  it('limits how many upcoming bookings one phone can hold', async () => {
    const { days, bookIt } = await openGarage({ capacity: 5 });
    const slots = days[1].slots.slice(0, 4);
    for (const s of slots.slice(0, 3)) expect((await bookIt({ startsAt: s.startsAt })).status).toBe(201);
    expect((await bookIt({ startsAt: slots[3].startsAt })).status).toBe(409);
  });
});

describe("the customer's booking", () => {
  it('can be viewed and cancelled with its own link, which frees the slot', async () => {
    const { token, slot, bookIt } = await openGarage();
    const mine: string = (await bookIt()).body.data.token;
    expect((await anonymous().get(`/api/v1/public/bookings/${mine}`)).body.data).toMatchObject({ status: 'BOOKED', cancellable: true, garage: { name: 'Test Motors' } });
    const cancelled = await anonymous().post(`/api/v1/public/bookings/${mine}/cancel`);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', cancellable: false });
    const days: Day[] = (await anonymous().get(`/api/v1/public/book/${token}/slots?days=3`)).body.data;
    expect(days.flatMap((d) => d.slots).find((s) => s.startsAt === slot.startsAt)?.free).toBe(1);
    expect((await anonymous().get('/api/v1/public/bookings/not-a-token')).status).toBe(404);
  });

  it('stops working when the owner resets the booking link', async () => {
    const { client, token } = await openGarage();
    const fresh = (await client.post('/api/v1/booking-settings/reset-link')).body.data.token;
    expect(fresh).not.toBe(token);
    expect((await anonymous().get(`/api/v1/public/book/${token}`)).status).toBe(404);
    expect((await anonymous().get(`/api/v1/public/book/${fresh}`)).status).toBe(200);
  });

  it('checks in as the existing customer with the same phone', async () => {
    const { client, bookIt } = await openGarage();
    const known = (await client.post('/api/v1/customers', { name: 'Ama Perera', phone: '0771234567' })).body.data;
    await bookIt();
    const appt = (await client.get('/api/v1/appointments')).body.data[0];
    const { job } = (await client.post(`/api/v1/appointments/${appt.id}/check-in`)).body.data;
    expect(job.customer.id).toBe(known.id);
    expect((await client.get('/api/v1/customers')).body.data.total).toBe(1);
  });
});
