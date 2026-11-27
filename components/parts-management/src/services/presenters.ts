/**
 * Database rows to API responses: Decimal money and quantities become plain
 * numbers, internal columns are left out, and each side of a garage order
 * sees only what it should (the shop never gets the handover code; a
 * collector never sees prices).
 */
import {
  AccountEntry,
  AuditEvent,
  CashMovement,
  CashSession,
  Location,
  Part,
  PartFitment,
  PartStock,
  Prisma,
  PurchaseOrder,
  PurchaseOrderItem,
  SaleDraft,
  Shop,
  ReturnRule,
  ShopStaff,
  StoreCredit,
  StoreCreditEntry,
  StockMovement,
  Supplier,
  SupplierEntry,
  SupplierReturn,
  TradeAccount,
} from '@prisma/client';

import type { OrderDetail } from './orders';
import type { ClaimDetail } from './warranty';
import type { SaleDetail } from './sales';
import { num } from './shared';
import type { CountDetail } from './stocktake';

const n = (d: Prisma.Decimal) => d.toNumber();
const r2 = (x: number) => Math.round(x * 100) / 100;

export const presentShop = (s: Shop) => ({
  id: s.id,
  name: s.name,
  phone: s.phone,
  email: s.email,
  address: s.address,
  city: s.city,
  registrationNo: s.registrationNo,
  openingHours: s.openingHours,
  delivers: s.delivers,
  deliveryNote: s.deliveryNote,
  currency: s.currency,
  taxRate: n(s.taxRate),
  receiptFooter: s.receiptFooter,
  vatNumber: s.vatNumber,
  receiptWidth: s.receiptWidth,
  maxDiscountPct: n(s.maxDiscountPct),
  requireCashSession: s.requireCashSession,
  active: s.active,
  createdAt: s.createdAt,
});

/** What garages see of a shop. */
export const presentPublicShop = (s: Shop) => ({
  id: s.id,
  name: s.name,
  phone: s.phone,
  email: s.email,
  address: s.address,
  city: s.city,
  openingHours: s.openingHours,
  delivers: s.delivers,
  deliveryNote: s.deliveryNote,
  currency: s.currency,
});

export const presentFitment = (f: PartFitment) => ({ id: f.id, make: f.make, model: f.model, yearFrom: f.yearFrom, yearTo: f.yearTo, note: f.note });

/** withCost false: the caller's role doesn't see cost prices. */
type KitRow = { quantity: Prisma.Decimal; component: { id: string; sku: string; name: string; unit: string; stockQty: Prisma.Decimal; costPrice: Prisma.Decimal; retailPrice: Prisma.Decimal } };
type PackRow = { id: string; sku: string; name: string; unit: string; stockQty: Prisma.Decimal };
type PartRow = Part & {
  fitments?: PartFitment[];
  supplier?: Supplier | null;
  defaultLocation?: Location | null;
  stock?: (PartStock & { location: Location })[];
  kitComponents?: KitRow[];
  breaksInto?: PackRow | null;
  openedFrom?: (PackRow & { breaksIntoQty: Prisma.Decimal | null })[];
};

/** A kit has what its components make; anything else, what's on the shelf. */
const sellable = (p: PartRow) =>
  p.isKit
    ? p.kitComponents?.length
      ? Math.max(0, Math.min(...p.kitComponents.map((c) => Math.floor(n(c.component.stockQty) / n(c.quantity)))))
      : 0
    : n(p.stockQty);

