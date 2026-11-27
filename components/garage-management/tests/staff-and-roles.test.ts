/**
 * Mechanics: joining with an invite code, and the line between what a
 * mechanic and the owner may do. The owner's money, records and settings must
 * stay out of a mechanic's reach whatever they call.
 */
import { describe, expect, it } from 'vitest';

import { asUser, newGarage, newMechanic } from './helpers';

describe('joining a garage', () => {
  it('links an account with a one-time invite code', async () => {
    const { client: owner, garage } = await newGarage();
    const added = await owner.post('/api/v1/staff', { name: 'Kasun Silva', phone: '0771234567' });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ name: 'Kasun Silva', joined: false });
    expect(added.body.data.inviteCode).toMatch(/^[A-Z2-9]{8}$/);

    const stranger = asUser('user-stranger');
    expect((await stranger.get('/api/v1/me')).body.data).toEqual({ role: null, garage: null, staff: null });
    expect((await stranger.get('/api/v1/job-cards')).status).toBe(403);

    const mechanic = asUser('user-kasun');
    const joined = await mechanic.post('/api/v1/staff/join', { code: added.body.data.inviteCode.toLowerCase() });
    expect(joined.status).toBe(200);
    expect(joined.body.data).toMatchObject({ role: 'MECHANIC', garage: { id: garage.id }, staff: { name: 'Kasun Silva', joined: true, inviteCode: null } });
    expect((await mechanic.get('/api/v1/me')).body.data.role).toBe('MECHANIC');

    // The code is spent.
    expect((await asUser('user-other').post('/api/v1/staff/join', { code: added.body.data.inviteCode })).status).toBe(404);
    const list = (await owner.get('/api/v1/staff')).body.data;
    expect(list[0]).toMatchObject({ joined: true, inviteCode: null });
  });

  it("won't let a garage owner join someone else's garage, or a mechanic join twice", async () => {
    const a = await newGarage();
    const b = await newGarage();
    const invite = (await a.client.post('/api/v1/staff', { name: 'Ruwan' })).body.data.inviteCode;
    expect((await b.client.post('/api/v1/staff/join', { code: invite })).status).toBe(409);

    const { client: mechanic } = await newMechanic(a.client);
    const second = (await b.client.post('/api/v1/staff', { name: 'Same person' })).body.data.inviteCode;
    expect((await mechanic.post('/api/v1/staff/join', { code: second })).status).toBe(409);
  });

  it('locks a mechanic out when switched off, and a new code unlinks the old account', async () => {
    const { client: owner } = await newGarage();
    const { member, client: mechanic } = await newMechanic(owner);
    expect((await mechanic.get('/api/v1/job-cards')).status).toBe(200);

    await owner.patch(`/api/v1/staff/${member.id}`, { active: false });
    expect((await mechanic.get('/api/v1/job-cards')).status).toBe(403);
    expect((await mechanic.get('/api/v1/me')).body.data.role).toBeNull();

    await owner.patch(`/api/v1/staff/${member.id}`, { active: true });
    const fresh = (await owner.post(`/api/v1/staff/${member.id}/invite`)).body.data;
    expect(fresh).toMatchObject({ joined: false });
    expect(fresh.inviteCode).not.toBe(member.inviteCode);
    expect((await mechanic.get('/api/v1/job-cards')).status).toBe(403);
  });
});

