/**
 * The stockroom: spreadsheet import and export, shop barcodes, and
 * stocktakes. Worth protecting: an import saves all or nothing and never
 * overwrites stock on the shelf; barcodes are valid and unique; and a count
 * taken while the shop keeps selling only corrects real differences.
 */
import { describe, expect, it } from 'vitest';

import { ean13 } from '../src/services/catalogue';
import { prisma } from '../src/utils/prisma';
import { addPart, newShop } from './helpers';

const stockOf = async (id: string) => (await prisma.part.findUniqueOrThrow({ where: { id } })).stockQty.toNumber();
const historySum = async (id: string) =>
  (await prisma.stockMovement.aggregate({ where: { partId: id }, _sum: { quantityChange: true } }))._sum.quantityChange?.toNumber() ?? 0;

describe('import and export', () => {
  it('checks a spreadsheet first, saves all or nothing, and exports the columns it reads', async () => {
    const { client } = await newShop();
    const existing = await addPart(client, { sku: 'EX-1', name: 'Old name', retailPrice: 100, openingStock: 10 });
    const csv = [
      'SKU,Name,Brand,Retail Price,Cost,Qty,Fits,Supplier,Cross Refs,Warranty Months',
      'NEW-1,"Oil filter, Toyota",Denso,1200,800,10,Toyota Aqua 2012-2017; Toyota Axio,Lanka Imports,90915-YZZE1|abc-1,',
      'EX-1,New name,,150,,99,,,,',
      'NEW-2,No price,,,,,,,,',
      'NEW-3,Bad fit,,500,,,Toyota,,,',
    ].join('\n');

    const dry = (await client.post('/api/v1/shop/parts/import', { csv })).body.data;
    expect(dry).toMatchObject({ rows: 4, create: 1, update: 1, applied: false });
    expect(dry.errors.map((e: { row: number }) => e.row)).toEqual([4, 5]);
    // Not even part of it is saved while rows have errors.
    expect((await client.post('/api/v1/shop/parts/import', { csv, dryRun: false })).body.data.applied).toBe(false);
    expect((await client.get('/api/v1/shop/parts?q=NEW-1')).body.data.total).toBe(0);

    const good = csv.split('\n').slice(0, 3).join('\n');
    expect((await client.post('/api/v1/shop/parts/import', { csv: good, dryRun: false })).body.data).toMatchObject({ applied: true, create: 1, update: 1, errors: [] });
    const id = (await client.get('/api/v1/shop/parts?q=NEW-1')).body.data.items[0].id;
    const created = (await client.get(`/api/v1/shop/parts/${id}`)).body.data;
    expect(created).toMatchObject({ name: 'Oil filter, Toyota', brand: 'Denso', retailPrice: 1200, costPrice: 800, stockQty: 10, supplierName: 'Lanka Imports', crossRefs: ['90915-YZZE1', 'ABC-1'] });
    expect(created.fitments.map((f: { make: string; model: string; yearFrom: number | null; yearTo: number | null }) => `${f.make} ${f.model} ${f.yearFrom}-${f.yearTo}`)).toEqual(['Toyota Aqua 2012-2017', 'Toyota Axio null-null']);
    // An existing part: new name and price; its stock is a stocktake's job.
    expect((await client.get(`/api/v1/shop/parts/${existing.id}`)).body.data).toMatchObject({ name: 'New name', retailPrice: 150, stockQty: 10, costPrice: 3000 });

    const out = (await client.get('/api/v1/shop/parts/export')).body.data;
    expect(out.rows).toBe(2);
    expect(out.csv.startsWith('sku,name,brand,category,oem_number')).toBe(true);
    expect((await client.post('/api/v1/shop/parts/import', { csv: out.csv })).body.data).toMatchObject({ create: 0, update: 2, errors: [] });
  });

  it('gives parts without a barcode a valid shop EAN-13 that scans', async () => {
    const { client } = await newShop();
    const plain = await addPart(client);
    await addPart(client, { barcode: '4006381333931' });
    expect((await client.post('/api/v1/shop/parts/barcodes', {})).body.data.assigned).toBe(1);
    const code = (await client.get(`/api/v1/shop/parts/${plain.id}`)).body.data.barcode as string;
    expect(code).toMatch(/^20\d{11}$/);
    expect(ean13(code.slice(0, 12))).toBe(code);
    expect((await client.get(`/api/v1/shop/parts/lookup?code=${code}`)).body.data.id).toBe(plain.id);
    expect((await client.post('/api/v1/shop/parts/barcodes', {})).body.data.assigned).toBe(0);
  });
});

describe('stocktakes', () => {
  it('counts while the shop keeps selling, and posts only the real differences', async () => {
    const { client } = await newShop();
    const a = await addPart(client, { name: 'A pads', location: 'A1-01', openingStock: 10, costPrice: 100 });
    const b = await addPart(client, { name: 'B pads', location: 'A1-02', openingStock: 5, costPrice: 200 });
    const c = await addPart(client, { name: 'C oil', location: 'B2-01', openingStock: 8 });

    const count = (await client.post('/api/v1/shop/stocktakes', { location: 'a1' })).body.data;
    expect(count.progress).toMatchObject({ lines: 2, counted: 0 });
    expect((await client.post('/api/v1/shop/stocktakes', {})).status).toBe(409);

    // A: counted 9 (one missing), then 2 sold during the count.
    await client.put(`/api/v1/shop/stocktakes/${count.id}/lines`, { lines: [{ partId: a.id, countedQty: 9 }] });
    await client.post('/api/v1/shop/sales', { items: [{ partId: a.id, quantity: 2 }], paymentMethod: 'CASH' });
    // B: 1 sold before it was counted, then counted 4: right.
    await client.post('/api/v1/shop/sales', { items: [{ partId: b.id, quantity: 1 }], paymentMethod: 'CASH' });
    const mid = (await client.put(`/api/v1/shop/stocktakes/${count.id}/lines`, { lines: [{ partId: b.id, countedQty: 4 }] })).body.data;
    expect(mid.lines.find((l: { part: { id: string } }) => l.part.id === b.id)).toMatchObject({ expectedQty: 5, countedQty: 4, variance: 0 });
    expect(mid.lines.find((l: { part: { id: string } }) => l.part.id === a.id)).toMatchObject({ variance: -1, varianceValue: -100 });

    const posted = (await client.post(`/api/v1/shop/stocktakes/${count.id}/post`, {})).body.data;
    expect(posted).toMatchObject({ status: 'POSTED', varianceValue: -100, progress: { differences: 1 } });
    expect(await stockOf(a.id)).toBe(7);
    expect(await stockOf(b.id)).toBe(4);
    expect(await stockOf(c.id)).toBe(8);
    expect(await historySum(a.id)).toBe(7);
    expect((await client.put(`/api/v1/shop/stocktakes/${count.id}/lines`, { lines: [{ partId: a.id, countedQty: 1 }] })).status).toBe(409);
    expect((await client.get('/api/v1/shop/stocktakes')).body.data[0]).toMatchObject({ number: 1, status: 'POSTED' });
  });
});
