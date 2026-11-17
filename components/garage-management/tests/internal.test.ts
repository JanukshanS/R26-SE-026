/**
 * The internal API the parts service uses. The things worth protecting: it
 * needs the shared secret, it only sees the garage named in the path, and
 * received parts only land on a job that can still take lines.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, newGarage, newMechanic } from './helpers';

const TOKEN = 'test-internal-token';
const internal = {
  get: (url: string, token = TOKEN) => request(app).get(url).set('X-Internal-Token', token),
  post: (url: string, body: object, token = TOKEN) => request(app).post(url).set('X-Internal-Token', token).send(body),
};

describe('internal API', () => {
  it('refuses calls without the right secret', async () => {
    const { garage } = await newGarage();
    expect((await request(app).get(`/internal/v1/garages/${garage.id}/staff`)).status).toBe(401);
    expect((await internal.get(`/internal/v1/garages/${garage.id}/staff`, 'wrong-token-here!!!')).status).toBe(401);
  });

  it("lists a garage's mechanics with their Kaduna accounts", async () => {
    const { client, garage } = await newGarage();
    const joined = await newMechanic(client, 'Kasun Silva');
    await client.post('/api/v1/staff', { name: 'Not Joined' });
    const staff = (await internal.get(`/internal/v1/garages/${garage.id}/staff`)).body.data;
    expect(staff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: joined.member.id, name: 'Kasun Silva', userId: joined.userId, active: true }),
        expect.objectContaining({ name: 'Not Joined', userId: null }),
      ]),
    );
  });

  it("describes a job, only in its own garage, and puts received parts on it while it's open", async () => {
    const a = await newGarage();
    const b = await newGarage();
    const car = (await a.client.post('/api/v1/vehicles', { plate: 'CAB-1234', make: 'Toyota', model: 'Aqua', year: 2015 })).body.data;
    const job = (await a.client.post('/api/v1/job-cards', { vehicleId: car.id })).body.data;

    expect((await internal.get(`/internal/v1/garages/${b.garage.id}/job-cards/${job.id}`)).status).toBe(404);
    expect((await internal.get(`/internal/v1/garages/${a.garage.id}/job-cards/${job.id}`)).body.data).toMatchObject({
      number: job.number, status: 'OPEN', editable: true, vehicle: { plate: 'CAB-1234', make: 'Toyota', model: 'Aqua', year: 2015 },
    });

    const parts = { lines: [{ description: 'Brake pads (BP-22)', quantity: 2, unitPrice: 4500 }], note: 'Received Lanka Auto order #3' };
    expect((await internal.post(`/internal/v1/garages/${a.garage.id}/job-cards/${job.id}/parts`, parts)).body.data).toEqual({ added: true });
    const after = (await a.client.get(`/api/v1/job-cards/${job.id}`)).body.data;
    expect(after.items).toEqual([expect.objectContaining({ kind: 'PART', description: 'Brake pads (BP-22)', quantity: 2, unitPrice: 4500 })]);
    expect(after.updates.some((u: { note: string | null; public: boolean }) => u.note?.startsWith('Received Lanka Auto order #3') && !u.public)).toBe(true);

    // Once it's cancelled, parts aren't added; the note still goes on.
    await a.client.post(`/api/v1/job-cards/${job.id}/status`, { status: 'CANCELLED' });
    expect((await internal.post(`/internal/v1/garages/${a.garage.id}/job-cards/${job.id}/parts`, parts)).body.data).toEqual({ added: false });
    expect((await a.client.get(`/api/v1/job-cards/${job.id}`)).body.data.items).toHaveLength(1);
  });
});
