/**
 * Everything the part page shows: stock by location (and moving it), files
 * (uploaded through the local store's signed links, or S3), substitutes,
 * tags and specifications, and a part's trade. Worth protecting: each
 * location's stock adds up to the part's total and its history, nothing goes
 * below zero anywhere, and a void puts things back where they came from.
 */
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { config } from '../src/config';
import { presignS3 } from '../src/services/storage';
import { prisma } from '../src/utils/prisma';
import { addPart, app, newShop } from './helpers';

const stockAt = async (partId: string) =>
  Object.fromEntries((await prisma.partStock.findMany({ where: { partId }, include: { location: true } })).map((s) => [s.location.name, s.qty.toNumber()]));
const total = async (id: string) => (await prisma.part.findUniqueOrThrow({ where: { id } })).stockQty.toNumber();
const historySum = async (id: string) =>
  (await prisma.stockMovement.aggregate({ where: { partId: id }, _sum: { quantityChange: true } }))._sum.quantityChange?.toNumber() ?? 0;

describe('stock by location', () => {
  it('keeps each location, the total and the history in step through moves, sales, voids and receiving', async () => {
    const { client } = await newShop();
    const part = await addPart(client, { location: 'A1-01', openingStock: 5 });
    expect(part).toMatchObject({ location: 'A1-01', stockByLocation: [{ name: 'A1-01', qty: 5, default: true }] });
    const back = (await client.post('/api/v1/shop/locations', { name: 'Back store' })).body.data;
    expect((await client.post('/api/v1/shop/locations', { name: 'Back store' })).status).toBe(409);
    const a1 = part.defaultLocationId;

    // Move 3 to the back store: the total doesn't change.
    const moved = (await client.post(`/api/v1/shop/parts/${part.id}/transfer`, { fromLocationId: a1, toLocationId: back.id, quantity: 3 })).body.data;
    expect(moved.stockQty).toBe(5);
    expect(await stockAt(part.id)).toEqual({ 'A1-01': 2, 'Back store': 3 });
    expect((await client.post(`/api/v1/shop/parts/${part.id}/transfer`, { fromLocationId: a1, toLocationId: back.id, quantity: 9 })).status).toBe(409);

    // A sale of 4 takes the default location first, then the rest from the back store.
    const sale = (await client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 4 }], paymentMethod: 'CASH' })).body.data;
    expect(await stockAt(part.id)).toEqual({ 'A1-01': 0, 'Back store': 1 });
    // Asking for more than is at one location fails, even if the shop has it elsewhere.
    await client.post('/api/v1/shop/parts/' + part.id + '/adjust', { change: 2 });
    expect((await client.post('/api/v1/shop/sales', { items: [{ partId: part.id, quantity: 2, locationId: back.id }], paymentMethod: 'CASH' })).status).toBe(409);

    // Voiding puts each unit back where it came from.
    await client.post(`/api/v1/shop/sales/${sale.id}/void`, { reason: 'Test' });
    expect(await stockAt(part.id)).toEqual({ 'A1-01': 4, 'Back store': 3 });

    // Counted at one location only.
    await client.post(`/api/v1/shop/parts/${part.id}/adjust`, { countedQty: 1, locationId: back.id });
    expect(await stockAt(part.id)).toEqual({ 'A1-01': 4, 'Back store': 1 });

    // Received into a chosen location.
    const supplier = (await client.post('/api/v1/shop/suppliers', { name: 'S' })).body.data;
    const po = (await client.post('/api/v1/shop/purchases', { supplierId: supplier.id, items: [{ partId: part.id, quantity: 10, unitCost: 3000 }] })).body.data;
    await client.post(`/api/v1/shop/purchases/${po.id}/order`);
    await client.post(`/api/v1/shop/purchases/${po.id}/receive`, { items: [{ itemId: po.items[0].id, quantity: 10, locationId: back.id }] });
    expect(await stockAt(part.id)).toEqual({ 'A1-01': 4, 'Back store': 11 });

    expect(await total(part.id)).toBe(15);
    expect(await historySum(part.id)).toBe(15);
    const detail = (await client.get(`/api/v1/shop/parts/${part.id}`)).body.data;
    expect(detail.movements.filter((m: { reason: string }) => m.reason === 'MOVE')).toHaveLength(2);
    expect(detail.movements[0]).toMatchObject({ reason: 'PURCHASE', locationName: 'Back store' });

    // A location in use can't be retired; the list shows what's in each.
    expect((await client.patch(`/api/v1/shop/locations/${back.id}`, { active: false })).status).toBe(409);
    const locs = (await client.get('/api/v1/shop/locations')).body.data;
    expect(locs.find((l: { name: string }) => l.name === 'Back store')).toMatchObject({ parts: 1, units: 11 });
    expect((await client.get(`/api/v1/shop/parts?locationId=${back.id}`)).body.data.total).toBe(1);
  });

  it('counts each location separately in a stocktake', async () => {
    const { client } = await newShop();
    const part = await addPart(client, { location: 'Front', openingStock: 6 });
    const back = (await client.post('/api/v1/shop/locations', { name: 'Back' })).body.data;
    await client.post(`/api/v1/shop/parts/${part.id}/transfer`, { fromLocationId: part.defaultLocationId, toLocationId: back.id, quantity: 2 });
    const count = (await client.post('/api/v1/shop/stocktakes', {})).body.data;
    expect(count.lines.map((l: { location: { name: string }; expectedQty: number }) => `${l.location.name}:${l.expectedQty}`)).toEqual(['Back:2', 'Front:4']);
    await client.put(`/api/v1/shop/stocktakes/${count.id}/lines`, { lines: [{ partId: part.id, locationId: back.id, countedQty: 1 }, { partId: part.id, countedQty: 4 }] });
    const posted = (await client.post(`/api/v1/shop/stocktakes/${count.id}/post`, {})).body.data;
    expect(posted.progress).toMatchObject({ counted: 2, differences: 1 });
    expect(await stockAt(part.id)).toEqual({ Front: 4, Back: 1 });
    expect(await historySum(part.id)).toBe(5);
  });
});

