/**
 * Appointments turning into jobs, supplier purchases and spend, invoice
 * branding, and the report adding up to the invoices behind it.
 */
import { describe, expect, it } from 'vitest';

import { newGarage, newMechanic } from './helpers';

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('appointments', () => {
  it('checks a new customer in: creates their records and opens the job, once', async () => {
    const { client } = await newGarage();
    const { member } = await newMechanic(client);
    const booked = await client.post('/api/v1/appointments', {
      customerName: 'Nimal Perera',
      phone: '0771112233',
      plate: 'wp cab 7788',
      service: 'Full service',
      notes: 'Also check the AC',
      startsAt: inHours(2),
      mechanicId: member.id,
    });
    expect(booked.status).toBe(201);
    expect(booked.body.data).toMatchObject({ status: 'BOOKED', plate: 'WPCAB-7788', customerId: null, mechanic: { name: 'Kasun Silva' } });

    const id = booked.body.data.id;
    expect((await client.post(`/api/v1/appointments/${id}/status`, { status: 'CONFIRMED' })).body.data.status).toBe('CONFIRMED');
    const checkIn = await client.post(`/api/v1/appointments/${id}/check-in`);
    expect(checkIn.status).toBe(201);
    const { appointment, job } = checkIn.body.data;
    expect(appointment).toMatchObject({ status: 'ARRIVED', jobNumber: 1, customerName: 'Nimal Perera' });
    expect(job).toMatchObject({ complaint: 'Full service\nAlso check the AC', customer: { name: 'Nimal Perera', phone: '0771112233' }, vehicle: { plate: 'WPCAB-7788' }, mechanic: { id: member.id } });

    const again = await client.post(`/api/v1/appointments/${id}/check-in`);
    expect(again.status).toBe(200);
    expect(again.body.data.job.id).toBe(job.id);
    expect((await client.get('/api/v1/customers')).body.data.total).toBe(1);
    expect((await client.patch(`/api/v1/appointments/${id}`, { service: 'Changed' })).status).toBe(409);
  });

  it('attaches to a vehicle the garage already knows', async () => {
    const { client } = await newGarage();
    const customer = (await client.post('/api/v1/customers', { name: 'Ama' })).body.data;
    const vehicle = (await client.post('/api/v1/vehicles', { plate: 'KA-5050', customerId: customer.id })).body.data;
    const appt = (await client.post('/api/v1/appointments', { customerId: customer.id, plate: 'KA 5050', service: 'Brakes', startsAt: inHours(1) })).body.data;
    const { job } = (await client.post(`/api/v1/appointments/${appt.id}/check-in`)).body.data;
    expect(job.vehicle.id).toBe(vehicle.id);
  });

  it('lists a time window, needs a name, and keeps cancelled bookings out of the workshop', async () => {
    const { client } = await newGarage();
    expect((await client.post('/api/v1/appointments', { service: 'Oil', startsAt: inHours(1) })).status).toBe(422);
    const soon = (await client.post('/api/v1/appointments', { customerName: 'A', service: 'Oil', startsAt: inHours(1) })).body.data;
    await client.post('/api/v1/appointments', { customerName: 'B', service: 'Oil', startsAt: inHours(48) });
    const window = await client.get(`/api/v1/appointments?from=${encodeURIComponent(inHours(0))}&to=${encodeURIComponent(inHours(24))}`);
    expect(window.body.data.map((a: { id: string }) => a.id)).toEqual([soon.id]);
    await client.post(`/api/v1/appointments/${soon.id}/status`, { status: 'CANCELLED' });
    expect((await client.post(`/api/v1/appointments/${soon.id}/check-in`)).status).toBe(409);
  });
});

