import { Request, Router } from 'express';

import { allow, requireShop } from '../middleware/auth';
import * as cash from '../services/cash';
import * as catalogue from '../services/catalogue';
import * as credits from '../services/credits';
import * as inventory from '../services/inventory';
import * as orders from '../services/orders';
import * as partFiles from '../services/partFiles';
import * as payables from '../services/payables';
import {
  presentAccount,
  presentAudit,
  presentClaim,
  presentCredit,
  presentCount,
  presentDraft,
  presentEntry,
  presentLocation,
  presentMovement,
  presentPart,
  presentPurchase,
  presentRule,
  presentSale,
  presentSession,
  presentShop,
  presentShopOrder,
  presentStaff,
  presentSupplier,
  presentSupplierEntry,
  presentSupplierReturn,
} from '../services/presenters';
import * as purchasing from '../services/purchasing';
import * as reports from '../services/reports';
import * as rules from '../services/rules';
import * as sales from '../services/sales';
import { addDays, localDay, presentAgeing } from '../services/shared';
import * as staff from '../services/staff';
import * as stocktake from '../services/stocktake';
import * as trade from '../services/trade';
import * as warranty from '../services/warranty';
import { DomainError, asyncHandler as h, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import * as v from '../validation';

/**
 * The shop the caller works at. Mounted at /api/v1/shop. Any signed-in
 * account can set up a shop (and owns it); staff the owner adds get in with
 * their role's permissions (see services/staff.ts).
 */
export const shopRouter = Router();

const who = (req: Request) => ({ userId: req.userId!, email: req.userEmail, name: req.userName });
const seesCost = (req: Request) => staff.can(req.actor, 'cost');
const BIG = { timeout: 120_000, maxWait: 10_000 };

shopRouter.get(
  '/',
  h(async (req, res) => {
    const found = await staff.resolveShop(prisma, who(req));
    ok(res, found ? presentShop(found.shop) : null);
  }),
);

shopRouter.put(
  '/',
  h(async (req, res) => {
    const body = v.shopPatch.parse(req.body);
    const found = await staff.resolveShop(prisma, who(req));
    if (found) {
      staff.assertCan(found.actor, 'settings');
      const { maxDiscountPct, ...rest } = body;
      const shop = await prisma.shop.update({ where: { id: found.shop.id }, data: { ...rest, ...(maxDiscountPct !== undefined ? { maxDiscountPct } : {}) } });
      await staff.audit(prisma, shop.id, found.actor, 'shop.settings', `Changed the shop settings (${Object.keys(body).join(', ')})`);
      ok(res, presentShop(shop));
      return;
    }
    const data = v.shopInput.parse(req.body);
    ok(res, presentShop(await prisma.shop.create({ data: { ...data, ownerUserId: req.userId!, ownerName: req.userName ?? null } })), 201);
  }),
);

// Everything below needs a shop the caller works at.
shopRouter.use(requireShop);

shopRouter.put(
  '/pin',
  h(async (req, res) => {
    await staff.setPin(prisma, req.shop!, req.actor!, v.pinInput.parse(req.body).pin);
    ok(res, { hasPin: true });
  }),
);

// ─── Numbers ────────────────────────────────────────────────────────────────

shopRouter.get(
  '/dashboard',
  allow('reports'),
  h(async (req, res) => {
    ok(res, await reports.dashboard(prisma, req.shop!.id));
  }),
);

shopRouter.get(
  '/reports',
  allow('reports'),
  h(async (req, res) => {
    const q = v.reportQuery.parse(req.query);
    const today = localDay(new Date());
    const to = q.to ?? today;
    const from = q.from ?? `${today.slice(0, 8)}01`;
    if (from > to) throw new DomainError(422, '"from" must be on or before "to"');
    if (addDays(from, 366) < to) throw new DomainError(422, 'Pick a range of a year or less');
    ok(res, await reports.report(prisma, req.shop!.id, from, to));
  }),
);

shopRouter.get(
  '/reports/stock',
  allow('reports'),
  h(async (req, res) => {
    ok(res, await reports.stockReport(prisma, req.shop!.id, v.stockReportQuery.parse(req.query).deadDays));
  }),
);

shopRouter.get(
  '/reports/ageing',
  allow('reports'),
  h(async (req, res) => {
    ok(res, await reports.ageing(prisma, req.shop!.id));
  }),
);

shopRouter.get(
  '/audit',
  allow('reports'),
  h(async (req, res) => {
    ok(res, (await staff.listAudit(prisma, req.shop!.id, v.auditQuery.parse(req.query))).map(presentAudit));
  }),
);

// ─── Staff ──────────────────────────────────────────────────────────────────

shopRouter.get(
  '/staff',
  allow('staff'),
  h(async (req, res) => {
    ok(res, (await staff.listStaff(prisma, req.shop!.id)).map(presentStaff));
  }),
);

shopRouter.post(
  '/staff',
  allow('staff'),
  h(async (req, res) => {
    ok(res, presentStaff(await staff.addStaff(prisma, req.shop!, req.actor!, v.staffInput.parse(req.body))), 201);
  }),
);

shopRouter.patch(
  '/staff/:id',
  allow('staff'),
  h(async (req, res) => {
    ok(res, presentStaff(await staff.updateStaff(prisma, req.shop!, req.actor!, req.params.id, v.staffPatch.parse(req.body))));
  }),
);

// ─── Cash drawer ────────────────────────────────────────────────────────────

async function sessionView(shopId: string, id: string) {
  const s = await cash.getSession(prisma, shopId, id);
  return presentSession(s, await cash.summary(prisma, s));
}

shopRouter.get(
  '/cash/current',
  h(async (req, res) => {
    const s = await cash.openSessionOf(prisma, req.shop!.id, req.userId!);
    ok(res, s ? await sessionView(req.shop!.id, s.id) : null);
  }),
);

shopRouter.get(
  '/cash/sessions',
  h(async (req, res) => {
    ok(res, (await cash.listSessions(prisma, req.shop!.id, req.actor!, v.sessionsQuery.parse(req.query))).map((s) => presentSession(s)));
  }),
);

shopRouter.post(
  '/cash/sessions',
  allow('sell', 'cash'),
  h(async (req, res) => {
    const body = v.openSessionInput.parse(req.body);
    const s = await prisma.$transaction((tx) => cash.openSession(tx, req.shop!, req.actor!, body));
    ok(res, await sessionView(req.shop!.id, s.id), 201);
  }),
);

shopRouter.get(
  '/cash/sessions/:id',
  h(async (req, res) => {
    const s = await cash.getSession(prisma, req.shop!.id, req.params.id);
    cash.assertDrawerAccess(s, req.actor!);
    ok(res, await sessionView(req.shop!.id, s.id));
  }),
);

shopRouter.post(
  '/cash/sessions/:id/movements',
  allow('cash'),
  h(async (req, res) => {
    await cash.addMovement(prisma, req.shop!, req.actor!, req.params.id, v.cashMovementInput.parse(req.body));
    ok(res, await sessionView(req.shop!.id, req.params.id), 201);
  }),
);

shopRouter.post(
  '/cash/sessions/:id/close',
  allow('sell', 'cash'),
  h(async (req, res) => {
    const body = v.closeSessionInput.parse(req.body);
    await prisma.$transaction((tx) => cash.closeSession(tx, req.shop!, req.actor!, req.params.id, body));
    ok(res, await sessionView(req.shop!.id, req.params.id));
  }),
);

// ─── Inventory ──────────────────────────────────────────────────────────────

shopRouter.get(
  '/parts',
  h(async (req, res) => {
    const q = v.partsQuery.parse(req.query);
    const { items, total } = await inventory.listParts(prisma, req.shop!.id, q);
    ok(res, { items: items.map((p) => presentPart(p, seesCost(req))), total, limit: q.limit, offset: q.offset });
  }),
);

shopRouter.post(
  '/parts',
  allow('catalogue'),
  h(async (req, res) => {
    const body = v.partInput.parse(req.body);
    const part = await prisma.$transaction((tx) => inventory.createPart(tx, req.shop!.id, body, req.actor!.name));
    await staff.audit(prisma, req.shop!.id, req.actor!, 'catalogue.add', `Added ${part.name} (${part.sku}) at ${part.retailPrice.toFixed(2)}`, { entity: 'part', entityId: part.id });
    ok(res, await partView(req, part.id), 201);
  }),
);

shopRouter.get(
  '/parts/lookup',
  h(async (req, res) => {
    const part = await inventory.lookup(prisma, req.shop!.id, v.lookupQuery.parse(req.query).code);
    ok(res, part ? presentPart(part, seesCost(req)) : null);
  }),
);

shopRouter.get(
  '/parts/export',
  allow('catalogue'),
  h(async (req, res) => {
    ok(res, await catalogue.exportCsv(prisma, req.shop!.id, seesCost(req)));
  }),
);

shopRouter.post(
  '/parts/import',
  allow('catalogue'),
  h(async (req, res) => {
    const { csv, dryRun } = v.importInput.parse(req.body);
    ok(res, await prisma.$transaction((tx) => catalogue.importCsv(tx, req.shop!, req.actor!, csv, dryRun), BIG));
  }),
);

shopRouter.post(
  '/parts/barcodes',
  allow('catalogue'),
  h(async (req, res) => {
    const { partIds } = v.barcodesInput.parse(req.body);
    ok(res, { assigned: await prisma.$transaction((tx) => catalogue.assignBarcodes(tx, req.shop!, req.actor!, partIds), BIG) });
  }),
);

shopRouter.get(
  '/categories',
  h(async (req, res) => {
    ok(res, await inventory.categories(prisma, req.shop!.id));
  }),
);

async function partView(req: Request, id: string) {
  const { part, movements, onOrder } = await inventory.partDetail(prisma, req.shop!.id, id);
  return {
    ...presentPart(part, seesCost(req)),
    onOrder: onOrder.toNumber(),
    files: await Promise.all(part.files.map(partFiles.presentFile)),
    substitutes: part.substitutes.map((x) => ({ note: x.note, part: presentPart(x.substitute, seesCost(req)) })),
    movements: movements.map((m) => presentMovement(m, seesCost(req))),
  };
}

shopRouter.get(
  '/parts/:id',
  h(async (req, res) => {
    ok(res, await partView(req, req.params.id));
  }),
);

shopRouter.get(
  '/parts/:id/trade',
  h(async (req, res) => {
    const cost = seesCost(req);
    const t = await inventory.partTrade(prisma, req.shop!.id, req.params.id, cost && (staff.can(req.actor, 'purchasing') || staff.can(req.actor, 'reports')));
    const n = (d: { toNumber(): number } | null) => (d == null ? null : d.toNumber());
    ok(res, {
      sales: t.sales.map((i) => ({
        saleId: i.sale.id, number: i.sale.number, createdAt: i.sale.createdAt, customerName: i.sale.customerName, plate: i.sale.plate, cashierName: i.sale.cashierName, voided: Boolean(i.sale.voidedAt),
        quantity: i.quantity.toNumber(), returnedQty: i.returnedQty.toNumber(), unitPrice: i.unitPrice.toNumber(), discount: i.discount.toNumber(), serialNumber: i.serialNumber, unitCost: cost ? i.unitCost.toNumber() : null,
      })),
      orders: t.orders.map((i) => ({ orderId: i.order.id, number: i.order.number, status: i.order.status, garageName: i.order.account.garageName, createdAt: i.order.createdAt, completedAt: i.order.completedAt, quantity: i.quantity.toNumber(), unitPrice: n(i.unitPrice) })),
      purchases: t.purchases.map((i) => ({ purchaseId: i.purchase.id, number: i.purchase.number, status: i.purchase.status, supplier: i.purchase.supplier, createdAt: i.purchase.createdAt, receivedAt: i.purchase.receivedAt, quantity: i.quantity.toNumber(), receivedQty: i.receivedQty.toNumber(), unitCost: i.unitCost.toNumber() })),
      suppliers: t.suppliers.map((x) => ({ id: x.id, name: x.name, lastCost: x.lastCost.toNumber(), bestCost: x.bestCost.toNumber(), lastAt: x.lastAt, bought: x.bought.toNumber() })),
    });
  }),
);

shopRouter.post(
  '/parts/:id/transfer',
  allow('stock'),
  h(async (req, res) => {
    const body = v.transferInput.parse(req.body);
    const part = await prisma.$transaction((tx) => inventory.transfer(tx, req.shop!.id, req.params.id, body, req.actor!.name));
    const from = part.stock.find((x) => x.locationId === body.fromLocationId)?.location.name ?? '?';
    const to = part.stock.find((x) => x.locationId === body.toLocationId)?.location.name ?? '?';
    await staff.audit(prisma, req.shop!.id, req.actor!, 'stock.move', `${part.name}: moved ${body.quantity} from ${from} to ${to}`, { entity: 'part', entityId: part.id });
    ok(res, await partView(req, part.id));
  }),
);

shopRouter.put(
  '/parts/:id/substitutes',
  allow('catalogue'),
  h(async (req, res) => {
    const body = v.substituteInput.parse(req.body);
    await prisma.$transaction((tx) => inventory.addSubstitute(tx, req.shop!.id, req.params.id, body.partId, body.note));
    ok(res, await partView(req, req.params.id));
  }),
);

shopRouter.delete(
  '/parts/:id/substitutes/:otherId',
  allow('catalogue'),
  h(async (req, res) => {
    await prisma.$transaction((tx) => inventory.removeSubstitute(tx, req.shop!.id, req.params.id, req.params.otherId));
    ok(res, await partView(req, req.params.id));
  }),
);

shopRouter.post(
  '/parts/:id/files/link',
  allow('catalogue'),
  h(async (req, res) => {
    ok(res, await partFiles.presentFile(await partFiles.addLink(prisma, req.shop!, req.actor!, req.params.id, v.linkInput.parse(req.body))), 201);
  }),
);

shopRouter.post(
  '/parts/:id/files/uploads',
  allow('catalogue'),
  h(async (req, res) => {
    const { file, upload } = await partFiles.startUpload(prisma, req.shop!, req.actor!, req.params.id, v.uploadInput.parse(req.body));
    ok(res, { file: await partFiles.presentFile(file), upload }, 201);
  }),
);

shopRouter.post(
  '/parts/:id/files/:fileId/complete',
  allow('catalogue'),
  h(async (req, res) => {
    ok(res, await partFiles.presentFile(await partFiles.completeUpload(prisma, req.shop!, req.actor!, req.params.id, req.params.fileId)));
  }),
);

shopRouter.patch(
  '/parts/:id/files/:fileId',
  allow('catalogue'),
  h(async (req, res) => {
    ok(res, await partFiles.presentFile(await partFiles.updateFile(prisma, req.shop!, req.params.id, req.params.fileId, v.filePatch.parse(req.body))));
  }),
);

shopRouter.delete(
  '/parts/:id/files/:fileId',
  allow('catalogue'),
  h(async (req, res) => {
    await partFiles.removeFile(prisma, req.shop!, req.actor!, req.params.id, req.params.fileId);
    ok(res, { removed: true });
  }),
);

shopRouter.put(
  '/parts/:id/kit',
  allow('catalogue'),
  h(async (req, res) => {
    const body = v.kitInput.parse(req.body);
    const part = await prisma.$transaction((tx) => inventory.setKit(tx, req.shop!.id, req.params.id, body));
    await staff.audit(prisma, req.shop!.id, req.actor!, 'catalogue.kit', `${part.name} is a kit of ${body.components.length} parts`, { entity: 'part', entityId: part.id });
    ok(res, await partView(req, part.id));
  }),
);

shopRouter.delete(
  '/parts/:id/kit',
  allow('catalogue'),
  h(async (req, res) => {
    await prisma.$transaction((tx) => inventory.unsetKit(tx, req.shop!.id, req.params.id));
    ok(res, await partView(req, req.params.id));
  }),
);

shopRouter.post(
  '/parts/:id/open',
  allow('stock'),
  h(async (req, res) => {
    const body = v.breakInput.parse(req.body);
    const { note } = await prisma.$transaction((tx) => inventory.breakBulk(tx, req.shop!.id, req.params.id, body, req.actor!.name));
    await staff.audit(prisma, req.shop!.id, req.actor!, 'stock.open', note, { entity: 'part', entityId: req.params.id });
    ok(res, await partView(req, req.params.id));
  }),
);

// ─── Locations and tags ─────────────────────────────────────────────────────

shopRouter.get(
  '/locations',
  h(async (req, res) => {
    ok(res, (await inventory.listLocations(prisma, req.shop!.id)).map((r) => presentLocation(r.location, r, seesCost(req))));
  }),
);

shopRouter.post(
  '/locations',
  allow('catalogue', 'stock'),
  h(async (req, res) => {
    const l = await inventory.createLocation(prisma, req.shop!.id, v.locationInput.parse(req.body));
    await staff.audit(prisma, req.shop!.id, req.actor!, 'stock.location', `Added location ${l.name}`, { entity: 'location', entityId: l.id });
    ok(res, presentLocation(l), 201);
  }),
);

shopRouter.patch(
  '/locations/:id',
  allow('catalogue', 'stock'),
  h(async (req, res) => {
    const l = await inventory.updateLocation(prisma, req.shop!.id, req.params.id, v.locationPatch.parse(req.body));
    ok(res, presentLocation(l));
  }),
);

shopRouter.get(
  '/tags',
  h(async (req, res) => {
    ok(res, await inventory.tags(prisma, req.shop!.id));
  }),
);

shopRouter.patch(
  '/parts/:id',
  allow('catalogue'),
  h(async (req, res) => {
    const before = await inventory.getPart(prisma, req.shop!.id, req.params.id);
    const part = await inventory.updatePart(prisma, req.shop!.id, req.params.id, v.partPatch.parse(req.body));
    const price = (label: string, a: { toFixed(n: number): string } | null, b: { toFixed(n: number): string } | null) => (a?.toFixed(2) !== b?.toFixed(2) ? `${label} ${a?.toFixed(2) ?? '-'} to ${b?.toFixed(2) ?? '-'}` : null);
    const changes = [price('retail', before.retailPrice, part.retailPrice), price('trade', before.tradePrice, part.tradePrice), price('cost', before.costPrice, part.costPrice)].filter(Boolean);
    if (changes.length) await staff.audit(prisma, req.shop!.id, req.actor!, 'catalogue.price', `${part.name}: ${changes.join(', ')}`, { entity: 'part', entityId: part.id });
    if (before.active && !part.active) await staff.audit(prisma, req.shop!.id, req.actor!, 'catalogue.remove', `Stopped selling ${part.name} (${part.sku})`, { entity: 'part', entityId: part.id });
    ok(res, await partView(req, part.id));
  }),
);

shopRouter.put(
  '/parts/:id/fitments',
  allow('catalogue'),
  h(async (req, res) => {
    const { fitments } = v.fitmentsInput.parse(req.body);
    await prisma.$transaction((tx) => inventory.replaceFitments(tx, req.shop!.id, req.params.id, fitments));
    ok(res, await partView(req, req.params.id));
  }),
);

shopRouter.post(
  '/parts/:id/adjust',
  allow('stock'),
  h(async (req, res) => {
    const body = v.adjustInput.parse(req.body);
    const { part, change } = await prisma.$transaction((tx) => inventory.adjust(tx, req.shop!.id, req.params.id, body, req.actor!.name));
    if (!change.isZero()) {
      await staff.audit(prisma, req.shop!.id, req.actor!, 'stock.adjust', `${part.name}: ${change.gt(0) ? '+' : ''}${change.toString()} (${body.reason === 'DAMAGED' ? 'damaged' : 'adjusted'})${body.note ? `: ${body.note}` : ''}`, {
        entity: 'part',
        entityId: part.id,
        amount: change.mul(part.costPrice),
      });
    }
    ok(res, await partView(req, part.id));
  }),
);

// ─── Stocktakes ─────────────────────────────────────────────────────────────

shopRouter.get(
  '/stocktakes',
  allow('stock'),
  h(async (req, res) => {
    ok(res, (await stocktake.listCounts(prisma, req.shop!.id)).map((c) => ({ ...presentCount(c, seesCost(req)), lines: [] })));
  }),
);

shopRouter.post(
  '/stocktakes',
  allow('stock'),
  h(async (req, res) => {
    const body = v.stocktakeInput.parse(req.body);
    ok(res, presentCount(await prisma.$transaction((tx) => stocktake.startCount(tx, req.shop!, req.actor!, body), BIG), seesCost(req)), 201);
  }),
);

shopRouter.get(
  '/stocktakes/:id',
  allow('stock'),
  h(async (req, res) => {
    ok(res, presentCount(await stocktake.getCount(prisma, req.shop!.id, req.params.id), seesCost(req)));
  }),
);

shopRouter.put(
  '/stocktakes/:id/lines',
  allow('stock'),
  h(async (req, res) => {
    const body = v.countLinesInput.parse(req.body);
    ok(res, presentCount(await prisma.$transaction((tx) => stocktake.enterCounts(tx, req.shop!, req.actor!, req.params.id, body), BIG), seesCost(req)));
  }),
);

shopRouter.post(
  '/stocktakes/:id/post',
  allow('stock'),
  h(async (req, res) => {
    const body = v.postCountInput.parse(req.body);
    ok(res, presentCount(await prisma.$transaction((tx) => stocktake.postCount(tx, req.shop!, req.actor!, req.params.id, body), BIG), seesCost(req)));
  }),
);

shopRouter.post(
  '/stocktakes/:id/cancel',
  allow('stock'),
  h(async (req, res) => {
    ok(res, presentCount(await stocktake.cancelCount(prisma, req.shop!, req.actor!, req.params.id), seesCost(req)));
  }),
);

// ─── Purchasing ─────────────────────────────────────────────────────────────

shopRouter.get(
  '/suppliers',
  allow('purchasing'),
  h(async (req, res) => {
    const q = v.searchQuery.parse(req.query);
    const rows = await purchasing.listSuppliers(prisma, req.shop!.id, { q: q.q, includeInactive: q.includeInactive === 'true' });
    ok(res, rows.map((r) => ({ ...presentSupplier(r.supplier), partCount: r.parts, openOrders: r.openOrders, balance: r.balance.toNumber() })));
  }),
);

shopRouter.post(
  '/suppliers',
  allow('purchasing'),
  h(async (req, res) => {
    ok(res, presentSupplier(await purchasing.createSupplier(prisma, req.shop!.id, v.supplierInput.parse(req.body))), 201);
  }),
);

shopRouter.patch(
  '/suppliers/:id',
  allow('purchasing'),
  h(async (req, res) => {
    ok(res, presentSupplier(await purchasing.updateSupplier(prisma, req.shop!.id, req.params.id, v.supplierPatch.parse(req.body))));
  }),
);

async function statementView(shopId: string, supplierId: string) {
  const st = await payables.supplierStatement(prisma, shopId, supplierId);
  return { supplier: presentSupplier(st.supplier), balance: st.balance.toNumber(), ageing: presentAgeing(st.ageing), entries: st.lines.map((l) => presentSupplierEntry(l.entry, l.purchaseNumber, l.balance)) };
}

shopRouter.get(
  '/suppliers/:id/statement',
  allow('purchasing'),
  h(async (req, res) => {
    ok(res, await statementView(req.shop!.id, req.params.id));
  }),
);

shopRouter.post(
  '/suppliers/:id/bills',
  allow('purchasing'),
  h(async (req, res) => {
    await payables.addBill(prisma, req.shop!.id, req.actor!, req.params.id, v.billInput.parse(req.body));
    ok(res, await statementView(req.shop!.id, req.params.id), 201);
  }),
);

shopRouter.post(
  '/suppliers/:id/payments',
  allow('purchasing'),
  h(async (req, res) => {
    const body = v.supplierPaymentInput.parse(req.body);
    const drawer = await cash.drawerFor(prisma, req.shop!, req.actor!, body.method === 'CASH');
    await payables.paySupplier(prisma, req.shop!.id, req.actor!, req.params.id, body, drawer);
    ok(res, await statementView(req.shop!.id, req.params.id), 201);
  }),
);

shopRouter.post(
  '/suppliers/:id/adjustments',
  allow('purchasing'),
  h(async (req, res) => {
    await payables.adjustSupplier(prisma, req.shop!.id, req.actor!, req.params.id, v.supplierAdjustmentInput.parse(req.body));
    ok(res, await statementView(req.shop!.id, req.params.id), 201);
  }),
);

shopRouter.get(
  '/payables',
  allow('purchasing'),
  h(async (req, res) => {
    const rows = await payables.payables(prisma, req.shop!.id);
    ok(res, rows.map((r) => ({ supplier: presentSupplier(r.supplier), balance: r.balance.toNumber(), ageing: presentAgeing(r.ageing) })));
  }),
);

shopRouter.get(
  '/supplier-returns',
  allow('purchasing'),
  h(async (req, res) => {
    const supplierId = typeof req.query.supplierId === 'string' ? req.query.supplierId : undefined;
    ok(res, (await payables.listSupplierReturns(prisma, req.shop!.id, supplierId)).map(presentSupplierReturn));
  }),
);

shopRouter.post(
  '/supplier-returns',
  allow('purchasing'),
  h(async (req, res) => {
    const body = v.supplierReturnInput.parse(req.body);
    ok(res, presentSupplierReturn(await prisma.$transaction((tx) => payables.returnToSupplier(tx, req.shop!, req.actor!, body))), 201);
  }),
);

shopRouter.get(
  '/reorder',
  allow('purchasing'),
  h(async (req, res) => {
    const groups = await purchasing.reorderList(prisma, req.shop!.id);
    ok(
      res,
      groups.map((g) => ({
        supplier: g.supplier ? presentSupplier(g.supplier) : null,
        lines: g.lines.map((l) => ({ part: presentPart(l.part), suggested: l.suggested, onOrder: l.onOrder })),
      })),
    );
  }),
);

shopRouter.get(
  '/purchases',
  allow('purchasing'),
  h(async (req, res) => {
    ok(res, (await purchasing.listPurchases(prisma, req.shop!.id, v.purchasesQuery.parse(req.query))).map(presentPurchase));
  }),
);

shopRouter.post(
  '/purchases',
  allow('purchasing'),
  h(async (req, res) => {
    const body = v.purchaseInput.parse(req.body);
    ok(res, presentPurchase(await prisma.$transaction((tx) => purchasing.createPurchase(tx, req.shop!.id, body))), 201);
  }),
);

shopRouter.get(
  '/purchases/:id',
  allow('purchasing'),
  h(async (req, res) => {
    ok(res, presentPurchase(await purchasing.getPurchase(prisma, req.shop!.id, req.params.id)));
  }),
);

shopRouter.patch(
  '/purchases/:id',
  allow('purchasing'),
  h(async (req, res) => {
    const body = v.purchasePatch.parse(req.body);
    ok(res, presentPurchase(await prisma.$transaction((tx) => purchasing.updatePurchase(tx, req.shop!.id, req.params.id, body))));
  }),
);

shopRouter.post(
  '/purchases/:id/order',
  allow('purchasing'),
  h(async (req, res) => {
    ok(res, presentPurchase(await purchasing.placePurchase(prisma, req.shop!.id, req.params.id)));
  }),
);

shopRouter.post(
  '/purchases/:id/receive',
  allow('purchasing'),
  h(async (req, res) => {
    const body = v.receiveInput.parse(req.body);
    ok(res, presentPurchase(await prisma.$transaction((tx) => purchasing.receive(tx, req.shop!.id, req.actor!, req.params.id, body), BIG)));
  }),
);

shopRouter.post(
  '/purchases/:id/cancel',
  allow('purchasing'),
  h(async (req, res) => {
    ok(res, presentPurchase(await purchasing.cancelPurchase(prisma, req.shop!.id, req.params.id)));
  }),
);

// ─── Counter sales ──────────────────────────────────────────────────────────

shopRouter.get(
  '/sales',
  allow('sell', 'reports'),
  h(async (req, res) => {
    ok(res, (await sales.listSales(prisma, req.shop!.id, v.salesQuery.parse(req.query))).map(presentSale));
  }),
);

shopRouter.post(
  '/sales',
  allow('sell'),
  h(async (req, res) => {
    const body = v.saleInput.parse(req.body);
    ok(res, presentSale(await prisma.$transaction((tx) => sales.createSale(tx, req.shop!, req.actor!, body), BIG)), 201);
  }),
);

shopRouter.get(
  '/sales/:id',
  allow('sell', 'reports'),
  h(async (req, res) => {
    ok(res, presentSale(await sales.getSale(prisma, req.shop!.id, req.params.id)));
  }),
);

shopRouter.post(
  '/sales/:id/returns',
  allow('sell', 'refund'),
  h(async (req, res) => {
    const body = v.returnInput.parse(req.body);
    ok(res, presentSale(await prisma.$transaction((tx) => sales.createReturn(tx, req.shop!, req.actor!, req.params.id, body))), 201);
  }),
);

shopRouter.post(
  '/sales/:id/void',
  allow('sell', 'void'),
  h(async (req, res) => {
    const body = v.voidInput.parse(req.body);
    ok(res, presentSale(await prisma.$transaction((tx) => sales.voidSale(tx, req.shop!, req.actor!, req.params.id, body))));
  }),
);

shopRouter.post(
  '/sales/:id/exchange',
  allow('sell'),
  h(async (req, res) => {
    const body = v.exchangeInput.parse(req.body);
    const x = await prisma.$transaction((tx) => sales.exchange(tx, req.shop!, req.actor!, req.params.id, body), BIG);
    ok(res, { original: presentSale(x.original), sale: presentSale(x.sale), credit: x.credit ? presentCredit(x.credit) : null, returned: x.returned.toNumber(), due: x.due.toNumber(), refunded: x.refunded.toNumber() }, 201);
  }),
);

// ─── Store credit ───────────────────────────────────────────────────────────

shopRouter.get(
  '/credits',
  allow('sell', 'reports'),
  h(async (req, res) => {
    ok(res, (await credits.listCredits(prisma, req.shop!.id, v.creditsQuery.parse(req.query))).map(presentCredit));
  }),
);

shopRouter.get(
  '/credits/:code',
  allow('sell', 'reports'),
  h(async (req, res) => {
    ok(res, presentCredit(await credits.findCredit(prisma, req.shop!.id, req.params.code)));
  }),
);

shopRouter.post(
  '/credits/:id/cancel',
  allow('refund'),
  h(async (req, res) => {
    ok(res, presentCredit(await credits.cancelCredit(prisma, req.shop!.id, req.actor!, req.params.id, v.creditCancelInput.parse(req.body).note)));
  }),
);

// ─── Warranty claims ────────────────────────────────────────────────────────

const claimView = (c: Awaited<ReturnType<typeof warranty.getClaim>>) => presentClaim(c, warranty.suggestedCharge(c));

shopRouter.get(
  '/warranty/claims',
  allow('sell', 'reports', 'purchasing'),
  h(async (req, res) => {
    ok(res, (await warranty.listClaims(prisma, req.shop!.id, v.claimsQuery.parse(req.query))).map(claimView));
  }),
);

shopRouter.post(
  '/warranty/claims',
  allow('sell'),
  h(async (req, res) => {
    const body = v.claimInput.parse(req.body);
    ok(res, claimView(await prisma.$transaction((tx) => warranty.openClaim(tx, req.shop!, req.actor!, body))), 201);
  }),
);

shopRouter.get(
  '/warranty/claims/:id',
  allow('sell', 'reports', 'purchasing'),
  h(async (req, res) => {
    ok(res, claimView(await warranty.getClaim(prisma, req.shop!.id, req.params.id)));
  }),
);

shopRouter.post(
  '/warranty/claims/:id/resolve',
  allow('sell'),
  h(async (req, res) => {
    const body = v.resolveClaimInput.parse(req.body);
    ok(res, claimView(await prisma.$transaction((tx) => warranty.resolveClaim(tx, req.shop!, req.actor!, req.params.id, body), BIG)));
  }),
);

shopRouter.post(
  '/warranty/claims/:id/supplier',
  allow('purchasing'),
  h(async (req, res) => {
    const body = v.supplierClaimInput.parse(req.body);
    ok(res, claimView(await prisma.$transaction((tx) => warranty.supplierClaim(tx, req.shop!, req.actor!, req.params.id, body))));
  }),
);

// ─── Return rules ───────────────────────────────────────────────────────────

shopRouter.get(
  '/return-rules',
  h(async (req, res) => {
    ok(res, (await rules.listRules(prisma, req.shop!.id)).map(presentRule));
  }),
);

shopRouter.put(
  '/return-rules',
  allow('settings'),
  h(async (req, res) => {
    const body = v.returnRulesInput.parse(req.body);
    const saved = await prisma.$transaction((tx) => rules.setRules(tx, req.shop!.id, body));
    await staff.audit(prisma, req.shop!.id, req.actor!, 'shop.settings', `Changed the return rules (${saved.length})`);
    ok(res, saved.map(presentRule));
  }),
);

shopRouter.get(
  '/warranty',
  allow('sell', 'reports'),
  h(async (req, res) => {
    const items = await sales.warrantyLookup(prisma, req.shop!.id, v.warrantyQuery.parse(req.query).q);
    const now = Date.now();
    ok(
      res,
      items.map((i) => ({
        sale: { id: i.sale.id, number: i.sale.number, createdAt: i.sale.createdAt, customerName: i.sale.customerName, customerPhone: i.sale.customerPhone, voided: Boolean(i.sale.voidedAt) },
        item: { id: i.id, partId: i.partId, description: i.description, serialNumber: i.serialNumber, quantity: i.quantity.toNumber(), returnedQty: i.returnedQty.toNumber() },
        warrantyUntil: i.warrantyUntil,
        covered: Boolean(i.warrantyUntil && i.warrantyUntil.getTime() > now && !i.sale.voidedAt && i.returnedQty.lt(i.quantity)),
      })),
    );
  }),
);

shopRouter.get(
  '/drafts',
  allow('sell'),
  h(async (req, res) => {
    ok(res, (await sales.listDrafts(prisma, req.shop!.id, v.draftsQuery.parse(req.query))).map(presentDraft));
  }),
);

shopRouter.post(
  '/drafts',
  allow('sell'),
  h(async (req, res) => {
    const body = v.draftInput.parse(req.body);
    ok(res, presentDraft(await prisma.$transaction((tx) => sales.saveDraft(tx, req.shop!, req.actor!, body))), 201);
  }),
);

shopRouter.get(
  '/drafts/:id',
  allow('sell'),
  h(async (req, res) => {
    ok(res, presentDraft(await sales.getDraft(prisma, req.shop!.id, req.params.id)));
  }),
);

shopRouter.post(
  '/drafts/:id/cancel',
  allow('sell'),
  h(async (req, res) => {
    ok(res, presentDraft(await sales.cancelDraft(prisma, req.shop!.id, req.params.id)));
  }),
);

// ─── Accounts ───────────────────────────────────────────────────────────────

shopRouter.get(
  '/accounts',
  allow('sell', 'payments', 'accounts'),
  h(async (req, res) => {
    const rows = await trade.listAccounts(prisma, req.shop!.id);
    ok(res, rows.map((r) => presentAccount(r.account, r)));
  }),
);

shopRouter.post(
  '/accounts',
  allow('accounts'),
  h(async (req, res) => {
    const a = await trade.createCustomer(prisma, req.shop!.id, req.actor!, v.customerAccountInput.parse(req.body));
    ok(res, await accountView(req.shop!.id, a.id), 201);
  }),
);

async function accountView(shopId: string, id: string) {
  const account = await trade.getAccount(prisma, shopId, id);
  const st = await trade.statement(prisma, account);
  return {
    ...presentAccount(account, { balance: st.balance, overdue: st.overdue, oldestOverdue: st.oldestOverdue }),
    ageing: presentAgeing(await trade.ageingOf(prisma, account)),
    entries: st.lines.map((l) => presentEntry(l.entry, l.order, l.balance, l.sale)),
  };
}

shopRouter.get(
  '/accounts/:id',
  allow('payments', 'accounts'),
  h(async (req, res) => {
    ok(res, await accountView(req.shop!.id, req.params.id));
  }),
);

shopRouter.patch(
  '/accounts/:id',
  allow('accounts'),
  h(async (req, res) => {
    await trade.updateTerms(prisma, req.shop!.id, req.actor!, req.params.id, v.accountPatch.parse(req.body));
    ok(res, await accountView(req.shop!.id, req.params.id));
  }),
);

shopRouter.post(
  '/accounts/:id/payments',
  allow('payments'),
  h(async (req, res) => {
    const body = v.paymentInput.parse(req.body);
    const drawer = await cash.drawerFor(prisma, req.shop!, req.actor!, body.method === 'CASH');
    await trade.recordPayment(prisma, req.shop!.id, req.actor!, req.params.id, body, drawer);
    ok(res, await accountView(req.shop!.id, req.params.id), 201);
  }),
);

shopRouter.post(
  '/accounts/:id/adjustments',
  allow('accounts'),
  h(async (req, res) => {
    await trade.recordAdjustment(prisma, req.shop!.id, req.actor!, req.params.id, v.adjustmentInput.parse(req.body));
    ok(res, await accountView(req.shop!.id, req.params.id), 201);
  }),
);

// ─── Garage orders ──────────────────────────────────────────────────────────

shopRouter.get(
  '/orders',
  allow('orders'),
  h(async (req, res) => {
    ok(res, (await orders.listShopOrders(prisma, req.shop!.id, v.ordersQuery.parse(req.query))).map(presentShopOrder));
  }),
);

shopRouter.get(
  '/orders/:id',
  allow('orders'),
  h(async (req, res) => {
    ok(res, presentShopOrder(await orders.getShopOrder(prisma, req.shop!.id, req.params.id)));
  }),
);

shopRouter.post(
  '/orders/:id/quote',
  allow('orders'),
  h(async (req, res) => {
    const body = v.quoteInput.parse(req.body);
    const o = await prisma.$transaction((tx) => orders.quote(tx, req.shop!, req.params.id, body));
    await orders.notifyJob(o);
    ok(res, presentShopOrder(o));
  }),
);

shopRouter.post(
  '/orders/:id/decline',
  allow('orders'),
  h(async (req, res) => {
    const { sellerNote } = v.sellerNoteInput.parse(req.body);
    const o = await orders.decline(prisma, req.shop!, req.params.id, sellerNote);
    await orders.notifyJob(o);
    ok(res, presentShopOrder(o));
  }),
);

shopRouter.post(
  '/orders/:id/ready',
  allow('orders'),
  h(async (req, res) => {
    const o = await orders.markReady(prisma, req.shop!, req.params.id);
    await orders.notifyJob(o);
    ok(res, presentShopOrder(o));
  }),
);

shopRouter.post(
  '/orders/:id/complete',
  allow('orders'),
  h(async (req, res) => {
    const { code, paymentMethod } = v.handoverInput.parse(req.body);
    const o = await prisma.$transaction((tx) => orders.complete(tx, req.shop!, req.actor!, req.params.id, code, paymentMethod));
    // Onto the garage's job now; the background loop retries if that service is down.
    await orders.syncJob(prisma, o.id);
    ok(res, presentShopOrder(await orders.getShopOrder(prisma, req.shop!.id, o.id)));
  }),
);
