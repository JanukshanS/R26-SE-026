/**
 * Job cards and the stock they use. The things worth protecting: job numbers
 * never repeat, stock always matches its movement history, and a job's state
 * rules stop work being lost or double-counted.
 */
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/utils/prisma';
import { newGarage } from './helpers';

describe('job numbers', () => {
  it('hands out unique, gap-free numbers even when jobs are created at the same moment', async () => {
    const { client } = await newGarage();
    const results = await Promise.all(Array.from({ length: 10 }, () => client.post('/api/v1/job-cards', {})));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.data.number).sort((x, y) => x - y);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('filters by customer, vehicle and "still needs work"', async () => {
    const { client } = await newGarage();
    const nimal = (await client.post('/api/v1/customers', { name: 'Nimal' })).body.data;
    const car = (await client.post('/api/v1/vehicles', { plate: 'KA-1001', customerId: nimal.id })).body.data;
    const mine = (await client.post('/api/v1/job-cards', { customerId: nimal.id, vehicleId: car.id })).body.data;
    const other = (await client.post('/api/v1/job-cards', {})).body.data;
    await client.post(`/api/v1/job-cards/${other.id}/status`, { status: 'CANCELLED' });

    const ids = async (query: string) => (await client.get(`/api/v1/job-cards?${query}`)).body.data.items.map((j: { id: string }) => j.id);
    expect(await ids(`customerId=${nimal.id}`)).toEqual([mine.id]);
    expect(await ids(`vehicleId=${car.id}`)).toEqual([mine.id]);
    expect(await ids('active=true')).toEqual([mine.id]);
    expect((await ids('')).length).toBe(2);
  });

  it('numbers each garage separately', async () => {
    const a = await newGarage();
    const b = await newGarage();
    await a.client.post('/api/v1/job-cards', {});
    expect((await b.client.post('/api/v1/job-cards', {})).body.data.number).toBe(1);
  });
});

describe('parts on a job', () => {
  async function setup() {
    const g = await newGarage();
    const part = (await g.client.post('/api/v1/parts', { sku: 'bp-front', name: 'Brake pads (front)', unitPrice: 8500, openingStock: 4, reorderLevel: 2 })).body.data;
    const job = (await g.client.post('/api/v1/job-cards', { complaint: 'Grinding when braking' })).body.data;
    return { ...g, part, job };
  }

  it('takes parts from stock and prices the line from the part', async () => {
    const { client, part, job } = await setup();
    expect(part.sku).toBe('BP-FRONT');
    const res = await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'PART', partId: part.id, quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body.data.items[0]).toMatchObject({ description: 'Brake pads (front)', quantity: 2, unitPrice: 8500, lineTotal: 17000 });
    expect(res.body.data.subtotal).toBe(17000);
    expect((await client.get(`/api/v1/parts/${part.id}`)).body.data).toMatchObject({ stockQty: 2, lowStock: true });
  });

  it('refuses to use more than is in stock', async () => {
    const { client, part, job } = await setup();
    const res = await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'PART', partId: part.id, quantity: 5 });
    expect(res.status).toBe(409);
    expect((await client.get(`/api/v1/parts/${part.id}`)).body.data.stockQty).toBe(4);
  });

  it('puts parts back when the line is removed, and the history adds up', async () => {
    const { client, part, job, garage } = await setup();
    const added = await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'PART', partId: part.id, quantity: 3 });
    const itemId = added.body.data.items[0].id;
    expect((await client.delete(`/api/v1/job-cards/${job.id}/items/${itemId}`)).status).toBe(200);

    const after = (await client.get(`/api/v1/parts/${part.id}`)).body.data;
    expect(after.stockQty).toBe(4);
    const moves = (await client.get(`/api/v1/parts/${part.id}/movements`)).body.data.items;
    expect(moves.map((m: { reason: string }) => m.reason).sort()).toEqual(['JOB_USE', 'PURCHASE', 'RETURN']);
    expect(moves.reduce((sum: number, m: { quantityChange: number }) => sum + m.quantityChange, 0)).toBe(after.stockQty);

    const lowEvents = await prisma.outboxEvent.count({ where: { garageId: garage.id, eventType: 'stock.low' } });
    expect(lowEvents).toBe(1);
  });

  it('charges labour at the garage rate when no price is given', async () => {
    const { client, job } = await setup();
    const res = await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'LABOUR', description: 'Replace front pads', quantity: 1.5 });
    expect(res.body.data.items[0]).toMatchObject({ unitPrice: 2500, lineTotal: 3750 });
  });

  it('needs a description for labour', async () => {
    const { client, job } = await setup();
    expect((await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'LABOUR' })).status).toBe(422);
  });
});

describe('job status', () => {
  it('follows the workflow and refuses jumps', async () => {
    const { client } = await newGarage();
    const job = (await client.post('/api/v1/job-cards', {})).body.data;
    expect((await client.post(`/api/v1/job-cards/${job.id}/status`, { status: 'CLOSED' })).status).toBe(409);
    for (const status of ['IN_PROGRESS', 'WAITING_PARTS', 'IN_PROGRESS', 'READY', 'CLOSED']) {
      const res = await client.post(`/api/v1/job-cards/${job.id}/status`, { status });
      expect(res.status, status).toBe(200);
    }
    const closed = (await client.get(`/api/v1/job-cards/${job.id}`)).body.data;
    expect(closed.closedAt).toBeTruthy();
    expect((await client.patch(`/api/v1/job-cards/${job.id}`, { diagnosis: 'late note' })).status).toBe(409);
  });

  it('returns parts to stock when a job is cancelled', async () => {
    const { client } = await newGarage();
    const part = (await client.post('/api/v1/parts', { sku: 'BAT-1', name: 'Battery 45Ah', openingStock: 3 })).body.data;
    const job = (await client.post('/api/v1/job-cards', {})).body.data;
    await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'PART', partId: part.id, quantity: 1 });
    expect((await client.post(`/api/v1/job-cards/${job.id}/status`, { status: 'CANCELLED' })).status).toBe(200);
    expect((await client.get(`/api/v1/parts/${part.id}`)).body.data.stockQty).toBe(3);
  });

  it('records a job_card.closed event for other services', async () => {
    const { client, garage } = await newGarage();
    const vehicle = (await client.post('/api/v1/vehicles', { plate: 'WP KX 4455', make: 'Toyota', model: 'Aqua' })).body.data;
    const job = (await client.post('/api/v1/job-cards', { vehicleId: vehicle.id, odometerIn: 84200 })).body.data;
    for (const status of ['IN_PROGRESS', 'READY', 'CLOSED']) await client.post(`/api/v1/job-cards/${job.id}/status`, { status });
    const event = await prisma.outboxEvent.findFirst({ where: { garageId: garage.id, eventType: 'job_card.closed' } });
    expect(event?.payload).toMatchObject({ number: 1, odometerIn: 84200, vehicle: { plate: 'WPKX-4455', make: 'Toyota' } });
    expect(event?.publishedAt).toBeNull();
  });
});