describe('suppliers', () => {
  it('records purchases against a supplier and keeps the cost price current', async () => {
    const { client } = await newGarage();
    const supplier = (await client.post('/api/v1/suppliers', { name: 'Lanka Auto Parts', phone: '0112345678' })).body.data;
    const part = (await client.post('/api/v1/parts', { sku: 'BP-1', name: 'Brake pads', unitCost: 5000, unitPrice: 8500, openingStock: 2, supplierId: supplier.id })).body.data;
    expect(part.supplierId).toBe(supplier.id);

    const bought = await client.post(`/api/v1/parts/${part.id}/stock`, { quantityChange: 4, reason: 'PURCHASE', supplierId: supplier.id, unitCost: 5500 });
    expect(bought.body.data).toMatchObject({ stockQty: 6, unitCost: 5500 });

    const detail = (await client.get(`/api/v1/suppliers/${supplier.id}`)).body.data;
    expect(detail.totalSpend).toBe(2 * 5000 + 4 * 5500);
    expect(detail.parts.map((p: { sku: string }) => p.sku)).toEqual(['BP-1']);
    expect(detail.purchases).toHaveLength(2);
    expect((await client.get('/api/v1/suppliers')).body.data[0]).toMatchObject({ name: 'Lanka Auto Parts', partCount: 1, totalSpend: 32000 });

    // A part bought for the first time from a supplier takes them as its usual one.
    const filter = (await client.post('/api/v1/parts', { sku: 'OF-1', name: 'Oil filter' })).body.data;
    const firstBuy = await client.post(`/api/v1/parts/${filter.id}/stock`, { quantityChange: 5, reason: 'PURCHASE', supplierId: supplier.id, unitCost: 900 });
    expect(firstBuy.body.data).toMatchObject({ supplierId: supplier.id, unitCost: 900, stockQty: 5 });

    const other = await newGarage();
    expect((await other.client.get(`/api/v1/suppliers/${supplier.id}`)).status).toBe(404);
    expect((await other.client.post('/api/v1/parts', { sku: 'X', name: 'X', supplierId: supplier.id })).status).toBe(404);
  });
});

describe('invoice branding', () => {
  it('saves branding, and leaves it alone when a form only sends the basics', async () => {
    const { client } = await newGarage();
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const saved = await client.put('/api/v1/garage', {
      name: 'Test Motors', labourRate: 2500, taxRate: 0, brandColor: '#0f766e', logoUrl: logo, invoiceTerms: 'Due on collection', bankDetails: 'BOC 1234',
    });
    expect(saved.body.data).toMatchObject({ brandColor: '#0f766e', logoUrl: logo, invoiceTerms: 'Due on collection' });
    const basics = await client.put('/api/v1/garage', { name: 'Test Motors Ltd', labourRate: 2600, taxRate: 0 });
    expect(basics.body.data).toMatchObject({ name: 'Test Motors Ltd', brandColor: '#0f766e', bankDetails: 'BOC 1234' });
    expect((await client.put('/api/v1/garage', { name: 'T', brandColor: 'orange' })).status).toBe(422);
    expect((await client.put('/api/v1/garage', { name: 'T', logoUrl: 'javascript:alert(1)' })).status).toBe(422);
  });
});

describe('reports', () => {
  it('adds up paid invoices, parts cost and mechanics for the range', async () => {
    const { client } = await newGarage({ labourRate: 2000, taxRate: 10 });
    const { member } = await newMechanic(client, 'Saman');
    const part = (await client.post('/api/v1/parts', { sku: 'OIL', name: 'Oil 4L', unitCost: 6000, unitPrice: 9000, openingStock: 5 })).body.data;
    const job = (await client.post('/api/v1/job-cards', { mechanicId: member.id })).body.data;
    await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'PART', partId: part.id, quantity: 1 });
    await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'LABOUR', description: 'Oil change', quantity: 1 });
    for (const status of ['IN_PROGRESS', 'READY', 'CLOSED']) await client.post(`/api/v1/job-cards/${job.id}/status`, { status });
    const invoice = (await client.post(`/api/v1/job-cards/${job.id}/invoice`)).body.data;
    await client.post(`/api/v1/invoices/${invoice.id}/pay`, { method: 'CARD' });
    // Parts on a job still in the workshop aren't a cost of this period's sales.
    const unpaid = (await client.post('/api/v1/job-cards', {})).body.data;
    await client.post(`/api/v1/job-cards/${unpaid.id}/items`, { kind: 'PART', partId: part.id, quantity: 2 });

    const res = await client.get('/api/v1/reports');
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.days).toHaveLength(30);
    expect(r.totals).toMatchObject({ revenue: 12100, net: 11000, tax: 1100, invoices: 1, labour: 2000, parts: 9000, partsCost: 6000, grossProfit: 5000 });
    expect(r.days.reduce((s: number, d: { total: number }) => s + d.total, 0)).toBe(12100);
    expect(r.paymentMethods).toEqual([{ method: 'CARD', count: 1, total: 12100 }]);
    expect(r.jobs).toMatchObject({ opened: 2, walkIn: 2, closed: 1 });
    expect(r.mechanics).toEqual([{ mechanicId: member.id, name: 'Saman', jobsClosed: 1, labour: 2000 }]);
    expect(r.topServices).toEqual([{ description: 'Oil change', count: 1, revenue: 2000 }]);

    expect((await client.get('/api/v1/reports?from=2026-02-01&to=2026-01-01')).status).toBe(422);
    expect((await client.get('/api/v1/reports?from=2020-01-01&to=2026-01-01')).status).toBe(422);
  });
});