describe('what the part page shows', () => {
  it('finds parts by tag, spec or description, links substitutes both ways, and lists the trade', async () => {
    const { client } = await newShop();
    const pads = await addPart(client, { description: 'Ceramic, with wear sensor', tags: ['Fast-Moving', 'brakes'], specs: [{ name: 'Thickness', value: '17.5 mm' }] });
    const alt = await addPart(client, { name: 'Akebono pads', sku: 'AK-1', openingStock: 0 });
    expect(pads).toMatchObject({ tags: ['fast-moving', 'brakes'], specs: [{ name: 'Thickness', value: '17.5 mm' }] });
    const names = async (qs: string) => (await client.get(`/api/v1/shop/parts?${qs}`)).body.data.items.map((p: { name: string }) => p.name);
    expect(await names('tag=FAST-MOVING')).toEqual(['Front brake pads']);
    expect(await names('q=17.5')).toEqual(['Front brake pads']);
    expect(await names('q=wear sensor')).toEqual(['Front brake pads']);
    expect((await client.get('/api/v1/shop/tags')).body.data).toEqual(expect.arrayContaining([{ tag: 'fast-moving', parts: 1 }]));

    const linked = (await client.put(`/api/v1/shop/parts/${alt.id}/substitutes`, { partId: pads.id, note: 'Same size' })).body.data;
    expect(linked.substitutes).toEqual([expect.objectContaining({ note: 'Same size', part: expect.objectContaining({ id: pads.id, stockQty: 10 }) })]);
    expect((await client.get(`/api/v1/shop/parts/${pads.id}`)).body.data.substitutes[0].part.id).toBe(alt.id);
    expect((await client.put(`/api/v1/shop/parts/${alt.id}/substitutes`, { partId: alt.id })).status).toBe(422);
    await client.delete(`/api/v1/shop/parts/${pads.id}/substitutes/${alt.id}`);
    expect((await client.get(`/api/v1/shop/parts/${alt.id}`)).body.data.substitutes).toEqual([]);

    const supplier = (await client.post('/api/v1/shop/suppliers', { name: 'Brake Co' })).body.data;
    const po = (await client.post('/api/v1/shop/purchases', { supplierId: supplier.id, items: [{ partId: pads.id, quantity: 4, unitCost: 2800 }] })).body.data;
    await client.post(`/api/v1/shop/purchases/${po.id}/order`);
    await client.post('/api/v1/shop/sales', { items: [{ partId: pads.id, quantity: 2 }], paymentMethod: 'CARD', customerName: 'Nimal' });
    const detail = (await client.get(`/api/v1/shop/parts/${pads.id}`)).body.data;
    expect(detail.onOrder).toBe(4);
    const trade = (await client.get(`/api/v1/shop/parts/${pads.id}/trade`)).body.data;
    expect(trade.sales).toEqual([expect.objectContaining({ quantity: 2, unitPrice: 5000, customerName: 'Nimal' })]);
    expect(trade.purchases).toEqual([expect.objectContaining({ quantity: 4, unitCost: 2800, supplier: { id: supplier.id, name: 'Brake Co' } })]);
    expect(trade.suppliers).toEqual([expect.objectContaining({ name: 'Brake Co', lastCost: 2800, bestCost: 2800 })]);
  });
});