export const presentPart = (p: PartRow, withCost = true) => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  description: p.description,
  brand: p.brand,
  category: p.category,
  oemNumber: p.oemNumber,
  partNumber: p.partNumber,
  crossRefs: p.crossRefs,
  barcode: p.barcode,
  /** The default location's name. */
  location: p.defaultLocation?.name ?? null,
  defaultLocationId: p.defaultLocationId,
  tags: p.tags,
  specs: p.specs as { name: string; value: string }[],
  unit: p.unit,
  costPrice: withCost ? n(p.costPrice) : null,
  retailPrice: n(p.retailPrice),
  tradePrice: num(p.tradePrice),
  taxRate: num(p.taxRate),
  warrantyMonths: p.warrantyMonths,
  coreCharge: num(p.coreCharge),
  serialized: p.serialized,
  fractional: p.fractional,
  quickQtys: p.quickQtys as number[],
  purchaseUnit: p.purchaseUnit,
  purchaseFactor: n(p.purchaseFactor),
  breaksInto: p.breaksIntoId ? { id: p.breaksIntoId, name: p.breaksInto?.name ?? null, unit: p.breaksInto?.unit ?? null, stockQty: p.breaksInto ? n(p.breaksInto.stockQty) : null, qty: num(p.breaksIntoQty) } : null,
  openedFrom: (p.openedFrom ?? []).map((x) => ({ id: x.id, sku: x.sku, name: x.name, stockQty: n(x.stockQty), qty: num(x.breaksIntoQty) })),
  isKit: p.isKit,
  kitComponents: (p.kitComponents ?? []).map((c) => ({ partId: c.component.id, sku: c.component.sku, name: c.component.name, unit: c.component.unit, quantity: n(c.quantity), stockQty: n(c.component.stockQty), costPrice: withCost ? n(c.component.costPrice) : null, retailPrice: n(c.component.retailPrice) })),
  warrantyFreeMonths: p.warrantyFreeMonths,
  /** Kits: how many the components make. */
  stockQty: sellable(p),
  reorderLevel: n(p.reorderLevel),
  reorderQty: n(p.reorderQty),
  lowStock: p.active && !p.isKit && p.stockQty.lte(p.reorderLevel),
  universal: p.universal,
  listed: p.listed,
  active: p.active,
  supplierId: p.supplierId,
  supplierName: p.supplier?.name ?? null,
  notes: p.notes,
  fitments: (p.fitments ?? []).map(presentFitment),
  /** Detail only: how many at each location. */
  stockByLocation: p.stock ? p.stock.map((s) => ({ locationId: s.locationId, name: s.location.name, qty: n(s.qty), default: s.locationId === p.defaultLocationId })) : undefined,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

export const presentLocation = (l: Location, extra?: { parts: number; units: Prisma.Decimal; value: Prisma.Decimal }, withCost = true) => ({
  id: l.id,
  name: l.name,
  note: l.note,
  active: l.active,
  parts: extra?.parts ?? 0,
  units: extra ? n(extra.units) : 0,
  value: extra && withCost ? n(extra.value) : null,
  createdAt: l.createdAt,
});

/** A part as a garage sees it: trade price, availability, no cost. */
export const presentCataloguePart = (p: Part & { fitments: PartFitment[] }) => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  brand: p.brand,
  category: p.category,
  oemNumber: p.oemNumber,
  partNumber: p.partNumber,
  unit: p.unit,
  price: n(p.tradePrice ?? p.retailPrice),
  retailPrice: n(p.retailPrice),
  stockQty: Math.max(0, n(p.stockQty)),
  universal: p.universal,
  fitments: p.fitments.map(presentFitment),
});

export const presentMovement = (m: StockMovement, withCost = true) => ({
  id: m.id,
  partId: m.partId,
  quantityChange: n(m.quantityChange),
  reason: m.reason,
  unitCost: withCost ? num(m.unitCost) : null,
  saleId: m.saleId,
  purchaseId: m.purchaseId,
  orderId: m.orderId,
  note: m.note,
  byName: m.byName,
  locationId: m.locationId,
  locationName: m.locationName,
  createdAt: m.createdAt,
});

export const presentSupplier = (s: Supplier) => ({
  id: s.id,
  name: s.name,
  contactName: s.contactName,
  phone: s.phone,
  email: s.email,
  address: s.address,
  notes: s.notes,
  paymentDays: s.paymentDays,
  active: s.active,
  createdAt: s.createdAt,
});

type PurchaseFull = PurchaseOrder & { supplier: Supplier; items: (PurchaseOrderItem & { part: { id: string; sku: string; name: string; unit: string; stockQty: Prisma.Decimal } })[] };

export const presentPurchase = (po: PurchaseFull) => ({
  id: po.id,
  number: po.number,
  status: po.status,
  supplier: { id: po.supplier.id, name: po.supplier.name, phone: po.supplier.phone },
  expectedAt: po.expectedAt,
  note: po.note,
  orderedAt: po.orderedAt,
  receivedAt: po.receivedAt,
  createdAt: po.createdAt,
  items: po.items.map((i) => ({
    id: i.id,
    part: { id: i.part.id, sku: i.part.sku, name: i.part.name, unit: i.part.unit, stockQty: n(i.part.stockQty) },
    quantity: n(i.quantity),
    unitCost: n(i.unitCost),
    receivedQty: n(i.receivedQty),
    /** Quantity and cost are per this unit (null: the part's own unit); each holds unitFactor of the part. */
    purchaseUnit: i.purchaseUnit,
    unitFactor: n(i.unitFactor),
    lineTotal: r2(n(i.unitCost) * n(i.quantity)),
  })),
  total: r2(po.items.reduce((s, i) => s + n(i.unitCost) * n(i.quantity), 0)),
});

