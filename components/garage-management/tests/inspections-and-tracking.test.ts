/**
 * Digital inspections and the customer's tracking link. What matters: the
 * customer only ever approves a price they were shown, the link shows one job
 * and nothing else, and resetting it really revokes it.
 */
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/utils/prisma';
import { anonymous, as, newGarage, newMechanic } from './helpers';

type Item = { id: string; name: string; result: string; approval: string | null; estimate: number | null; jobItemId: string | null };

async function jobWithInspection() {
  const g = await newGarage({ labourRate: 2000, taxRate: 10 });
  const customer = (await g.client.post('/api/v1/customers', { name: 'Dilani Fernando' })).body.data;
  const vehicle = (await g.client.post('/api/v1/vehicles', { plate: 'CAB-4521', make: 'Toyota', model: 'Aqua', customerId: customer.id })).body.data;
  const job = (await g.client.post('/api/v1/job-cards', { customerId: customer.id, vehicleId: vehicle.id, complaint: 'Noise when braking' })).body.data;
  const started = await g.client.post(`/api/v1/job-cards/${job.id}/inspection`, {});
  const items: Item[] = started.body.data.items;
  const pick = (name: string) => items.find((i) => i.name === name)!;
  return { ...g, job, started, pads: pick('Front brake pads'), oil: pick('Engine oil level and condition'), wipers: pick('Wipers and washers') };
}

const track = (token: string) => anonymous().get(`/api/v1/public/track/${token}`);

describe('inspections', () => {
  it('starts from the 25-point checklist, once per job', async () => {
    const { client, job, started } = await jobWithInspection();
    expect(started.status).toBe(201);
    expect(started.body.data.items).toHaveLength(25);
    expect(started.body.data.status).toBe('DRAFT');
    expect((await client.post(`/api/v1/job-cards/${job.id}/inspection`, {})).status).toBe(409);
    expect((await client.get(`/api/v1/job-cards/${job.id}`)).body.data.inspection).toMatchObject({ total: 25, checked: 0 });
  });

  it('sends priced work for approval, and the approved price becomes a job line', async () => {
    const { client, job, pads, oil, wipers } = await jobWithInspection();
    const url = `/api/v1/job-cards/${job.id}/inspection`;
    expect((await client.post(`${url}/send`)).status).toBe(409); // nothing checked yet

    await client.patch(`${url}/items/${oil.id}`, { result: 'OK' });
    await client.patch(`${url}/items/${pads.id}`, { result: 'URGENT', note: '2 mm left', estimate: 12000 });
    await client.patch(`${url}/items/${wipers.id}`, { result: 'ATTENTION', estimate: 3000 });
    const sent = (await client.post(`${url}/send`)).body.data;
    expect(sent.status).toBe('SENT');
    const approvals = Object.fromEntries(sent.items.map((i: Item) => [i.name, i.approval]));
    expect(approvals).toMatchObject({ 'Front brake pads': 'PENDING', 'Wipers and washers': 'PENDING', 'Engine oil level and condition': null });

    // The customer sees the report, minus anything not checked, and decides.
    const token = (await client.get(`/api/v1/job-cards/${job.id}`)).body.data.trackingToken;
    const view = (await track(token)).body.data;
    expect(view.inspection.items.map((i: Item) => i.name).sort()).toEqual(['Engine oil level and condition', 'Front brake pads', 'Wipers and washers']);
    const decide = (itemId: string, decision: string) => anonymous().post(`/api/v1/public/track/${token}/inspection/items/${itemId}`, { decision });
    expect((await decide(pads.id, 'APPROVED')).status).toBe(200);
    expect((await decide(wipers.id, 'DECLINED')).status).toBe(200);
    expect((await decide(oil.id, 'APPROVED')).status).toBe(409); // nothing to decide

    const added = await client.post(`${url}/items/${pads.id}/add-to-job`);
    expect(added.status).toBe(201);
    expect(added.body.data.items).toEqual([expect.objectContaining({ kind: 'LABOUR', description: 'Front brake pads', unitPrice: 12000 })]);
    expect((await client.post(`${url}/items/${pads.id}/add-to-job`)).status).toBe(409);
    expect((await client.post(`${url}/items/${wipers.id}/add-to-job`)).status).toBe(409);
    // Once on the job, the customer can't take it back.
    expect((await decide(pads.id, 'DECLINED')).status).toBe(409);

    const timeline = (await track(token)).body.data.updates.map((u: { note: string | null }) => u.note);
    expect(timeline).toEqual(expect.arrayContaining(['Approved: Front brake pads', 'Declined: Wipers and washers', 'Inspection report is ready: 2 items need your approval']));
    expect(await prisma.outboxEvent.count({ where: { eventType: 'inspection.item_decided', payload: { path: ['jobCardId'], equals: job.id } } })).toBe(2);
  });

  it('asks again when the price of a decided item changes', async () => {
    const { client, job, pads } = await jobWithInspection();
    const url = `/api/v1/job-cards/${job.id}/inspection`;
    await client.patch(`${url}/items/${pads.id}`, { result: 'URGENT', estimate: 12000 });
    await client.post(`${url}/send`);
    // The owner records a phone approval, then the price goes up.
    const approved = (await client.patch(`${url}/items/${pads.id}`, { approval: 'APPROVED' })).body.data.items.find((i: Item) => i.id === pads.id);
    expect(approved.approval).toBe('APPROVED');
    const repriced = (await client.patch(`${url}/items/${pads.id}`, { estimate: 15000 })).body.data.items.find((i: Item) => i.id === pads.id);
    expect(repriced).toMatchObject({ approval: 'PENDING', estimate: 15000 });
    expect((await client.post(`${url}/items/${pads.id}/add-to-job`)).status).toBe(409);
  });

  it('frees an item again when its job line is removed', async () => {
    const { client, job, pads } = await jobWithInspection();
    const url = `/api/v1/job-cards/${job.id}/inspection`;
    await client.patch(`${url}/items/${pads.id}`, { result: 'URGENT', estimate: 12000, approval: 'APPROVED' });
    const line = (await client.post(`${url}/items/${pads.id}/add-to-job`)).body.data.items[0];
    await client.delete(`/api/v1/job-cards/${job.id}/items/${line.id}`);
    const item = (await client.get(url)).body.data.items.find((i: Item) => i.id === pads.id);
    expect(item.jobItemId).toBeNull();
  });
});

