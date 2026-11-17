/**
 * No sign-in: what kaduna.lk shows the public. Live shops, and the parts they
 * list for garages, at the retail price, with whether they're in stock (not
 * how many). Nothing about trade prices, costs, accounts or orders.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { fitsWhere, searchWhere } from '../services/inventory';
import { presentFitment, presentPublicShop } from '../services/presenters';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { publicPartsQuery, publicShopsQuery } from '../validation';

export const publicRouter = Router();

const publicPart: Prisma.PartWhereInput = { active: true, listed: true, shop: { active: true } };

publicRouter.get(
  '/shops',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    const { q } = publicShopsQuery.parse(req.query);
    const contains = q ? { contains: q, mode: 'insensitive' as const } : undefined;
    const shops = await prisma.shop.findMany({
      where: { active: true, ...(contains ? { OR: [{ name: contains }, { city: contains }, { address: contains }] } : {}) },
      include: { _count: { select: { parts: { where: { active: true, listed: true } } } } },
      orderBy: { name: 'asc' },
      take: 200,
    });
    // What each shop carries most of, for the card.
    const cats = shops.length
      ? await prisma.part.groupBy({ by: ['shopId', 'category'], where: { shopId: { in: shops.map((s) => s.id) }, active: true, listed: true, category: { not: null } }, _count: { _all: true } })
      : [];
    ok(
      res,
      shops.map(({ _count, ...s }) => ({
        ...presentPublicShop(s),
        partCount: _count.parts,
        categories: cats
          .filter((c) => c.shopId === s.id)
          .sort((a, b) => b._count._all - a._count._all)
          .slice(0, 4)
          .map((c) => c.category!),
      })),
    );
  }),
);

publicRouter.get(
  '/parts',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    const q = publicPartsQuery.parse(req.query);
    const filters: Prisma.PartWhereInput[] = [publicPart];
    if (q.q) filters.push(searchWhere(q.q));
    const fits = fitsWhere(q);
    if (fits) filters.push(fits);
    if (q.category) filters.push({ category: { equals: q.category, mode: 'insensitive' } });
    if (q.shopId) filters.push({ shopId: q.shopId });
    const parts = await prisma.part.findMany({ where: { AND: filters }, include: { fitments: true, shop: true }, orderBy: [{ stockQty: 'desc' }, { name: 'asc' }], take: q.limit });
    ok(
      res,
      parts.map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        oemNumber: p.oemNumber,
        partNumber: p.partNumber,
        unit: p.unit,
        price: p.retailPrice.toNumber(),
        inStock: p.stockQty.gt(0),
        universal: p.universal,
        fitments: p.fitments.map(presentFitment),
        shop: { id: p.shop.id, name: p.shop.name, city: p.shop.city, address: p.shop.address, phone: p.shop.phone, currency: p.shop.currency },
      })),
    );
  }),
);

publicRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    const rows = await prisma.part.groupBy({ by: ['category'], where: { ...publicPart, category: { not: null } }, _count: { _all: true }, orderBy: { _count: { category: 'desc' } }, take: 24 });
    ok(res, rows.map((r) => ({ category: r.category!, parts: r._count._all })));
  }),
);
