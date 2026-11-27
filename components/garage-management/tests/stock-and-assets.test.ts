/**
 * The garage's own stock-keeping and equipment: locations, categories and
 * barcodes on parts, stocktakes, purchase orders and goods-in, consumables,
 * the tools & equipment register, and customer parts held for jobs.
 */
import { describe, expect, it } from 'vitest';

import { newGarage, newMechanic } from './helpers';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('locations, categories and barcodes', () => {
  it('keeps parts on a shelf, finds them by category, location and barcode, and keeps barcodes unique', async () => {
    const { client } = await newGarage();
    const shelf = (await client.post('/api/v1/locations', { name: 'Shelf A1', note: 'Brakes' })).body.data;
    expect((await client.post('/api/v1/locations', { name: 'shelf a1' })).status).toBe(409);

    const pad = await client.post('/api/v1/parts', { sku: 'bp-1', name: 'Brake pads', category: 'Brakes', barcode: '4791234567890', locationId: shelf.id, unitCost: 3000, unitPrice: 4500, openingStock: 4 });
    expect(pad.status).toBe(201);
    expect(pad.body.data).toMatchObject({ sku: 'BP-1', kind: 'PART', category: 'Brakes', barcode: '4791234567890', locationId: shelf.id, stockQty: 4 });
    await client.post('/api/v1/parts', { sku: 'OIL-1', name: 'Engine oil', category: 'Fluids' });

    expect((await client.post('/api/v1/parts', { sku: 'BP-2', name: 'Clash', barcode: '4791234567890' })).status).toBe(409);
    expect((await client.post('/api/v1/parts', { sku: 'BP-3', name: 'Ghost shelf', locationId: 'nope' })).status).toBe(404);

    const byShelf = (await client.get(`/api/v1/parts?locationId=${shelf.id}`)).body.data.items;
    expect(byShelf.map((p: { sku: string }) => p.sku)).toEqual(['BP-1']);
    expect((await client.get('/api/v1/parts?category=Fluids')).body.data.items).toHaveLength(1);
    expect((await client.get('/api/v1/parts?q=4791234567890')).body.data.items).toHaveLength(1);

    // Editing one field leaves the others alone.
    const renamed = await client.patch(`/api/v1/parts/${pad.body.data.id}`, { name: 'Front brake pads' });
    expect(renamed.body.data).toMatchObject({ name: 'Front brake pads', category: 'Brakes', kind: 'PART', unitPrice: 4500 });

    const locs = (await client.get('/api/v1/locations')).body.data;
    expect(locs[0]).toMatchObject({ name: 'Shelf A1', partCount: 1 });
  });

  it("does not show another garage's locations", async () => {
    const a = await newGarage();
    const b = await newGarage();
    const loc = (await a.client.post('/api/v1/locations', { name: 'Private' })).body.data;
    expect((await b.client.get('/api/v1/locations')).body.data).toEqual([]);
    expect((await b.client.patch(`/api/v1/locations/${loc.id}`, { name: 'Taken' })).status).toBe(404);
    expect((await b.client.post('/api/v1/parts', { sku: 'X', name: 'X', locationId: loc.id })).status).toBe(404);
  });
});

describe('consumables', () => {
  it('uses bulk supplies in the workshop without a job, and never below zero', async () => {
    const { client } = await newGarage();
    const part = (await client.post('/api/v1/parts', { sku: 'CLN-1', name: 'Brake cleaner', kind: 'CONSUMABLE', openingStock: 10, reorderLevel: 3 })).body.data;
    expect(part.kind).toBe('CONSUMABLE');

    const used = await client.post(`/api/v1/parts/${part.id}/stock`, { quantityChange: -8, reason: 'WORKSHOP_USE', note: 'Bay 2 clean-up' });
    expect(used.status).toBe(200);
    expect(used.body.data).toMatchObject({ stockQty: 2, lowStock: true });
    expect((await client.post(`/api/v1/parts/${part.id}/stock`, { quantityChange: 5, reason: 'WORKSHOP_USE' })).status).toBe(409);
    expect((await client.post(`/api/v1/parts/${part.id}/stock`, { quantityChange: -5, reason: 'WORKSHOP_USE' })).status).toBe(409);

    const history = (await client.get(`/api/v1/parts/${part.id}/movements`)).body.data.items;
    expect(history.map((m: { reason: string }) => m.reason)).toContain('WORKSHOP_USE');
    expect((await client.get('/api/v1/parts?kind=CONSUMABLE')).body.data.items).toHaveLength(1);
    expect((await client.get('/api/v1/parts?kind=PART')).body.data.items).toHaveLength(0);
  });
});

