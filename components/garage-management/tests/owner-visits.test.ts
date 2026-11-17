/**
 * The vehicle owner's side: a member sees any garage's jobs and bookings for
 * the plates they registered, with nothing linked by hand, and never someone
 * else's; a previous owner's finished history stays private; and members can
 * book listed garages for their own cars only.
 */
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { setVehicleLookup, type OwnedVehicle } from '../src/services/kadunaVehicles';
import { prisma } from '../src/utils/prisma';
import { anonymous, asUser, newGarage } from './helpers';

const ALL_DAY = { open: '00:00', close: '23:00' };
const bookingSettings = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  slotMinutes: 60,
  capacity: 2,
  leadHours: 0,
  daysAhead: 3,
  hours: { mon: ALL_DAY, tue: ALL_DAY, wed: ALL_DAY, thu: ALL_DAY, fri: ALL_DAY, sat: ALL_DAY, sun: ALL_DAY },
  services: ['Full service', 'Oil change'],
  note: null,
  ...overrides,
});

/** A unique plate like "WP-QXZ-4821", and its compact form. */
function newPlate() {
  const letters = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join('');
  const plate = `WP-${letters}-${Math.floor(1000 + Math.random() * 8999)}`;
  return { plate, compact: plate.replace(/-/g, '') };
}

/** Signs in as a member whose Kaduna account has these cars. */
function member(cars: OwnedVehicle[]) {
  setVehicleLookup({ vehiclesOf: async () => cars, plateRegistered: async () => true });
  return asUser(`driver-${randomUUID()}`);
}

afterEach(() => setVehicleLookup(null));

describe('a member sees their car at any garage', () => {
  it('shows a job as soon as a garage opens it for their plate, however the garage typed it', async () => {
    const { plate, compact } = newPlate();
    const g = await newGarage({ name: `Auto ${randomUUID().slice(0, 4)}` });
    // The garage types it without dashes; the member registered it with them.
    const car = (await g.client.post('/api/v1/vehicles', { plate: compact.toLowerCase(), make: 'Toyota', model: 'Aqua' })).body.data;
    const mech = (await g.client.post('/api/v1/staff', { name: 'Kasun Silva' })).body.data;
    const job = (await g.client.post('/api/v1/job-cards', { vehicleId: car.id, complaint: 'Brake noise', mechanicId: mech.id })).body.data;

    const visits = (await member([{ plate: compact, since: null }]).get('/api/v1/my/visits')).body.data;
    expect(visits.repairs).toEqual([
      expect.objectContaining({ id: job.id, jobNumber: job.number, status: 'OPEN', complaint: 'Brake noise', mechanicName: 'Kasun', trackingToken: expect.any(String), garage: expect.objectContaining({ id: g.garage.id }) }),
    ]);
    // The tracking link it gives works.
    expect((await asUser('x').get(`/api/v1/public/track/${visits.repairs[0].trackingToken}`)).status).toBe(200);

    expect((await member([{ plate: newPlate().compact, since: null }]).get('/api/v1/my/visits')).body.data.repairs).toEqual([]);
    expect(plate).toContain('-');
  });

  it("keeps a previous owner's finished jobs private, but shows open work", async () => {
    const { compact } = newPlate();
    const g = await newGarage();
    const car = (await g.client.post('/api/v1/vehicles', { plate: compact })).body.data;
    const old = (await g.client.post('/api/v1/job-cards', { vehicleId: car.id })).body.data;
    await prisma.jobCard.update({ where: { id: old.id }, data: { status: 'CLOSED', closedAt: new Date(Date.now() - 30 * 86_400_000) } });
    const open = (await g.client.post('/api/v1/job-cards', { vehicleId: car.id })).body.data;

    // Registered the car a week ago: the job closed a month ago was someone else's.
    const ids = (await member([{ plate: compact, since: new Date(Date.now() - 7 * 86_400_000) }]).get('/api/v1/my/visits')).body.data.repairs.map((r: { id: string }) => r.id);
    expect(ids).toEqual([open.id]);
  });
});

describe('booking from the dashboard', () => {
  it('lists garages taking bookings, unless they opt out of the app', async () => {
    const shown = await newGarage();
    await shown.client.put('/api/v1/booking-settings', bookingSettings());
    const hidden = await newGarage();
    await hidden.client.put('/api/v1/booking-settings', bookingSettings({ listed: false }));
    const off = await newGarage();
    await off.client.put('/api/v1/booking-settings', bookingSettings({ enabled: false }));

    const ids = (await member([]).get('/api/v1/my/garages')).body.data.map((g: { id: string }) => g.id);
    expect(ids).toContain(shown.garage.id);
    expect(ids).not.toContain(hidden.garage.id);
    expect(ids).not.toContain(off.garage.id);
    expect((await member([]).get(`/api/v1/my/garages/${hidden.garage.id}`)).status).toBe(404);

    // The same list is public on kaduna.lk, with the booking link and nothing private.
    const pub = (await anonymous().get('/api/v1/public/garages')).body.data;
    const mine = pub.find((g: { id: string }) => g.id === shown.garage.id);
    expect(mine).toMatchObject({ name: shown.garage.name, bookingToken: expect.any(String), services: ['Full service', 'Oil change'] });
    expect(mine.labourRate).toBeUndefined();
    expect(pub.some((g: { id: string }) => g.id === hidden.garage.id || g.id === off.garage.id)).toBe(false);
  });

  it("books a slot for the member's own car, and the booking shows in their dashboard", async () => {
    const { plate, compact } = newPlate();
    const g = await newGarage();
    await g.client.put('/api/v1/booking-settings', bookingSettings());
    const me = member([{ plate: compact, since: null }]);
    const days = (await me.get(`/api/v1/my/garages/${g.garage.id}/slots?days=3`)).body.data;
    const slot = days[1].slots[0];
    const body = { startsAt: slot.startsAt, service: 'Oil change', plate, vehicle: 'Toyota Aqua', name: 'Ama Perera', phone: '0771234567' };

    expect((await me.post(`/api/v1/my/garages/${g.garage.id}/book`, { ...body, plate: 'CAB-9999' })).status).toBe(403);
    const booked = await me.post(`/api/v1/my/garages/${g.garage.id}/book`, body);
    expect(booked.status).toBe(201);

    const visits = (await me.get('/api/v1/my/visits')).body.data;
    expect(visits.bookings).toEqual([expect.objectContaining({ service: 'Oil change', status: 'BOOKED', manageToken: booked.body.data.token, cancellable: true, garage: expect.objectContaining({ id: g.garage.id }) })]);
    // The garage sees it in its diary.
    const diary = (await g.client.get('/api/v1/appointments')).body.data;
    expect(diary.some((a: { plate: string | null; source: string }) => a.plate?.replace(/-/g, '') === compact && a.source === 'ONLINE')).toBe(true);
  });
});
