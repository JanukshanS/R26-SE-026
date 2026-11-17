/**
 * Setting up a garage, and the property everything else depends on: one
 * garage can never see or touch another garage's data.
 */
import { describe, expect, it } from 'vitest';

import { as, newGarage } from './helpers';

describe('garage setup', () => {
  it('asks for a garage before anything else', async () => {
    const before = await as('prov-no-garage').get('/api/v1/garage');
    expect(before.status).toBe(200);
    expect(before.body.data).toBeNull();
    const res = await as('prov-no-garage').get('/api/v1/customers');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Set up your garage first');
  });

  it('creates the garage once, then updates it', async () => {
    const client = as('prov-setup');
    const first = await client.put('/api/v1/garage', { name: 'Perera Auto', labourRate: 3000, taxRate: 18 });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ name: 'Perera Auto', labourRate: 3000, taxRate: 18, currency: 'LKR' });

    const second = await client.put('/api/v1/garage', { name: 'Perera Auto Care', labourRate: 3200, taxRate: 18 });
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.name).toBe('Perera Auto Care');
  });

  it('rejects an invalid garage', async () => {
    const res = await as('prov-invalid').put('/api/v1/garage', { name: '', taxRate: 150 });
    expect(res.status).toBe(422);
    expect(res.body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['name', 'taxRate']));
  });
});

describe('tenancy', () => {
  it("keeps each garage's customers, vehicles, parts and jobs to itself", async () => {
    const a = await newGarage();
    const b = await newGarage();

    const customer = (await a.client.post('/api/v1/customers', { name: 'Nimal' })).body.data;
    const vehicle = (await a.client.post('/api/v1/vehicles', { plate: 'CAB 1234', customerId: customer.id })).body.data;
    const part = (await a.client.post('/api/v1/parts', { sku: 'OF-1', name: 'Oil filter', openingStock: 5 })).body.data;
    const job = (await a.client.post('/api/v1/job-cards', { customerId: customer.id, vehicleId: vehicle.id })).body.data;

    for (const url of [`/api/v1/customers/${customer.id}`, `/api/v1/vehicles/${vehicle.id}`, `/api/v1/parts/${part.id}`, `/api/v1/job-cards/${job.id}`]) {
      expect((await b.client.get(url)).status, url).toBe(404);
    }
    expect((await b.client.get('/api/v1/customers')).body.data.total).toBe(0);
    // Nor can B attach A's records to its own job, or use A's stock.
    expect((await b.client.post('/api/v1/job-cards', { customerId: customer.id })).status).toBe(404);
    const bJob = (await b.client.post('/api/v1/job-cards', {})).body.data;
    expect((await b.client.post(`/api/v1/job-cards/${bJob.id}/items`, { kind: 'PART', partId: part.id })).status).toBe(404);
  });

  it('lets the same plate exist in two garages but not twice in one', async () => {
    const a = await newGarage();
    const b = await newGarage();
    expect((await a.client.post('/api/v1/vehicles', { plate: 'cab-9999' })).status).toBe(201);
    expect((await b.client.post('/api/v1/vehicles', { plate: 'CAB 9999' })).status).toBe(201);
    const dup = await a.client.post('/api/v1/vehicles', { plate: 'CAB9999' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toContain('CAB-9999');
  });
});