export const presentSale = (s: SaleDetail) => {
  const cash = s.payments.filter((p) => p.method === 'CASH').reduce((t, p) => t + n(p.amount), 0);
  const methods = [...new Set(s.payments.map((p) => p.method))];
  return {
    id: s.id,
    number: s.number,
    customerName: s.customerName,
    customerPhone: s.customerPhone,
    customerAddress: s.customerAddress,
    customerVatNo: s.customerVatNo,
    plate: s.plate,
    account: s.account ? { id: s.account.id, kind: s.account.kind, name: s.account.garageName } : null,
    taxInvoice: s.taxInvoice,
    items: s.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      partId: i.partId,
      description: i.description,
      quantity: n(i.quantity),
      unitPrice: n(i.unitPrice),
      listPrice: num(i.listPrice),
      discount: n(i.discount),
      taxRate: n(i.taxRate),
      tax: n(i.tax),
      lineTotal: r2(n(i.unitPrice) * n(i.quantity) - n(i.discount)),
      returnedQty: n(i.returnedQty),
      serialNumber: i.serialNumber,
      warrantyUntil: i.warrantyUntil,
    })),
    subtotal: n(s.subtotal),
    discount: n(s.discount),
    tax: n(s.tax),
    total: n(s.total),
    payments: s.payments.map((p) => ({ method: p.method, amount: n(p.amount), reference: p.reference })),
    /** The one method, or SPLIT. */
    paymentMethod: methods.length === 1 ? methods[0] : 'SPLIT',
    tendered: num(s.tendered),
    change: s.tendered == null ? null : r2(n(s.tendered) - cash),
    note: s.note,
    cashierName: s.cashierName,
    approvedByName: s.approvedByName,
    voided: s.voidedAt ? { at: s.voidedAt, by: s.voidedByName, reason: s.voidReason } : null,
    exchangeOfId: s.exchangeOfId,
    returns: s.returns.map((r) => ({
      id: r.id, number: r.number, total: n(r.total), fee: n(r.fee), overridden: r.overridden, refundMethod: r.refundMethod, storeCreditId: r.storeCreditId,
      reason: r.reason, byName: r.byName, approvedByName: r.approvedByName, lines: r.lines, createdAt: r.createdAt,
    })),
    refunded: r2(s.returns.reduce((t, r) => t + n(r.total), 0)),
    createdAt: s.createdAt,
  };
};

export const presentAccount = (
  a: TradeAccount,
  extra: { balance: Prisma.Decimal; overdue: Prisma.Decimal; oldestOverdue: Date | null; openOrders?: number; orders?: number; lastOrderAt?: Date | null },
) => ({
  id: a.id,
  kind: a.kind,
  name: a.garageName,
  phone: a.garagePhone,
  address: a.garageAddress,
  /** GARAGE accounts: the Kaduna garage. */
  garage: a.kind === 'GARAGE' ? { id: a.garageId, name: a.garageName, phone: a.garagePhone, address: a.garageAddress } : null,
  linked: a.linked,
  creditLimit: n(a.creditLimit),
  paymentDays: a.paymentDays,
  onHold: a.onHold,
  balance: n(extra.balance),
  overdue: n(extra.overdue),
  oldestOverdue: extra.oldestOverdue,
  openOrders: extra.openOrders ?? 0,
  orders: extra.orders ?? 0,
  lastOrderAt: extra.lastOrderAt ?? null,
  since: a.createdAt,
});

export const presentEntry = (
  e: AccountEntry,
  order: { id: string; number: number; jobNumber: number | null; vehiclePlate: string | null } | null,
  balance: Prisma.Decimal,
  sale: { id: string; number: number } | null = null,
) => ({
  id: e.id,
  kind: e.kind,
  amount: n(e.amount),
  method: e.method,
  reference: e.reference,
  note: e.note,
  order: order ? { id: order.id, number: order.number, jobNumber: order.jobNumber, plate: order.vehiclePlate } : null,
  sale: sale ? { id: sale.id, number: sale.number } : null,
  byName: e.byName,
  balance: n(balance),
  createdAt: e.createdAt,
});