describe('stocktake', () => {
  it('corrects stock to the count, and keeps what was expected beside what was found', async () => {
    const { client } = await newGarage();
    const a = (await client.post('/api/v1/parts', { sku: 'A', name: 'Filter', unitCost: 1000, openingStock: 10 })).body.data;
    const b = (await client.post('/api/v1/parts', { sku: 'B', name: 'Belt', unitCost: 500, openingStock: 5 })).body.data;

    const res = await client.post('/api/v1/stock-counts', { note: 'Monthly', lines: [{ partId: a.id, counted: 8 }, { partId: b.id, counted: 5 }] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ lineCount: 2, mismatches: 1, netVarianceValue: -2000, note: 'Monthly' });
    const lineA = res.body.data.lines.find((l: { sku: string }) => l.sku === 'A');
    expect(lineA).toMatchObject({ expected: 10, counted: 8, variance: -2, varianceValue: -2000 });

    expect((await client.get(`/api/v1/parts/${a.id}`)).body.data.stockQty).toBe(8);
    expect((await client.get(`/api/v1/parts/${b.id}`)).body.data.stockQty).toBe(5);
    const moves = (await client.get(`/api/v1/parts/${a.id}/movements`)).body.data.items;
    expect(moves[0]).toMatchObject({ reason: 'COUNT', quantityChange: -2 });
    expect((await client.get('/api/v1/stock-counts')).body.data.total).toBe(1);

    expect((await client.post('/api/v1/stock-counts', { lines: [{ partId: a.id, counted: 1 }, { partId: a.id, counted: 2 }] })).status).toBe(409);
    expect((await client.post('/api/v1/stock-counts', { lines: [{ partId: 'nope', counted: 1 }] })).status).toBe(404);
  });
});

describe('purchase orders', () => {
  it('goes draft, ordered, partly and fully received, booking stock at the order price', async () => {
    const { client } = await newGarage();
    const supplier = (await client.post('/api/v1/suppliers', { name: 'Lanka Auto Parts' })).body.data;
    const pad = (await client.post('/api/v1/parts', { sku: 'P', name: 'Pads', unitCost: 1000 })).body.data;
    const oil = (await client.post('/api/v1/parts', { sku: 'O', name: 'Oil', unitCost: 400 })).body.data;

    const draft = await client.post('/api/v1/purchase-orders', { supplierId: supplier.id, lines: [{ partId: pad.id, quantity: 10, unitCost: 1200 }, { partId: oil.id, quantity: 4, unitCost: 450 }] });
    expect(draft.status).toBe(201);
    expect(draft.body.data).toMatchObject({ number: 1, reference: 'PO-1', status: 'DRAFT', total: 13800, supplierName: 'Lanka Auto Parts' });
    const id = draft.body.data.id;
    const bySku = (lines: { id: string; sku: string }[], sku: string) => lines.find((l) => l.sku === sku)!;
    const padLine = bySku(draft.body.data.lines, 'P');
    const oilLine = bySku(draft.body.data.lines, 'O');

    expect((await client.post(`/api/v1/purchase-orders/${id}/receive`, { lines: [{ lineId: padLine.id, quantity: 1 }] })).status).toBe(409);
    const edited = await client.patch(`/api/v1/purchase-orders/${id}`, { note: 'Urgent', lines: [{ partId: pad.id, quantity: 10, unitCost: 1200 }, { partId: oil.id, quantity: 4, unitCost: 450 }] });
    expect(edited.status).toBe(200);
    const p1 = bySku(edited.body.data.lines, 'P');
    const o1 = bySku(edited.body.data.lines, 'O');
    expect(padLine.id).not.toBe(p1.id); // lines were replaced
    expect(padLine && oilLine).toBeTruthy();

    expect((await client.post(`/api/v1/purchase-orders/${id}/place`)).body.data.status).toBe('ORDERED');
    expect((await client.patch(`/api/v1/purchase-orders/${id}`, { note: 'Too late' })).status).toBe(409);

    const first = await client.post(`/api/v1/purchase-orders/${id}/receive`, { lines: [{ lineId: p1.id, quantity: 6 }] });
    expect(first.body.data.status).toBe('PARTLY_RECEIVED');
    expect((await client.get(`/api/v1/parts/${pad.id}`)).body.data).toMatchObject({ stockQty: 6, unitCost: 1200, supplierId: supplier.id });

    expect((await client.post(`/api/v1/purchase-orders/${id}/receive`, { lines: [{ lineId: p1.id, quantity: 5 }] })).status).toBe(409); // only 4 left to arrive
    const last = await client.post(`/api/v1/purchase-orders/${id}/receive`, { lines: [{ lineId: p1.id, quantity: 4 }, { lineId: o1.id, quantity: 4 }] });
    expect(last.body.data.status).toBe('RECEIVED');
    expect(last.body.data.receivedAt).toBeTruthy();
    expect((await client.get(`/api/v1/parts/${oil.id}`)).body.data.stockQty).toBe(4);
    expect((await client.post(`/api/v1/purchase-orders/${id}/cancel`)).status).toBe(409);

    // The spend shows up against the supplier.
    const detail = (await client.get(`/api/v1/suppliers/${supplier.id}`)).body.data;
    expect(detail.totalSpend).toBe(13800);

    const second = await client.post('/api/v1/purchase-orders', { supplierId: supplier.id, lines: [{ partId: pad.id, quantity: 1, unitCost: 1 }] });
    expect(second.body.data.number).toBe(2);
    expect((await client.post(`/api/v1/purchase-orders/${second.body.data.id}/cancel`)).body.data.status).toBe('CANCELLED');
    expect((await client.get('/api/v1/purchase-orders?status=CANCELLED')).body.data.total).toBe(1);
  });

  it('rejects an unknown supplier or part, and a duplicated part', async () => {
    const { client } = await newGarage();
    const other = await newGarage();
    const supplier = (await client.post('/api/v1/suppliers', { name: 'S' })).body.data;
    const part = (await client.post('/api/v1/parts', { sku: 'P', name: 'P' })).body.data;
    const foreign = (await other.client.post('/api/v1/parts', { sku: 'F', name: 'F' })).body.data;
    expect((await client.post('/api/v1/purchase-orders', { supplierId: 'nope', lines: [{ partId: part.id, quantity: 1, unitCost: 1 }] })).status).toBe(404);
    expect((await client.post('/api/v1/purchase-orders', { supplierId: supplier.id, lines: [{ partId: foreign.id, quantity: 1, unitCost: 1 }] })).status).toBe(404);
    expect((await client.post('/api/v1/purchase-orders', { supplierId: supplier.id, lines: [{ partId: part.id, quantity: 1, unitCost: 1 }, { partId: part.id, quantity: 2, unitCost: 1 }] })).status).toBe(409);
    expect((await client.post('/api/v1/purchase-orders', { supplierId: supplier.id, lines: [] })).status).toBe(422);
  });
});