describe('inspection queue', () => {
  it("shows a mechanic their jobs and where each inspection stands; 'rest OK' fills the gaps", async () => {
    const g = await newGarage();
    const { member, client: mechanic } = await newMechanic(g.client);
    const mine = (await g.client.post('/api/v1/job-cards', { mechanicId: member.id })).body.data;
    const notMine = (await g.client.post('/api/v1/job-cards', {})).body.data;

    let board = (await mechanic.get('/api/v1/inspections?mine=true')).body.data;
    expect(board.map((r: { job: { id: string } }) => r.job.id)).toEqual([mine.id]);
    expect(board[0].inspection).toBeNull();

    // A mechanic does the whole inspection: start, flag one, the rest OK, send.
    const started = (await mechanic.post(`/api/v1/job-cards/${mine.id}/inspection`, {})).body.data;
    const pads = started.items.find((i: Item) => i.name === 'Front brake pads');
    await mechanic.patch(`/api/v1/job-cards/${mine.id}/inspection/items/${pads.id}`, { result: 'URGENT', estimate: 12000 });
    const rest = (await mechanic.post(`/api/v1/job-cards/${mine.id}/inspection/mark-rest-ok`)).body.data;
    expect(rest.items.filter((i: Item) => i.result === 'NOT_CHECKED')).toHaveLength(0);
    expect(rest.items.find((i: Item) => i.id === pads.id).result).toBe('URGENT');
    expect((await mechanic.post(`/api/v1/job-cards/${mine.id}/inspection/send`)).status).toBe(200);

    board = (await g.client.get('/api/v1/inspections')).body.data;
    const row = board.find((r: { job: { id: string } }) => r.job.id === mine.id);
    expect(row.inspection).toMatchObject({ status: 'SENT', total: 25, checked: 25, urgent: 1, pendingApproval: 1, approvedToAdd: 0 });
    expect(board.find((r: { job: { id: string } }) => r.job.id === notMine.id).inspection).toBeNull();
  });
});

describe('tracking link', () => {
  it("shows the customer their job and nobody else's details", async () => {
    const { client, job } = await jobWithInspection();
    await client.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'LABOUR', description: 'Replace pads', unitPrice: 5000 });
    await client.post(`/api/v1/job-cards/${job.id}/updates`, { note: 'Waiting for pads from the supplier' });
    await client.post(`/api/v1/job-cards/${job.id}/updates`, { note: 'Customer sounds annoyed', public: false });
    const token = (await client.get(`/api/v1/job-cards/${job.id}`)).body.data.trackingToken;

    const res = await track(token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const view = res.body.data;
    expect(view.garage).toMatchObject({ name: 'Test Motors' });
    expect(view.job).toMatchObject({ number: 1, status: 'OPEN', customerName: 'Dilani', vehicle: { plate: 'CAB-4521', make: 'Toyota' } });
    expect(view.items).toEqual([{ kind: 'LABOUR', description: 'Replace pads', quantity: 1, unitPrice: 5000, lineTotal: 5000 }]);
    const notes = view.updates.map((u: { note: string | null }) => u.note);
    expect(notes).toContain('Waiting for pads from the supplier');
    expect(notes).not.toContain('Customer sounds annoyed');
    // A draft inspection stays private.
    expect(view.inspection).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/garageId|providerId|trackingToken|Fernando/);
  });

  it('stops working once reset, and never for a cancelled job', async () => {
    const { client, job } = await jobWithInspection();
    const token = (await client.get(`/api/v1/job-cards/${job.id}`)).body.data.trackingToken;
    expect((await track(token)).status).toBe(200);
    const fresh = (await client.post(`/api/v1/job-cards/${job.id}/tracking/reset`)).body.data.trackingToken;
    expect(fresh).not.toBe(token);
    expect((await track(token)).status).toBe(404);
    expect((await track(fresh)).status).toBe(200);
    await client.post(`/api/v1/job-cards/${job.id}/status`, { status: 'CANCELLED' });
    expect((await track(fresh)).status).toBe(404);
    expect((await track('not-a-real-token')).status).toBe(404);
  });

  it('gives drivers a status-only summary for their Kaduna jobs', async () => {
    const { client, garage } = await newGarage();
    const job = await prisma.jobCard.create({
      data: { garageId: garage.id, number: 99, source: 'KADUNA_DISPATCH', dispatchIncidentId: 'inc-summary-1', trackingToken: `tok-${garage.id}` },
    });
    await client.post(`/api/v1/job-cards/${job.id}/status`, { status: 'IN_PROGRESS' });
    const res = await as('someone-else').get('/api/v1/repairs?incidentIds=inc-summary-1,inc-unknown');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ incidentId: 'inc-summary-1', jobNumber: 99, status: 'IN_PROGRESS', approvalsWaiting: 0, garage: expect.objectContaining({ name: 'Test Motors' }) }),
    ]);
    expect(JSON.stringify(res.body.data)).not.toContain('tok-');
  });
});