/** The garage's view of its account at a shop. */
export const presentAccountSummary = (a: { id: string; linked: boolean; creditLimit: Prisma.Decimal; paymentDays: number; onHold: boolean; balance: Prisma.Decimal; available: Prisma.Decimal | null }) => ({
  id: a.id,
  linked: a.linked,
  creditLimit: n(a.creditLimit),
  paymentDays: a.paymentDays,
  onHold: a.onHold,
  balance: n(a.balance),
  /** null: no orders on account right now (no credit, on hold or overdue). */
  available: a.available == null ? null : Math.max(0, r2(n(a.available))),
});

const orderItem = (i: OrderDetail['items'][number], withPrices: boolean) => ({
  id: i.id,
  partId: i.partId,
  description: i.description,
  partNumber: i.partNumber,
  quantity: n(i.quantity),
  available: i.available,
  ...(withPrices && { unitPrice: num(i.unitPrice), lineTotal: i.unitPrice == null ? null : r2(n(i.unitPrice) * n(i.quantity)) }),
});

const orderTotal = (items: OrderDetail['items']) => {
  const priced = items.filter((i) => i.available);
  if (priced.some((i) => i.unitPrice == null)) return null;
  return r2(priced.reduce((s, i) => s + n(i.unitPrice!) * n(i.quantity), 0));
};

const vehicle = (o: OrderDetail) => (o.vehiclePlate || o.vehicleMake || o.vehicleModel ? { plate: o.vehiclePlate, make: o.vehicleMake, model: o.vehicleModel, year: o.vehicleYear } : null);

const orderCommon = (o: OrderDetail) => ({
  id: o.id,
  number: o.number,
  status: o.status,
  fulfilment: o.fulfilment,
  deliveryAddress: o.deliveryAddress,
  pickupBy: o.pickupBy,
  paymentTerms: o.paymentTerms,
  paidAt: o.paidAt,
  paymentMethod: o.paymentMethod,
  note: o.note,
  sellerNote: o.sellerNote,
  job: o.jobCardId ? { id: o.jobCardId, number: o.jobNumber, vehicle: vehicle(o) } : null,
  items: o.items.map((i) => orderItem(i, true)),
  total: orderTotal(o.items),
  quotedAt: o.quotedAt,
  confirmedAt: o.confirmedAt,
  readyAt: o.readyAt,
  completedAt: o.completedAt,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
});

/** The garage's view: includes the handover code it holds for deliveries. */
export const presentGarageOrder = (o: OrderDetail) => ({
  ...orderCommon(o),
  shop: { id: o.shop.id, name: o.shop.name, phone: o.shop.phone, address: o.shop.address, city: o.shop.city, currency: o.shop.currency },
  pickupStaff: o.pickupBy === 'MECHANIC' ? { id: o.pickupStaffId, name: o.pickupName } : null,
  handoverCode: o.handoverCode,
  addedToJob: o.jobSync === 'DONE',
});

/** The shop's view: never the handover code. */
export const presentShopOrder = (o: OrderDetail) => ({
  ...orderCommon(o),
  garage: { id: o.garageId, name: o.account.garageName, phone: o.account.garagePhone, address: o.account.garageAddress },
  accountId: o.accountId,
  collector:
    o.fulfilment === 'DELIVERY' ? null : o.pickupBy === 'MECHANIC' ? { kind: 'MECHANIC' as const, name: o.pickupName, phone: o.pickupPhone } : { kind: 'VEHICLE_OWNER' as const, name: null, phone: null },
});

