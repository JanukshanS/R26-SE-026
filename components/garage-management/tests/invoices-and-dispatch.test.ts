/**
 * Invoices, the dashboard, and importing a Kaduna dispatch job.
 */
import http from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newGarage } from './helpers';

async function readyJob(client: Awaited<ReturnType<typeof newGarage>>['client']) {
  const job = (await client.post('/api/v1/job-cards', {})).body.data;
  await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'LABOUR', description: 'Full service', quantity: 2, unitPrice: 3000 });
  await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'PART', description: 'Engine oil 4L', quantity: 1, unitPrice: 12999.99 });
  for (const status of ['IN_PROGRESS', 'READY']) await client.post(`/api/v1/job-cards/${job.id}/status`, { status });
  return job;
}

describe('invoices', () => {
  it('only invoices a job that is ready, and adds tax', async () => {
    const { client } = await newGarage({ taxRate: 18 });
    const draft = (await client.post('/api/v1/job-cards', {})).body.data;
    expect((await client.post(`/api/v1/job-cards/${draft.id}/invoice`)).status).toBe(409);

    const job = await readyJob(client);
    const res = await client.post(`/api/v1/job-cards/${job.id}/invoice`);
    expect(res.status).toBe(201);
    // 6000 + 12999.99 = 18999.99; tax 18% = 3419.9982 → 3420.00
    expect(res.body.data).toMatchObject({ number: 1, status: 'UNPAID', subtotal: 18999.99, tax: 3420, total: 22419.99 });
    expect(res.body.data.lines).toHaveLength(2);
  });

  it('locks the job once invoiced, until the invoice is voided', async () => {
    const { client } = await newGarage();
    const job = await readyJob(client);
    const invoice = (await client.post(`/api/v1/job-cards/${job.id}/invoice`)).body.data;

    expect((await client.post(`/api/v1/job-cards/${job.id}/invoice`)).status).toBe(409);
    expect((await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'LABOUR', description: 'Extra', unitPrice: 500 })).status).toBe(409);

    expect((await client.post(`/api/v1/invoices/${invoice.id}/void`)).body.data.status).toBe('VOID');
    expect((await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'LABOUR', description: 'Extra', unitPrice: 500 })).status).toBe(201);
    const reissued = (await client.post(`/api/v1/job-cards/${job.id}/invoice`)).body.data;
    expect(reissued).toMatchObject({ number: 2, total: 19499.99 });
  });

  it('records payment, and a paid invoice cannot be voided or the job cancelled', async () => {
    const { client } = await newGarage();
    const job = await readyJob(client);
    const invoice = (await client.post(`/api/v1/job-cards/${job.id}/invoice`)).body.data;
    const paid = await client.post(`/api/v1/invoices/${invoice.id}/pay`, { method: 'CASH' });
    expect(paid.body.data).toMatchObject({ status: 'PAID', paymentMethod: 'CASH' });
    expect(paid.body.data.paidAt).toBeTruthy();
    expect((await client.post(`/api/v1/invoices/${invoice.id}/pay`, { method: 'CARD' })).status).toBe(409);
    expect((await client.post(`/api/v1/invoices/${invoice.id}/void`)).status).toBe(409);
    expect((await client.post(`/api/v1/job-cards/${job.id}/status`, { status: 'CANCELLED' })).status).toBe(409);
  });

  it('feeds the dashboard', async () => {
    const { client } = await newGarage();
    const job = await readyJob(client);
    const invoice = (await client.post(`/api/v1/job-cards/${job.id}/invoice`)).body.data;
    await client.post('/api/v1/job-cards', {});
    await client.post('/api/v1/parts', { sku: 'LOW-1', name: 'Wiper blade', openingStock: 1, reorderLevel: 2 });

    let board = (await client.get('/api/v1/dashboard')).body.data;
    expect(board).toMatchObject({ openJobs: 2, unpaidTotal: 18999.99, revenueThisMonth: 0 });
    expect(board.jobsByStatus).toMatchObject({ READY: 1, OPEN: 1 });
    expect(board.lowStockParts.map((p: { sku: string }) => p.sku)).toEqual(['LOW-1']);

    await client.post(`/api/v1/invoices/${invoice.id}/pay`, { method: 'BANK_TRANSFER' });
    board = (await client.get('/api/v1/dashboard')).body.data;
    expect(board).toMatchObject({ unpaidTotal: 0, revenueThisMonth: 18999.99 });
  });
});

describe('importing a Kaduna dispatch job', () => {
  // Stands in for the dispatch service at DISPATCH_URL (set in global-setup).
  const incidents: Record<string, object> = {};
  let seenAuth = '';
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seenAuth = req.headers.authorization ?? '';
      const id = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
      const incident = incidents[id];
      res.writeHead(incident ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(incident ? { success: true, data: incident } : { success: false, error: 'Not found' }));
    });
    await new Promise<void>((resolve) => server.listen(54401, resolve));
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('creates a job card from a job assigned to this provider, once', async () => {
    const { client, providerId } = await newGarage();
    incidents['INC-77'] = {
      id: 'INC-77', status: 'RESOLVED', assignedProviderId: providerId, vehicleMake: 'Toyota', vehicleModel: 'Axio', vehicleYear: 2016,
      description: "Car won't start", triageResponse: { predictedServiceType: 'BATTERY_JUMP' },
    };
    const first = await client.post('/api/v1/job-cards/from-dispatch', { incidentId: 'INC-77' });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ source: 'KADUNA_DISPATCH', dispatchIncidentId: 'INC-77', vehicle: { make: 'Toyota', model: 'Axio', year: 2016 } });
    expect(first.body.data.complaint).toContain('battery jump');
    expect(seenAuth).toBe('Bearer test-token');

    const again = await client.post('/api/v1/job-cards/from-dispatch', { incidentId: 'INC-77' });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
  });

  it('attaches the job to a vehicle the garage already knows by its plate', async () => {
    const { client, providerId } = await newGarage();
    const owner = (await client.post('/api/v1/customers', { name: 'Kamal' })).body.data;
    const car = (await client.post('/api/v1/vehicles', { plate: 'CBA-5566', customerId: owner.id, make: 'Honda' })).body.data;
    incidents['INC-90'] = { id: 'INC-90', status: 'ON_SCENE', assignedProviderId: providerId, registrationNo: 'cba 5566', vehicleMake: 'Honda' };
    const job = (await client.post('/api/v1/job-cards/from-dispatch', { incidentId: 'INC-90' })).body.data;
    expect(job.vehicle.id).toBe(car.id);
    expect(job.customer.id).toBe(owner.id);
    expect((await client.get('/api/v1/vehicles')).body.data.total).toBe(1);
  });

  it("refuses a job that went to another provider, or doesn't exist", async () => {
    const { client } = await newGarage();
    incidents['INC-88'] = { id: 'INC-88', status: 'RESOLVED', assignedProviderId: 'someone-else' };
    expect((await client.post('/api/v1/job-cards/from-dispatch', { incidentId: 'INC-88' })).status).toBe(403);
    expect((await client.post('/api/v1/job-cards/from-dispatch', { incidentId: 'INC-404' })).status).toBe(404);
  });
});
