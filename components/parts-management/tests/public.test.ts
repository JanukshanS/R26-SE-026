/**
 * What kaduna.lk shows the public: live shops and their listed parts at the
 * retail price. Never trade prices, costs, stock counts, hidden parts or
 * inactive shops.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { addPart, app, newShop } from './helpers';

const pub = (url: string) => request(app).get(url);

describe('public directory', () => {
  it('lists live shops and finds their listed parts by name or by car, with no private figures', async () => {
    const name = `Public Spares ${Date.now()}`;
    const s = await newShop({ name, city: 'Kandy' });
    const pads = await addPart(s.client, { name: `Brake pads ${name}`, category: 'Brakes' });
    await addPart(s.client, { name: `Hidden ${name}`, listed: false, universal: true, fitments: [] });
    await addPart(s.client, { name: `Vitz pads ${name}`, oemNumber: '11111-00000', openingStock: 0, fitments: [{ make: 'Toyota', model: 'Vitz' }] });

    const shop = (await pub(`/api/v1/public/shops?q=${encodeURIComponent(name)}`)).body.data;
    expect(shop).toEqual([expect.objectContaining({ id: s.shop.id, name, city: 'Kandy', partCount: 2, categories: ['Brakes'] })]);

    const found = (await pub(`/api/v1/public/parts?q=${encodeURIComponent(name)}`)).body.data;
    expect(found.map((p: { name: string }) => p.name).sort()).toEqual([`Brake pads ${name}`, `Vitz pads ${name}`]);
    const p = found.find((x: { id: string }) => x.id === pads.id);
    expect(p).toMatchObject({ price: 5000, inStock: true, shop: { name } });
    for (const field of ['tradePrice', 'costPrice', 'stockQty']) expect(p[field]).toBeUndefined();
    expect(found.find((x: { name: string }) => x.name.startsWith('Vitz')).inStock).toBe(false);

    const aqua = (await pub(`/api/v1/public/parts?q=${encodeURIComponent(name)}&make=Toyota&model=Aqua&year=2015`)).body.data;
    expect(aqua.map((x: { id: string }) => x.id)).toEqual([pads.id]);

    // A shop that switches itself off disappears, parts and all.
    await s.client.put('/api/v1/shop', { active: false });
    expect((await pub(`/api/v1/public/shops?q=${encodeURIComponent(name)}`)).body.data).toEqual([]);
    expect((await pub(`/api/v1/public/parts?q=${encodeURIComponent(name)}`)).body.data).toEqual([]);
  });
});