/** The collector's view: where to go, what to take, and the code. No prices. */
export const presentPickup = (o: OrderDetail, as: 'MECHANIC' | 'VEHICLE_OWNER') => ({
  id: o.id,
  number: o.number,
  status: o.status as 'CONFIRMED' | 'READY' | 'COMPLETED',
  as,
  handoverCode: o.status === 'COMPLETED' ? null : o.handoverCode,
  seller: { name: o.shop.name, phone: o.shop.phone, address: o.shop.address, city: o.shop.city, openingHours: o.shop.openingHours },
  garage: { name: o.account.garageName, phone: o.account.garagePhone, address: o.account.garageAddress },
  job: o.jobCardId ? { id: o.jobCardId, number: o.jobNumber, vehicle: vehicle(o) } : null,
  // Pay-on-handover pickups: the collector should know to bring payment.
  payOnCollection: o.paymentTerms === 'ON_HANDOVER' && !o.paidAt,
  items: o.items.filter((i) => i.available).map((i) => ({ description: i.description, partNumber: i.partNumber, quantity: n(i.quantity) })),
  note: o.note,
  sellerNote: o.sellerNote,
  readyAt: o.readyAt,
  completedAt: o.completedAt,
  createdAt: o.createdAt,
});

// ─── Staff, audit, cash ─────────────────────────────────────────────────────

export const presentStaff = (s: ShopStaff) => ({
  id: s.id,
  email: s.email,
  name: s.name,
  phone: s.phone,
  role: s.role,
  active: s.active,
  /** Signed in at least once. */
  joined: s.userId != null,
  hasPin: s.pinHash != null,
  lastSeenAt: s.lastSeenAt,
  createdAt: s.createdAt,
});

export const presentAudit = (e: AuditEvent) => ({
  id: e.id,
  actorName: e.actorName,
  action: e.action,
  entity: e.entity,
  entityId: e.entityId,
  summary: e.summary,
  amount: num(e.amount),
  createdAt: e.createdAt,
});

type Summary = {
  expected: Prisma.Decimal;
  lines: Record<'openingFloat' | 'cashSales' | 'cashRefunds' | 'accountPayments' | 'handovers' | 'supplierPayments' | 'payIns' | 'payOuts', Prisma.Decimal>;
  byMethod: { method: string; total: Prisma.Decimal }[];
  counts: { sales: number; voided: number; returns: number; discounts: Prisma.Decimal };
};

export const presentSession = (s: CashSession & { movements: CashMovement[] }, sum?: Summary) => ({
  id: s.id,
  number: s.number,
  userName: s.userName,
  status: s.status,
  openingFloat: n(s.openingFloat),
  openedAt: s.openedAt,
  closedAt: s.closedAt,
  closedByName: s.closedByName,
  expectedCash: sum ? n(sum.expected) : num(s.expectedCash),
  countedCash: num(s.countedCash),
  difference: s.countedCash != null && s.expectedCash != null ? r2(n(s.countedCash) - n(s.expectedCash)) : null,
  note: s.note,
  movements: s.movements.map((m) => ({ id: m.id, kind: m.kind, amount: n(m.amount), reason: m.reason, byName: m.byName, createdAt: m.createdAt })),
  summary: sum
    ? {
        ...Object.fromEntries(Object.entries(sum.lines).map(([k, v]) => [k, n(v)])),
        byMethod: sum.byMethod.map((m) => ({ method: m.method, total: n(m.total) })),
        sales: sum.counts.sales,
        voided: sum.counts.voided,
        returns: sum.counts.returns,
        discounts: n(sum.counts.discounts),
      }
    : null,
});

// ─── Held sales and quotes ──────────────────────────────────────────────────

export const presentDraft = (d: SaleDraft) => {
  const input = d.input as { items: unknown[]; discount: number; accountId: string | null; customerAddress: string | null; customerVatNo: string | null; note: string | null; lines: unknown[] };
  return {
    id: d.id,
    kind: d.kind,
    number: d.number,
    status: d.status,
    customerName: d.customerName,
    customerPhone: d.customerPhone,
    customerAddress: input.customerAddress ?? null,
    customerVatNo: input.customerVatNo ?? null,
    plate: d.plate,
    accountId: input.accountId ?? null,
    note: input.note ?? null,
    items: input.items,
    discountInput: input.discount ?? 0,
    lines: input.lines ?? [],
    subtotal: n(d.subtotal),
    discount: n(d.discount),
    tax: n(d.tax),
    total: n(d.total),
    validUntil: d.validUntil,
    createdByName: d.createdByName,
    saleId: d.saleId,
    createdAt: d.createdAt,
  };
};

// ─── Stocktakes ─────────────────────────────────────────────────────────────