describe('files', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'parts-files-'));
  const was = config.filesDir;
  config.filesDir = dir;
  afterAll(() => {
    config.filesDir = was;
  });
  const local = (url: string) => new URL(url).pathname;

  it('uploads a photo through a signed link, makes it the main photo, and serves it back', async () => {
    const { client } = await newShop();
    const part = await addPart(client);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

    expect((await client.post(`/api/v1/shop/parts/${part.id}/files/uploads`, { name: 'virus.exe', contentType: 'application/x-msdownload', size: 10 })).status).toBe(422);
    expect((await client.post(`/api/v1/shop/parts/${part.id}/files/uploads`, { name: 'huge.jpg', contentType: 'image/jpeg', size: 20_000_000 })).status).toBe(422);

    const start = (await client.post(`/api/v1/shop/parts/${part.id}/files/uploads`, { name: 'front pads.png', contentType: 'image/png', size: bytes.length })).body.data;
    expect(start.file).toMatchObject({ kind: 'IMAGE', status: 'PENDING', url: null });
    // Not there yet.
    expect((await client.post(`/api/v1/shop/parts/${part.id}/files/${start.file.id}/complete`)).status).toBe(409);
    // A tampered link is refused.
    expect((await request(app).put(local(start.upload.url) + 'x').set('Content-Type', 'image/png').send(bytes)).status).toBe(403);
    expect((await request(app).put(local(start.upload.url)).set('Content-Type', 'image/png').send(bytes)).status).toBe(200);
    const done = (await client.post(`/api/v1/shop/parts/${part.id}/files/${start.file.id}/complete`)).body.data;
    expect(done).toMatchObject({ status: 'READY', primary: true, size: bytes.length });

    const got = await request(app).get(local(done.url)).buffer(true);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(Buffer.from(got.body).equals(bytes)).toBe(true);

    const link = (await client.post(`/api/v1/shop/parts/${part.id}/files/link`, { name: 'Bosch datasheet', url: 'https://example.com/pads.pdf', kind: 'DOCUMENT' })).body.data;
    expect(link).toMatchObject({ kind: 'DOCUMENT', url: 'https://example.com/pads.pdf' });
    expect((await client.post(`/api/v1/shop/parts/${part.id}/files/link`, { name: 'x', url: 'javascript:alert(1)' })).status).toBe(422);

    const files = (await client.get(`/api/v1/shop/parts/${part.id}`)).body.data.files;
    expect(files.map((f: { name: string; primary: boolean }) => `${f.name}${f.primary ? '*' : ''}`)).toEqual(['front pads.png*', 'Bosch datasheet']);
    await client.delete(`/api/v1/shop/parts/${part.id}/files/${done.id}`);
    expect((await request(app).get(local(done.url))).status).toBe(404);
  });

  it('signs S3 links exactly as AWS documents them', () => {
    // AWS's own example: "Query string authentication (presigned URL)", GET test.txt.
    const url = presignS3(
      { bucket: 'examplebucket', region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', endpoint: 'https://s3.amazonaws.com', forcePathStyle: false },
      'GET',
      'test.txt',
      86400,
      new Date('2013-05-24T00:00:00Z')
    );
    expect(url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?')).toBe(true);
    expect(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')).toBe(true);
  });
});

describe('import with locations, tags and specs', () => {
  it('puts imported parts in their location and reads tags and specs', async () => {
    const { client } = await newShop();
    const csv = 'sku,name,retail_price,stock,location,tags,specs\r\nBAT-1,Battery 55D23,25000,3,Battery rack,heavy|exchange,Voltage: 12 V; CCA: 480\r\n';
    expect((await client.post('/api/v1/shop/parts/import', { csv, dryRun: false })).body.data).toMatchObject({ applied: true, create: 1 });
    const id = (await client.get('/api/v1/shop/parts?q=BAT-1')).body.data.items[0].id;
    expect((await client.get(`/api/v1/shop/parts/${id}`)).body.data).toMatchObject({
      location: 'Battery rack',
      stockByLocation: [{ name: 'Battery rack', qty: 3, default: true }],
      tags: ['heavy', 'exchange'],
      specs: [{ name: 'Voltage', value: '12 V' }, { name: 'CCA', value: '480' }],
    });
  });
});