describe('tools & equipment register', () => {
  it('tracks where a tool is, who has it, and when it is next due a service', async () => {
    const { client } = await newGarage();
    const { member } = await newMechanic(client, 'Kasun');
    const bay = (await client.post('/api/v1/locations', { name: 'Bay 1' })).body.data;

    const lift = await client.post('/api/v1/assets', { name: 'Two-post lift', tag: 'AST-001', category: 'Lifts', serialNo: 'LF-778', cost: 450000, purchaseDate: '2025-01-10', locationId: bay.id, serviceIntervalDays: 180, warrantyUntil: day(200) });
    expect(lift.status).toBe(201);
    expect(lift.body.data).toMatchObject({ name: 'Two-post lift', tag: 'AST-001', locationName: 'Bay 1', condition: 'GOOD', heldById: null, serviceState: expect.any(String) });
    expect(lift.body.data.nextServiceDue).toBe(new Date(Date.parse('2025-01-10') + 180 * 86_400_000).toISOString().slice(0, 10));

    expect((await client.post('/api/v1/assets', { name: 'Dup', tag: 'AST-001' })).status).toBe(409);

    const jack = (await client.post('/api/v1/assets', { name: 'Trolley jack', category: 'Hand tools', nextServiceDue: day(5) })).body.data;
    expect(jack).toMatchObject({ serviceState: 'SOON', dueInDays: 5 });
    const old = (await client.post('/api/v1/assets', { name: 'Old scanner', nextServiceDue: day(-3) })).body.data;
    expect(old).toMatchObject({ serviceState: 'OVERDUE', dueInDays: -3 });

    const out = await client.post(`/api/v1/assets/${jack.id}/check-out`, { staffId: member.id, note: 'For the Aqua job' });
    expect(out.status).toBe(200);
    expect(out.body.data).toMatchObject({ heldById: member.id, heldByName: 'Kasun' });
    expect((await client.post(`/api/v1/assets/${jack.id}/check-out`, { staffId: member.id })).status).toBe(409);
    expect((await client.get('/api/v1/assets?status=out')).body.data.map((a: { name: string }) => a.name)).toEqual(['Trolley jack']);
    expect((await client.get('/api/v1/assets?status=available')).body.data).toHaveLength(2);
    // The lift's last service date (Jan 2025 + 180 days) is long past, so it is due too.
    expect((await client.get('/api/v1/assets?status=due')).body.data.map((a: { name: string }) => a.name).sort()).toEqual(['Old scanner', 'Trolley jack', 'Two-post lift']);
    expect((await client.patch(`/api/v1/assets/${jack.id}`, { active: false })).status).toBe(409);

    const back = await client.post(`/api/v1/assets/${jack.id}/check-in`, { condition: 'NEEDS_REPAIR', note: 'Leaks oil' });
    expect(back.body.data).toMatchObject({ heldById: null, condition: 'NEEDS_REPAIR' });
    expect((await client.post(`/api/v1/assets/${jack.id}/check-in`)).status).toBe(409);
    expect((await client.post(`/api/v1/assets/${jack.id}/check-out`, { staffId: member.id })).status).toBe(409); // needs repair
    expect((await client.get('/api/v1/assets?status=attention')).body.data).toHaveLength(1);

    const serviced = await client.post(`/api/v1/assets/${old.id}/service`, { note: 'Firmware update', nextServiceDue: day(90) });
    expect(serviced.body.data).toMatchObject({ serviceState: 'OK', dueInDays: 90 });
    const fixed = await client.post(`/api/v1/assets/${jack.id}/service`, { note: 'New seal', condition: 'GOOD' });
    expect(fixed.body.data.condition).toBe('GOOD');

    const log = (await client.get(`/api/v1/assets/${jack.id}/log`)).body.data;
    expect(log.map((l: { type: string }) => l.type)).toEqual(expect.arrayContaining(['CHECK_OUT', 'CHECK_IN', 'CONDITION', 'SERVICE']));
    expect(log.find((l: { type: string }) => l.type === 'CHECK_OUT')).toMatchObject({ staffName: 'Kasun', note: 'For the Aqua job' });
  });

  it('is owner-only and private to the garage', async () => {
    const a = await newGarage();
    const b = await newGarage();
    const mech = await newMechanic(a.client);
    const asset = (await a.client.post('/api/v1/assets', { name: 'Compressor' })).body.data;
    expect((await mech.client.get('/api/v1/assets')).status).toBe(403);
    expect((await mech.client.post('/api/v1/assets', { name: 'X' })).status).toBe(403);
    expect((await b.client.get(`/api/v1/assets/${asset.id}`)).status).toBe(404);
    expect((await b.client.post(`/api/v1/assets/${asset.id}/check-out`, { staffId: mech.member.id })).status).toBe(404);
    expect((await a.client.post(`/api/v1/assets/${asset.id}/check-out`, { staffId: 'nope' })).status).toBe(404);
  });
});