describe('what a mechanic may do', () => {
  async function workshop() {
    const g = await newGarage({ labourRate: 2000 });
    const m = await newMechanic(g.client);
    const customer = (await g.client.post('/api/v1/customers', { name: 'Dilani Fernando', phone: '0712223344' })).body.data;
    const job = (await g.client.post('/api/v1/job-cards', { customerId: customer.id, mechanicId: m.member.id })).body.data;
    const part = (await g.client.post('/api/v1/parts', { sku: 'OIL-5W30', name: 'Engine oil 4L', unitPrice: 9000, openingStock: 10 })).body.data;
    return { ...g, mechanic: m, job, part };
  }

  it('works the job: status, lines, diagnosis, timeline', async () => {
    const { job, part, mechanic } = await workshop();
    const m = mechanic.client;
    expect((await m.post(`/api/v1/job-cards/${job.id}/status`, { status: 'IN_PROGRESS' })).status).toBe(200);
    expect((await m.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'PART', partId: part.id })).status).toBe(201);
    expect((await m.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'LABOUR', description: 'Oil change' })).status).toBe(201);
    expect((await m.patch(`/api/v1/job-cards/${job.id}`, { diagnosis: 'Due for service' })).status).toBe(200);
    expect((await m.post(`/api/v1/job-cards/${job.id}/status`, { status: 'READY' })).status).toBe(200);

    const after = (await m.get(`/api/v1/job-cards/${job.id}`)).body.data;
    expect(after).toMatchObject({ status: 'READY', diagnosis: 'Due for service', subtotal: 11000, mechanic: { name: 'Kasun Silva' } });
    expect(after.updates.map((u: { status: string; author: string | null }) => [u.status, u.author])).toEqual([
      ['READY', 'Kasun Silva'],
      ['IN_PROGRESS', 'Kasun Silva'],
      ['OPEN', null],
    ]);
    // The parts list is readable, so they can pick parts for a job.
    expect((await m.get('/api/v1/parts')).status).toBe(200);
    // And "my jobs" means theirs.
    expect((await m.get('/api/v1/job-cards?mine=true')).body.data.items.map((j: { id: string }) => j.id)).toEqual([job.id]);
  });

  it("can't touch money, records, settings or the owner's decisions", async () => {
    const { job, part, mechanic, client: owner } = await workshop();
    const m = mechanic.client;
    await owner.post(`/api/v1/job-cards/${job.id}/items`, { kind: 'LABOUR', description: 'Check' });
    await owner.post(`/api/v1/job-cards/${job.id}/status`, { status: 'IN_PROGRESS' });
    await owner.post(`/api/v1/job-cards/${job.id}/status`, { status: 'READY' });

    const refused: [string, () => Promise<{ status: number }>][] = [
      ['dashboard', () => m.get('/api/v1/dashboard')],
      ['customers', () => m.get('/api/v1/customers')],
      ['invoices', () => m.get('/api/v1/invoices')],
      ['issue invoice', () => m.post(`/api/v1/job-cards/${job.id}/invoice`)],
      ['close job', () => m.post(`/api/v1/job-cards/${job.id}/status`, { status: 'CLOSED' })],
      ['cancel job', () => m.post(`/api/v1/job-cards/${job.id}/status`, { status: 'CANCELLED' })],
      ['reassign', () => m.patch(`/api/v1/job-cards/${job.id}`, { mechanicId: null })],
      ['open job', () => m.post('/api/v1/job-cards', {})],
      ['edit part', () => m.patch(`/api/v1/parts/${part.id}`, { unitPrice: 1 })],
      ['stock', () => m.post(`/api/v1/parts/${part.id}/stock`, { quantityChange: 5, reason: 'PURCHASE' })],
      ['staff', () => m.get('/api/v1/staff')],
      ['suppliers', () => m.get('/api/v1/suppliers')],
      ['reports', () => m.get('/api/v1/reports')],
      ['settings', () => m.put('/api/v1/garage', { name: 'Mine now', labourRate: 0, taxRate: 0 })],
      ['book', () => m.post('/api/v1/appointments', { customerName: 'X', service: 'Y', startsAt: new Date().toISOString() })],
      ['tracking reset', () => m.post(`/api/v1/job-cards/${job.id}/tracking/reset`)],
    ];
    for (const [what, call] of refused) expect((await call()).status, what).toBe(403);
    // Reading the schedule is fine.
    expect((await m.get('/api/v1/appointments')).status).toBe(200);
  });

  it("can't see another garage's jobs", async () => {
    const { mechanic } = await workshop();
    const other = await newGarage();
    const theirs = (await other.client.post('/api/v1/job-cards', {})).body.data;
    expect((await mechanic.client.get(`/api/v1/job-cards/${theirs.id}`)).status).toBe(404);
  });
});
