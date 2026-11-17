import { randomUUID } from 'node:crypto';

import express from 'express';
import request from 'supertest';

import { createApp } from '../src/app';
import { clearGarageCache } from '../src/middleware/auth';
import { setGarageClient, type GarageJob, type GarageStaff, type PartLine } from '../src/services/garageClient';
import { setVehicleLookup, type OwnedVehicle } from '../src/services/kadunaVehicles';

/** The real app, with sign-in replaced: the caller is the x-test-user header. */
export const app: express.Express = createApp({
  authenticate: (req, _res, next) => {
    req.userId = req.header('x-test-user') ?? 'anonymous';
    req.userEmail = req.header('x-test-email') ?? null;
    req.userName = req.header('x-test-name') ?? null;
    req.authToken = `token-${req.userId}`;
    next();
  },
});

/** Calls as this account; `email` and `name` stand in for the token's claims. */
export function as(userId: string, claims: { email?: string; name?: string } = {}) {
  const auth = (t: request.Test) => {
    const r = t.set('x-test-user', userId).set('Authorization', 'Bearer test');
    if (claims.email) r.set('x-test-email', claims.email);
    if (claims.name) r.set('x-test-name', claims.name);
    return r;
  };
  return {
    userId,
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    put: (url: string, body?: object) => auth(request(app).put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(request(app).patch(url)).send(body ?? {}),
    delete: (url: string) => auth(request(app).delete(url)),
  };
}

// ─── An in-memory garage service ────────────────────────────────────────────

interface FakeGarage {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  ownerUserId: string;
  staff: GarageStaff[];
  jobs: Map<string, GarageJob>;
  notes: string[];
  parts: { jobId: string; lines: PartLine[]; note: string }[];
}

const fake = { garages: [] as FakeGarage[], down: false };

/** Makes the next garage-service calls fail, as if it were unreachable. */
export const garageServiceDown = (down: boolean) => (fake.down = down);

setGarageClient({
  async me(token) {
    const userId = token.replace(/^token-/, '');
    for (const g of fake.garages) {
      const garage = { id: g.id, name: g.name, phone: g.phone, address: g.address };
      if (g.ownerUserId === userId) return { role: 'OWNER', garage, staff: null };
      const m = g.staff.find((s) => s.userId === userId && s.active);
      if (m) return { role: 'MECHANIC', garage, staff: { id: m.id, name: m.name } };
    }
    return { role: null, garage: null, staff: null };
  },
  async staff(garageId) {
    return fake.garages.find((g) => g.id === garageId)?.staff ?? [];
  },
  async job(garageId, jobId) {
    return fake.garages.find((g) => g.id === garageId)?.jobs.get(jobId) ?? null;
  },
  async note(garageId, _jobId, note) {
    fake.garages.find((g) => g.id === garageId)?.notes.push(note);
  },
  async addParts(garageId, jobId, lines, note) {
    if (fake.down) throw new Error('garage service down');
    const g = fake.garages.find((x) => x.id === garageId)!;
    const job = g.jobs.get(jobId);
    if (!job?.editable) return { added: false };
    g.parts.push({ jobId, lines, note });
    return { added: true };
  },
});

/** A garage with an owner, a joined mechanic and a job for a Toyota Aqua. */
export function newGarage(vehicle: GarageJob['vehicle'] = { plate: 'WP-CAB-1234', make: 'Toyota', model: 'Aqua', year: 2015 }) {
  clearGarageCache();
  const g: FakeGarage = {
    id: `garage-${randomUUID()}`,
    name: 'Test Motors',
    phone: '0112345678',
    address: '5 Galle Rd, Colombo',
    ownerUserId: `owner-${randomUUID()}`,
    staff: [],
    jobs: new Map(),
    notes: [],
    parts: [],
  };
  const mechanic: GarageStaff = { id: `staff-${randomUUID()}`, name: 'Kasun Silva', phone: '0771111111', active: true, userId: `mech-${randomUUID()}` };
  const notJoined: GarageStaff = { id: `staff-${randomUUID()}`, name: 'Not Joined', phone: null, active: true, userId: null };
  g.staff.push(mechanic, notJoined);
  const job: GarageJob = { id: `job-${randomUUID()}`, number: 7, status: 'IN_PROGRESS', editable: true, vehicle };
  g.jobs.set(job.id, job);
  fake.garages.push(g);
  return { garage: g, owner: as(g.ownerUserId), mechanic, mechanicClient: as(mechanic.userId!), notJoined, job };
}

/** A signed-in account with a shop. */
export async function newShop(overrides: Record<string, unknown> = {}) {
  const client = as(`seller-${randomUUID()}`);
  const res = await client.put('/api/v1/shop', { name: 'Lanka Auto Parts', address: '12 Main St', city: 'Colombo', ...overrides });
  if (res.status !== 201) throw new Error(`shop setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client, shop: res.body.data };
}

/** Adds a part with stock; Aqua 2012-2017 fitment unless told otherwise. */
export async function addPart(client: ReturnType<typeof as>, overrides: Record<string, unknown> = {}) {
  const res = await client.post('/api/v1/shop/parts', {
    sku: `BP-${randomUUID().slice(0, 6)}`,
    name: 'Front brake pads',
    brand: 'Bosch',
    oemNumber: '04465-52260',
    costPrice: 3000,
    retailPrice: 5000,
    tradePrice: 4500,
    openingStock: 10,
    reorderLevel: 2,
    fitments: [{ make: 'Toyota', model: 'Aqua', yearFrom: 2012, yearTo: 2017 }],
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`part failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** Whose plates the signed-in driver has registered. */
export function owners(cars: Record<string, OwnedVehicle[]>, registered = true) {
  setVehicleLookup({
    vehiclesOf: async (token) => cars[(token ?? '').replace(/^token-/, '')] ?? [],
    plateRegistered: async () => registered,
  });
}