describe('customer parts held', () => {
  it("holds a customer's own part for a job, apart from the garage's stock", async () => {
    const { client } = await newGarage();
    const customer = (await client.post('/api/v1/customers', { name: 'Nimal' })).body.data;
    const vehicle = (await client.post('/api/v1/vehicles', { plate: 'CAB-1234', make: 'Toyota', model: 'Aqua', customerId: customer.id })).body.data;
    const job = (await client.post('/api/v1/job-cards', { customerId: customer.id, vehicleId: vehicle.id, complaint: 'Replace battery' })).body.data;
    const shelf = (await client.post('/api/v1/locations', { name: 'Customer shelf' })).body.data;

    const held = await client.post('/api/v1/held-parts', { name: 'Amaron battery 55B24L', quantity: 1, customerId: customer.id, vehicleId: vehicle.id, jobCardId: job.id, locationId: shelf.id, note: 'Bought online' });
    expect(held.status).toBe(201);
    expect(held.body.data).toMatchObject({ name: 'Amaron battery 55B24L', status: 'HELD', customerName: 'Nimal', jobNumber: job.number, locationName: 'Customer shelf', vehicleLabel: 'CAB-1234 · Toyota Aqua' });

    // Not sellable stock.
    expect((await client.get('/api/v1/parts')).body.data.items).toHaveLength(0);
    expect((await client.get('/api/v1/held-parts')).body.data).toHaveLength(1);

    const fitted = await client.patch(`/api/v1/held-parts/${held.body.data.id}`, { status: 'FITTED' });
    expect(fitted.body.data.status).toBe('FITTED');
    expect(fitted.body.data.closedAt).toBeTruthy();
    expect((await client.get('/api/v1/held-parts')).body.data).toHaveLength(0);
    expect((await client.get('/api/v1/held-parts?status=FITTED')).body.data).toHaveLength(1);
    expect((await client.patch(`/api/v1/held-parts/${held.body.data.id}`, { note: 'edit after close' })).status).toBe(409);
    expect((await client.post('/api/v1/held-parts', { name: 'X', customerId: 'nope' })).status).toBe(404);
  });
});