export const presentCount = (c: CountDetail, withCost = true) => {
  const lines = c.lines.map((l) => {
    const counted = num(l.countedQty);
    // Before posting: against the stock when counted. After: what was applied.
    const variance = l.adjustment != null ? n(l.adjustment) : counted == null ? null : r2(counted - n(l.stockAtCount ?? l.expectedQty));
    return {
      id: l.id,
      part: { id: l.part.id, sku: l.part.sku, name: l.part.name, brand: l.part.brand, unit: l.part.unit, barcode: l.part.barcode, stockQty: n(l.part.stockQty) },
      location: l.location,
      expectedQty: n(l.expectedQty),
      countedQty: counted,
      variance,
      varianceValue: withCost && variance != null ? r2(variance * n(l.part.costPrice)) : null,
      countedByName: l.countedByName,
      countedAt: l.countedAt,
    };
  });
  return {
    id: c.id,
    number: c.number,
    status: c.status,
    category: c.category,
    location: c.location,
    note: c.note,
    createdByName: c.createdByName,
    postedByName: c.postedByName,
    createdAt: c.createdAt,
    postedAt: c.postedAt,
    progress: { lines: lines.length, counted: lines.filter((l) => l.countedQty != null).length, differences: lines.filter((l) => l.variance != null && l.variance !== 0).length },
    varianceValue: withCost ? r2(lines.reduce((t, l) => t + (l.varianceValue ?? 0), 0)) : null,
    lines,
  };
};

// ─── Suppliers: what the shop owes ──────────────────────────────────────────

export const presentSupplierEntry = (e: SupplierEntry, purchaseNumber: number | null, balance: Prisma.Decimal) => ({
  id: e.id,
  kind: e.kind,
  amount: n(e.amount),
  reference: e.reference,
  billDate: e.billDate,
  dueDate: e.dueDate,
  purchase: e.purchaseId ? { id: e.purchaseId, number: purchaseNumber } : null,
  method: e.method,
  note: e.note,
  byName: e.byName,
  balance: n(balance),
  createdAt: e.createdAt,
});

export const presentSupplierReturn = (r: SupplierReturn & { supplier: { id: string; name: string } }) => ({
  id: r.id,
  number: r.number,
  supplier: r.supplier,
  purchaseId: r.purchaseId,
  lines: r.lines as { partId: string; sku: string; name: string; quantity: number; unitCost: number }[],
  total: n(r.total),
  reason: r.reason,
  byName: r.byName,
  createdAt: r.createdAt,
});

// ─── Store credit, warranty claims, return rules ────────────────────────────

export const presentCredit = (c: StoreCredit & { entries: StoreCreditEntry[] }) => ({
  id: c.id,
  code: c.code,
  customerName: c.customerName,
  customerPhone: c.customerPhone,
  amount: n(c.amount),
  balance: n(c.balance),
  status: c.status,
  expiresAt: c.expiresAt,
  note: c.note,
  byName: c.byName,
  entries: c.entries.map((e) => ({ id: e.id, kind: e.kind, amount: n(e.amount), saleId: e.saleId, returnId: e.returnId, method: e.method, byName: e.byName, createdAt: e.createdAt })),
  createdAt: c.createdAt,
});

export const presentClaim = (c: ClaimDetail, suggested: Prisma.Decimal) => ({
  id: c.id,
  number: c.number,
  part: c.part ? { id: c.part.id, sku: c.part.sku, name: c.part.name, serialized: c.part.serialized } : null,
  saleId: c.saleId,
  saleItemId: c.saleItemId,
  serialNumber: c.serialNumber,
  customerName: c.customerName,
  customerPhone: c.customerPhone,
  fault: c.fault,
  soldAt: c.soldAt,
  warrantyUntil: c.warrantyUntil,
  covered: c.covered,
  status: c.status,
  /** What a replacement should cost the customer now (pro rata, or full when not covered). */
  suggestedCharge: n(suggested),
  charged: n(c.charged),
  replacementSaleId: c.replacementSaleId,
  refundReturnId: c.refundReturnId,
  outcomeNote: c.outcomeNote,
  supplier: { id: c.supplierId, status: c.supplierStatus, credit: num(c.supplierCredit), note: c.supplierNote, sentAt: c.sentAt },
  createdByName: c.createdByName,
  resolvedByName: c.resolvedByName,
  createdAt: c.createdAt,
  resolvedAt: c.resolvedAt,
});

export const presentRule = (r: ReturnRule) => ({ id: r.id, category: r.category, returnable: r.returnable, days: r.days, feePct: n(r.feePct), note: r.note });
