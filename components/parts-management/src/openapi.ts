/**
 * The service's OpenAPI 3.1 contract, built from code: request bodies and
 * query parameters come from the zod schemas the routes validate with.
 * `npm run openapi` writes contracts/parts-management.openapi.yaml, and
 * tests/openapi.test.ts fails if it is out of date or misses a route.
 */
import { z } from 'zod';

import * as v from './validation';

type Json = Record<string, unknown>;

const schema = (s: z.ZodType): Json => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Json;
  return rest;
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (type: string, extra: Json = {}) => ({ type: [type, 'null'], ...extra });
const money = { type: 'number', description: 'Amount in the shop currency (LKR), 2 decimal places' };
const timestamp = { type: 'string', format: 'date-time' };
const dt = nullable('string', { format: 'date-time' });
const str = { type: 'string' };
const int = { type: 'integer' };
const numb = { type: 'number' };
const bool = { type: 'boolean' };
const arr = (items: Json) => ({ type: 'array', items });
const obj = (properties: Json, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const oneOrNull = (s: Json) => ({ oneOf: [s, { type: 'null' }] });
const vehicle = oneOrNull(obj({ plate: nullable('string'), make: nullable('string'), model: nullable('string'), year: nullable('integer') }));
const method = { enum: [...v.paymentMethods] };
const saleMethod = { enum: [...v.saleMethods] };
const ageingFields = {
  current: money, d1_30: { ...money, description: '1 to 30 days late' }, d31_60: money, d61_90: money, d90plus: money,
  overdue: money, oldestOverdue: { ...dt, description: 'Due date of the oldest unpaid charge' },
};

const fitment = obj({ id: str, make: str, model: str, yearFrom: nullable('integer'), yearTo: nullable('integer'), note: nullable('string') });

const responses: Record<string, Json> = {
  Shop: obj({
    id: str, name: str, phone: nullable('string'), email: nullable('string'), address: nullable('string'), city: nullable('string'),
    registrationNo: nullable('string'), openingHours: nullable('string'), delivers: bool, deliveryNote: nullable('string'),
    currency: str, taxRate: { type: 'number', description: 'Percent' }, receiptFooter: nullable('string'), vatNumber: nullable('string'),
    receiptWidth: { enum: ['58mm', '80mm', 'A4'] }, maxDiscountPct: { type: 'number', description: 'Deeper discounts need a manager' },
    requireCashSession: bool, active: bool, createdAt: timestamp,
  }),
  PublicShop: obj({
    id: str, name: str, phone: nullable('string'), email: nullable('string'), address: nullable('string'), city: nullable('string'),
    openingHours: nullable('string'), delivers: bool, deliveryNote: nullable('string'), currency: str,
  }),
  Fitment: fitment,
  Part: obj({
    id: str, sku: str, name: str, description: nullable('string'), brand: nullable('string'), category: nullable('string'), oemNumber: nullable('string'), partNumber: nullable('string'),
    crossRefs: arr(str), barcode: nullable('string'), location: nullable('string', { description: "The default location's name" }), defaultLocationId: str,
    tags: arr(str), specs: arr(obj({ name: str, value: str })), unit: str,
    costPrice: nullable('number', { description: "null when the caller's role doesn't see costs" }), retailPrice: money,
    tradePrice: nullable('number', { description: 'null: garages pay the retail price' }),
    taxRate: nullable('number', { description: "VAT percent; null: the shop's rate" }), warrantyMonths: nullable('integer'),
    coreCharge: nullable('number', { description: 'Refundable deposit until the old unit comes back' }), serialized: bool,
    fractional: { type: 'boolean', description: 'Sold by measure: any quantity' }, quickQtys: arr(numb), purchaseUnit: nullable('string'),
    purchaseFactor: { type: 'number', description: 'Selling units per purchase unit' },
    breaksInto: oneOrNull(obj({ id: str, name: nullable('string'), unit: nullable('string'), stockQty: nullable('number'), qty: nullable('number') })),
    openedFrom: arr(obj({ id: str, sku: str, name: str, stockQty: numb, qty: nullable('number') })),
    isKit: bool,
    kitComponents: arr(obj({ partId: str, sku: str, name: str, unit: str, quantity: numb, stockQty: numb, costPrice: nullable('number'), retailPrice: money })),
    warrantyFreeMonths: nullable('integer'),
    stockQty: numb, reorderLevel: numb, reorderQty: numb,
    lowStock: bool, universal: bool, listed: bool, active: bool, supplierId: nullable('string'), supplierName: nullable('string'), notes: nullable('string'),
    fitments: arr(ref('Fitment')),
    stockByLocation: { description: 'Detail only', ...arr(obj({ locationId: str, name: str, qty: numb, default: bool })) },
    createdAt: timestamp, updatedAt: timestamp,
  }, ['id', 'sku', 'name', 'description', 'brand', 'category', 'oemNumber', 'partNumber', 'crossRefs', 'barcode', 'location', 'defaultLocationId', 'tags', 'specs', 'unit', 'costPrice', 'retailPrice', 'tradePrice', 'taxRate', 'warrantyMonths', 'coreCharge', 'serialized', 'fractional', 'quickQtys', 'purchaseUnit', 'purchaseFactor', 'breaksInto', 'openedFrom', 'isKit', 'kitComponents', 'warrantyFreeMonths', 'stockQty', 'reorderLevel', 'reorderQty', 'lowStock', 'universal', 'listed', 'active', 'supplierId', 'supplierName', 'notes', 'fitments', 'createdAt', 'updatedAt']),
  CataloguePart: obj({
    id: str, sku: str, name: str, brand: nullable('string'), category: nullable('string'), oemNumber: nullable('string'), partNumber: nullable('string'),
    unit: str, price: { ...money, description: 'What this garage pays (trade price)' }, retailPrice: money, stockQty: numb, universal: bool, fitments: arr(ref('Fitment')),
  }),
  StockMovement: obj({
    id: str, partId: str, quantityChange: { type: 'number', description: '+ in, − out' }, reason: { enum: [...v.stockReasons] }, unitCost: nullable('number'),
    saleId: nullable('string'), purchaseId: nullable('string'), orderId: nullable('string'), note: nullable('string'), byName: nullable('string'),
    locationId: nullable('string'), locationName: nullable('string'), createdAt: timestamp,
  }),
  Location: obj({ id: str, name: str, note: nullable('string'), active: bool, parts: { type: 'integer', description: 'Parts with stock here' }, units: numb, value: nullable('number', { description: "At cost; null when the caller's role doesn't see costs" }), createdAt: timestamp }),
  PartFile: obj({
    id: str, kind: { enum: [...v.fileKinds] }, status: { enum: ['PENDING', 'READY'] }, name: str,
    url: nullable('string', { description: 'Links as given; stored files through a URL valid for an hour' }), contentType: nullable('string'), size: nullable('integer'),
    primary: { type: 'boolean', description: 'The photo shown for the part' }, byName: nullable('string'), createdAt: timestamp,
  }),
  Supplier: obj({
    id: str, name: str, contactName: nullable('string'), phone: nullable('string'), email: nullable('string'), address: nullable('string'), notes: nullable('string'),
    paymentDays: int, active: bool, createdAt: timestamp,
  }),
  Purchase: obj({
    id: str, number: int, status: { enum: [...v.purchaseStatuses] }, supplier: obj({ id: str, name: str, phone: nullable('string') }),
    expectedAt: dt, note: nullable('string'), orderedAt: dt, receivedAt: dt, createdAt: timestamp,
    items: arr(obj({
      id: str, part: obj({ id: str, sku: str, name: str, unit: str, stockQty: numb }), quantity: numb, unitCost: money, receivedQty: numb,
      purchaseUnit: nullable('string', { description: 'Quantity and cost are per this unit' }), unitFactor: numb, lineTotal: money,
    })),
    total: money,
  }),
  Sale: obj({
    id: str, number: int, customerName: nullable('string'), customerPhone: nullable('string'), customerAddress: nullable('string'), customerVatNo: nullable('string'),
    plate: nullable('string'), account: oneOrNull(obj({ id: str, kind: { enum: ['GARAGE', 'CUSTOMER'] }, name: str })), taxInvoice: bool,
    items: arr(obj({
      id: str, kind: { enum: ['PART', 'OTHER', 'CORE'] }, partId: nullable('string'), description: str, quantity: numb, unitPrice: money, listPrice: nullable('number'),
      discount: money, taxRate: numb, tax: money, lineTotal: { ...money, description: 'Before VAT and the sale discount' }, returnedQty: numb,
      serialNumber: nullable('string'), warrantyUntil: dt,
    })),
    subtotal: money, discount: { ...money, description: 'Line discounts and the sale discount' }, tax: money, total: money,
    payments: arr(obj({ method: saleMethod, amount: money, reference: nullable('string') })),
    paymentMethod: { enum: [...v.saleMethods, 'SPLIT'] }, tendered: nullable('number'), change: nullable('number'), note: nullable('string'),
    cashierName: nullable('string'), approvedByName: nullable('string', { description: 'Who approved a discount past the limit' }),
    voided: oneOrNull(obj({ at: timestamp, by: nullable('string'), reason: nullable('string') })),
    exchangeOfId: nullable('string', { description: 'An exchange: the sale whose items came back' }),
    returns: arr(obj({
      id: str, number: int, total: { ...money, description: 'Refunded, after any fee' }, fee: { ...money, description: 'Restocking fee kept' }, overridden: { type: 'boolean', description: 'Return rules overridden' },
      refundMethod: saleMethod, storeCreditId: nullable('string'), reason: nullable('string'), byName: nullable('string'), approvedByName: nullable('string'), lines: arr({ type: 'object' }), createdAt: timestamp,
    })),
    refunded: money, createdAt: timestamp,
  }),
  Account: obj({
    id: str, kind: { enum: ['GARAGE', 'CUSTOMER'] }, name: str, phone: nullable('string'), address: nullable('string'),
    garage: oneOrNull(obj({ id: nullable('string'), name: str, phone: nullable('string'), address: nullable('string') })), linked: bool,
    creditLimit: { ...money, description: '0: everything is paid on handover' }, paymentDays: int, onHold: bool,
    balance: { ...money, description: 'What the garage owes' }, overdue: money, oldestOverdue: dt, openOrders: int, orders: int, lastOrderAt: dt, since: timestamp,
  }),
  AccountEntry: obj({
    id: str, kind: { enum: ['CHARGE', 'PAYMENT', 'ADJUSTMENT'] }, amount: { ...money, description: '+ owed, − paid or credited' }, method: oneOrNull(method),
    reference: nullable('string'), note: nullable('string'), order: oneOrNull(obj({ id: str, number: int, jobNumber: nullable('integer'), plate: nullable('string') })),
    sale: oneOrNull(obj({ id: str, number: int })), byName: nullable('string'),
    balance: { ...money, description: 'Running balance after this entry' }, createdAt: timestamp,
  }),
  AccountSummary: obj({
    id: str, linked: bool, creditLimit: money, paymentDays: int, onHold: bool, balance: money,
    available: nullable('number', { description: 'Credit left for new orders; null: no orders on account (no credit, on hold or overdue)' }),
  }),
  OrderItem: obj({ id: str, partId: nullable('string'), description: str, partNumber: nullable('string'), quantity: numb, available: bool, unitPrice: nullable('number'), lineTotal: nullable('number') }),
};

const orderCommon = {
  id: str, number: int, status: { enum: [...v.orderStatuses] }, fulfilment: { enum: ['DELIVERY', 'PICKUP'] }, deliveryAddress: nullable('string'),
  pickupBy: oneOrNull({ enum: ['MECHANIC', 'VEHICLE_OWNER'] }), paymentTerms: oneOrNull({ enum: ['ACCOUNT', 'ON_HANDOVER'], description: 'Set when confirmed' }),
  paidAt: dt, paymentMethod: oneOrNull(method), note: nullable('string'), sellerNote: nullable('string'),
  job: oneOrNull(obj({ id: str, number: nullable('integer'), vehicle })), items: arr(ref('OrderItem')), total: nullable('number', { description: 'null while a line is unpriced' }),
  quotedAt: dt, confirmedAt: dt, readyAt: dt, completedAt: dt, createdAt: timestamp, updatedAt: timestamp,
};
responses.GarageOrder = obj({
  ...orderCommon,
  shop: obj({ id: str, name: str, phone: nullable('string'), address: nullable('string'), city: nullable('string'), currency: str }),
  pickupStaff: oneOrNull(obj({ id: nullable('string'), name: nullable('string') })),
  handoverCode: { type: 'string', description: 'Given to the shop at handover (delivery); also shown to the collector (pickup)' },
  addedToJob: { type: 'boolean', description: "The parts are on the garage's job" },
});
responses.ShopOrder = obj({
  ...orderCommon,
  garage: obj({ id: str, name: str, phone: nullable('string'), address: nullable('string') }),
  accountId: str,
  collector: { description: 'PICKUP: who will come. The handover code is never sent to the shop', ...oneOrNull(obj({ kind: { enum: ['MECHANIC', 'VEHICLE_OWNER'] }, name: nullable('string'), phone: nullable('string') })) },
});
responses.Pickup = obj({
  id: str, number: int, status: { enum: ['CONFIRMED', 'READY', 'COMPLETED'] }, as: { enum: ['MECHANIC', 'VEHICLE_OWNER'] },
  handoverCode: nullable('string', { description: 'Show it at the shop; null once collected' }),
  seller: obj({ name: str, phone: nullable('string'), address: nullable('string'), city: nullable('string'), openingHours: nullable('string') }),
  garage: obj({ name: str, phone: nullable('string'), address: nullable('string') }),
  job: oneOrNull(obj({ id: str, number: nullable('integer'), vehicle })),
  payOnCollection: { type: 'boolean', description: 'Bring payment: the order is paid on handover' },
  items: arr(obj({ description: str, partNumber: nullable('string'), quantity: numb })),
  note: nullable('string'), sellerNote: nullable('string'), readyAt: dt, completedAt: dt, createdAt: timestamp,
});
responses.Dashboard = obj({
  today: obj({ sales: int, salesTotal: money, garageOrdersTotal: money }),
  orders: obj({ toPrice: int, awaitingGarage: int, toPrepare: int, ready: int }),
  stock: obj({ value: { ...money, description: 'At cost' }, units: numb, lines: int, lowStock: int }),
  accounts: obj({ receivable: money, overdue: money, garages: int }),
  suppliers: obj({ payable: { ...money, description: 'What the shop owes its suppliers' }, overdue: money }),
  drawers: arr(obj({ userName: str, openedAt: timestamp })),
  recentSales: arr(obj({ id: str, number: int, total: money, customerName: nullable('string'), voided: bool, createdAt: timestamp })),
  recentOrders: arr(obj({ id: str, number: int, status: { enum: [...v.orderStatuses] }, garageName: str, updatedAt: timestamp })),
});
responses.Report = obj({
  from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' },
  totals: obj({
    revenue: money, counter: { ...money, description: 'Counter sales less refunds' }, trade: { ...money, description: 'Garage orders handed over' },
    refunds: money, tax: money, cost: money, grossProfit: money, margin: nullable('number', { description: 'Percent of net revenue' }), sales: int,
    voided: { type: 'integer', description: 'Voided sales (not in the totals)' }, garageOrders: int,
  }),
  days: arr(obj({ date: { type: 'string', format: 'date' }, counter: money, trade: money, total: money })),
  paymentMethods: arr(obj({ method, count: int, total: money })),
  topParts: arr(obj({ partId: str, name: str, sku: str, quantity: numb, revenue: money, profit: money })),
  topGarages: arr(obj({ name: str, orders: int, total: money })),
  vat: arr(obj({ rate: numb, taxable: money, tax: money })),
  cashiers: arr(obj({ name: str, sales: int, total: money, discounts: money, voids: int, refunds: money })),
});
responses.Ageing = obj(ageingFields);
responses.StoreCredit = obj({
  id: str, code: { type: 'string', description: 'Given to the customer; pay with it as method VOUCHER, reference = code' }, customerName: nullable('string'), customerPhone: nullable('string'),
  amount: money, balance: money, status: { enum: ['ACTIVE', 'USED', 'CANCELLED'] }, expiresAt: dt, note: nullable('string'), byName: nullable('string'),
  entries: arr(obj({ id: str, kind: { enum: ['ISSUE', 'REDEEM', 'RESTORE', 'CASH_OUT', 'CANCEL'] }, amount: money, saleId: nullable('string'), returnId: nullable('string'), method: oneOrNull(saleMethod), byName: nullable('string'), createdAt: timestamp })),
  createdAt: timestamp,
});
responses.WarrantyClaim = obj({
  id: str, number: int, part: oneOrNull(obj({ id: str, sku: str, name: str, serialized: bool })), saleId: nullable('string'), saleItemId: nullable('string'), serialNumber: nullable('string'),
  customerName: nullable('string'), customerPhone: nullable('string'), fault: str, soldAt: dt, warrantyUntil: dt, covered: bool,
  status: { enum: ['OPEN', 'REPLACED', 'REFUNDED', 'REPAIRED', 'REJECTED'] }, suggestedCharge: { ...money, description: 'What a replacement should cost now: pro rata, or the full price when not covered' },
  charged: money, replacementSaleId: nullable('string'), refundReturnId: nullable('string'), outcomeNote: nullable('string'),
  supplier: obj({ id: nullable('string'), status: { enum: ['NONE', 'PENDING', 'CREDITED', 'REPLACED', 'REJECTED'] }, credit: nullable('number'), note: nullable('string'), sentAt: dt }),
  createdByName: str, resolvedByName: nullable('string'), createdAt: timestamp, resolvedAt: dt,
});
responses.ReturnRule = obj({ id: str, category: nullable('string', { description: 'null: the default' }), returnable: bool, days: nullable('integer'), feePct: numb, note: nullable('string') });
responses.Staff = obj({
  id: str, email: str, name: str, phone: nullable('string'), role: { enum: [...v.staffRoles] }, active: bool,
  joined: { type: 'boolean', description: 'Has signed in with that email' }, hasPin: bool, lastSeenAt: dt, createdAt: timestamp,
});
responses.AuditEvent = obj({ id: str, actorName: str, action: str, entity: nullable('string'), entityId: nullable('string'), summary: str, amount: nullable('number'), createdAt: timestamp });
responses.CashSession = obj({
  id: str, number: int, userName: str, status: { enum: ['OPEN', 'CLOSED'] }, openingFloat: money, openedAt: timestamp, closedAt: dt, closedByName: nullable('string'),
  expectedCash: nullable('number'), countedCash: nullable('number'), difference: nullable('number', { description: '+ over, − short' }), note: nullable('string'),
  movements: arr(obj({ id: str, kind: { enum: ['PAY_IN', 'PAY_OUT'] }, amount: money, reason: str, byName: str, createdAt: timestamp })),
  summary: oneOrNull(obj({
    openingFloat: money, cashSales: money, cashRefunds: money, accountPayments: money, handovers: money, supplierPayments: money, payIns: money, payOuts: money,
    byMethod: arr(obj({ method: saleMethod, total: money })), sales: int, voided: int, returns: int, discounts: money,
  })),
});
responses.Draft = obj({
  id: str, kind: { enum: ['HELD', 'QUOTE'] }, number: nullable('integer'), status: { enum: ['OPEN', 'CONVERTED', 'CANCELLED'] },
  customerName: nullable('string'), customerPhone: nullable('string'), customerAddress: nullable('string'), customerVatNo: nullable('string'), plate: nullable('string'),
  accountId: nullable('string'), note: nullable('string'), items: arr({ type: 'object', description: 'The sale lines as entered' }), discountInput: money,
  lines: arr(obj({ kind: str, partId: nullable('string'), description: str, quantity: numb, unitPrice: money, discount: money, taxRate: numb, tax: money })),
  subtotal: money, discount: money, tax: money, total: money, validUntil: dt, createdByName: str, saleId: nullable('string'), createdAt: timestamp,
});
responses.Stocktake = obj({
  id: str, number: int, status: { enum: ['OPEN', 'POSTED', 'CANCELLED'] }, category: nullable('string'), location: nullable('string'), note: nullable('string'),
  createdByName: str, postedByName: nullable('string'), createdAt: timestamp, postedAt: dt,
  progress: obj({ lines: int, counted: int, differences: int }), varianceValue: nullable('number', { description: 'At cost' }),
  lines: arr(obj({
    id: str, part: obj({ id: str, sku: str, name: str, brand: nullable('string'), unit: str, barcode: nullable('string'), stockQty: numb }), location: obj({ id: str, name: str }),
    expectedQty: numb, countedQty: nullable('number'), variance: nullable('number'), varianceValue: nullable('number'), countedByName: nullable('string'), countedAt: dt,
  })),
});
responses.SupplierEntry = obj({
  id: str, kind: { enum: ['BILL', 'PAYMENT', 'RETURN', 'ADJUSTMENT'] }, amount: { ...money, description: '+ owed, − paid or credited' }, reference: nullable('string'),
  billDate: dt, dueDate: dt, purchase: oneOrNull(obj({ id: str, number: nullable('integer') })), method: oneOrNull(method), note: nullable('string'), byName: nullable('string'),
  balance: money, createdAt: timestamp,
});
responses.SupplierStatement = obj({ supplier: ref('Supplier'), balance: money, ageing: ref('Ageing'), entries: arr(ref('SupplierEntry')) });
responses.SupplierReturn = obj({
  id: str, number: int, supplier: obj({ id: str, name: str }), purchaseId: nullable('string'),
  lines: arr(obj({ partId: str, sku: str, name: str, quantity: numb, unitCost: money })), total: money, reason: nullable('string'), byName: nullable('string'), createdAt: timestamp,
});
responses.PublicShopCard = { allOf: [ref('PublicShop'), obj({ partCount: int, categories: arr(str) })] };
responses.PublicPart = obj({
  id: str, name: str, brand: nullable('string'), category: nullable('string'), oemNumber: nullable('string'), partNumber: nullable('string'), unit: str,
  price: { ...money, description: 'Retail price' }, inStock: bool, universal: bool, fitments: arr(ref('Fitment')),
  shop: obj({ id: str, name: str, city: nullable('string'), address: nullable('string'), phone: nullable('string'), currency: str }),
});
responses.Error = obj(
  { success: { const: false }, error: str, code: { enum: ['FORBIDDEN', 'APPROVAL_REQUIRED', 'DRAWER_CLOSED', 'SERIALS_REQUIRED', 'RETURN_RULE', 'DIFFERENCE_DUE'], description: 'When the client can act on it' }, details: arr(obj({ path: str, message: str })) },
  ['success', 'error', 'timestamp'],
);

const envelope = (data: Json) => obj({ success: { const: true }, data, timestamp });
const reply = (description: string, data: Json) => ({ description, content: { 'application/json': { schema: envelope(data) } } });
const failure = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } });
const queryParams = (s: z.ZodObject) => Object.entries((schema(s).properties ?? {}) as Record<string, Json>).map(([name, sch]) => ({ name, in: 'query', schema: sch }));
const idParam = (name = 'id') => ({ name, in: 'path', required: true, schema: { type: 'string' } });

interface Op {
  tag: string;
  summary: string;
  description?: string;
  body?: z.ZodType;
  params?: Json[];
  ok: [number, string, Json];
  errors?: number[];
  /** shop: needs the caller's shop. garage: needs a garage role (owner for writes). signedIn: any account. */
  access: 'shop' | 'garage' | 'signedIn' | 'public';
  /** shop: who may (default: owner and managers). */
  roles?: string;
}

const errorText: Record<number, string> = {
  403: "Not allowed: the caller's role can't (FORBIDDEN), a manager's PIN is needed (APPROVAL_REQUIRED), a wrong handover code, or an invalid or expired file link",
  404: 'Not found (or set up your shop first)',
  409: 'Conflicts with the current state (wrong status, not enough stock, not on your sellers)',
  422: 'Validation failed; `details` lists each field',
  502: 'The garage service could not be reached',
};

const operation = (key: string, op: Op) => {
  const [status, description, data] = op.ok;
  const write = !key.startsWith('get ');
  const extra =
    op.access === 'garage' ? (write ? 'Garage owner only.' : 'Garage owner and mechanics.') : op.access === 'shop' ? `The shop the caller works at. ${op.roles ?? roleNote(key)}` : null;
  const operationId = operationIds[key];
  if (!operationId) throw new Error(`No operationId for ${key}`);
  return {
    operationId,
    tags: [op.tag],
    summary: op.summary,
    ...([op.description, extra].filter(Boolean).length ? { description: [op.description, extra].filter(Boolean).join(' ') } : {}),
    ...(op.access === 'public' && { security: [] }),
    ...(op.params && { parameters: op.params }),
    ...(op.body && { requestBody: { required: true, content: { 'application/json': { schema: schema(op.body) } } } }),
    responses: {
      [status]: reply(description, data),
      ...(op.access !== 'public' && { 401: failure('Missing or invalid Supabase token') }),
      ...(op.access === 'shop' ? { 403: failure(errorText[403]), 404: failure('Set up your parts shop first, or not found in it') } : {}),
      ...(op.access === 'garage' ? { 403: failure('Not a member of a garage, or a mechanic trying to spend'), 502: failure(errorText[502]) } : {}),
      ...Object.fromEntries((op.errors ?? []).map((c) => [c, failure(errorText[c])])),
    },
  };
};

const partView = {
  allOf: [
    ref('Part'),
    obj({
      onOrder: { type: 'number', description: 'On open purchase orders, not yet received' },
      files: arr(ref('PartFile')),
      substitutes: arr(obj({ note: nullable('string'), part: ref('Part') })),
      movements: arr(ref('StockMovement')),
    }),
  ],
};
const page = (item: string) => obj({ items: arr(ref(item)), total: int, limit: int, offset: int });
const S = (tag: string, summary: string, ok: Op['ok'], more: Partial<Op> = {}): Op => ({ tag, summary, ok, access: 'shop', ...more });
const G = (summary: string, ok: Op['ok'], more: Partial<Op> = {}): Op => ({ tag: 'garages', summary, ok, access: 'garage', ...more });
const accountDetail = { allOf: [ref('Account'), obj({ ageing: ref('Ageing'), entries: arr(ref('AccountEntry')) })] };

const paths: Record<string, Record<string, Op>> = {
  '/api/v1/public/shops': {
    get: { tag: 'public', access: 'public', summary: 'Live parts shops', params: queryParams(v.publicShopsQuery), errors: [422], description: 'For kaduna.lk. Contact details and what each shop carries most of.', ok: [200, 'By name', arr(ref('PublicShopCard'))] },
  },
  '/api/v1/public/parts': {
    get: {
      tag: 'public', access: 'public', summary: 'Search listed parts across shops', params: queryParams(v.publicPartsQuery), errors: [422],
      description: 'Listed, active parts of live shops at the retail price, with in stock yes or no (never the count). make/model/year returns universal parts plus parts whose fitment covers that car.',
      ok: [200, 'In stock first', arr(ref('PublicPart'))],
    },
  },
  '/api/v1/public/categories': {
    get: { tag: 'public', access: 'public', summary: 'Part categories across shops', ok: [200, 'Most parts first', arr(obj({ category: str, parts: int }))] },
  },
  '/api/v1/me': {
    get: {
      tag: 'shop', access: 'signedIn', summary: 'The shop the caller runs or works at, and their role',
      ok: [200, 'The shop, if any', obj({ shop: oneOrNull(obj({ id: str, name: str })), role: oneOrNull({ enum: [...v.roles] }), name: nullable('string'), permissions: arr(str), hasPin: bool })],
    },
  },
  '/api/v1/shop': {
    get: { tag: 'shop', access: 'signedIn', summary: "The caller's shop", ok: [200, 'The shop, or null before setup', oneOrNull(ref('Shop'))] },
    put: { tag: 'shop', access: 'signedIn', summary: 'Set up or update your shop', body: v.shopPatch, errors: [422], description: 'Creates it on first call (201; name required), updates it after. Live at once. One shop per account.', ok: [200, 'Updated (201 when created)', ref('Shop')] },
  },
  '/api/v1/shop/pin': { put: S('staff', 'Set your approval PIN', [200, 'Set', obj({ hasPin: { const: true } })], { body: v.pinInput, errors: [422], description: 'Owners and managers type it at the counter to approve a discount, void or refund.' }) },
  '/api/v1/shop/staff': {
    get: S('staff', 'Who works at the shop', [200, 'Active first', arr(ref('Staff'))]),
    post: S('staff', 'Add a staff member', [201, 'Added', ref('Staff')], { body: v.staffInput, errors: [409, 422], description: 'They get in by signing in to Kaduna with this email.' }),
  },
  '/api/v1/shop/staff/{id}': { patch: S('staff', 'Change role, details or access', [200, 'Updated', ref('Staff')], { params: [idParam()], body: v.staffPatch, errors: [422] }) },
  '/api/v1/shop/audit': { get: S('staff', 'Activity log: who did what', [200, 'Newest first', arr(ref('AuditEvent'))], { params: queryParams(v.auditQuery), errors: [422] }) },
  '/api/v1/shop/cash/current': { get: S('cash', 'Your open cash drawer', [200, 'With what should be in it, or null', oneOrNull(ref('CashSession'))]) },
  '/api/v1/shop/cash/sessions': {
    get: S('cash', 'Cash drawers', [200, 'Newest first (your own, unless you manage cash)', arr(ref('CashSession'))], { params: queryParams(v.sessionsQuery), errors: [422] }),
    post: S('cash', 'Open your drawer', [201, 'OPEN', ref('CashSession')], { body: v.openSessionInput, errors: [409, 422] }),
  },
  '/api/v1/shop/cash/sessions/{id}': { get: S('cash', 'A drawer and its count (Z report)', [200, 'The drawer', ref('CashSession')], { params: [idParam()] }) },
  '/api/v1/shop/cash/sessions/{id}/movements': { post: S('cash', 'Pay cash in or out', [201, 'The drawer', ref('CashSession')], { params: [idParam()], body: v.cashMovementInput, errors: [409, 422] }) },
  '/api/v1/shop/cash/sessions/{id}/close': {
    post: S('cash', 'Count and close a drawer', [200, 'CLOSED, with the over or short', ref('CashSession')], { params: [idParam()], body: v.closeSessionInput, errors: [409, 422] }),
  },
  '/api/v1/shop/reports/stock': {
    get: S('reports', 'Stock value and dead stock', [200, 'By category, and parts not sold lately', obj({
      deadDays: int,
      totals: obj({ cost: money, retail: money, lines: int, deadValue: money, deadLines: int }),
      categories: arr(obj({ category: nullable('string'), lines: int, units: numb, cost: money, retail: money, share: { type: 'number', description: 'Percent of stock value' } })),
      dead: arr(obj({ partId: str, sku: str, name: str, location: nullable('string'), stockQty: numb, value: money, lastSoldAt: dt })),
    })], { params: queryParams(v.stockReportQuery), errors: [422] }),
  },
  '/api/v1/shop/reports/ageing': {
    get: S('reports', 'Who owes what, and how late', [200, 'Receivables and payables', obj({
      receivables: arr({ allOf: [obj({ id: str, kind: { enum: ['GARAGE', 'CUSTOMER'] }, name: str, phone: nullable('string'), balance: money }), ref('Ageing')] }),
      payables: arr({ allOf: [obj({ id: str, name: str, phone: nullable('string'), balance: money }), ref('Ageing')] }),
    })]),
  },
  '/api/v1/shop/parts/export': { get: S('inventory', 'Export the catalogue', [200, 'CSV text', obj({ csv: str, rows: int })], { description: 'The same columns the import reads.' }) },
  '/api/v1/shop/parts/import': {
    post: S('inventory', 'Import parts from a spreadsheet', [200, 'What changed, or would', obj({
      rows: int, create: int, update: int, errors: arr(obj({ row: int, message: str })), ignoredColumns: arr(str),
      preview: arr(obj({ row: int, sku: str, name: nullable('string'), action: { enum: ['create', 'update'] } })), applied: bool,
    })], { body: v.importInput, errors: [422], description: 'Matched on SKU. Saves nothing on a dry run or while any row has an error.' }),
  },
  '/api/v1/shop/parts/barcodes': {
    post: S('inventory', 'Give parts a shop barcode', [200, 'How many got one', obj({ assigned: int })], { body: v.barcodesInput, errors: [422], description: 'EAN-13 codes starting with 20, for parts that have none.' }),
  },
  '/api/v1/shop/stocktakes': {
    get: S('inventory', 'Stocktakes', [200, 'Newest first (lines left out)', arr(ref('Stocktake'))]),
    post: S('inventory', 'Start a stocktake', [201, 'OPEN, with the parts to count', ref('Stocktake')], { body: v.stocktakeInput, errors: [409, 422] }),
  },
  '/api/v1/shop/stocktakes/{id}': { get: S('inventory', 'A stocktake', [200, 'With every line', ref('Stocktake')], { params: [idParam()] }) },
  '/api/v1/shop/stocktakes/{id}/lines': { put: S('inventory', 'Enter counts', [200, 'Updated', ref('Stocktake')], { params: [idParam()], body: v.countLinesInput, errors: [409, 422] }) },
  '/api/v1/shop/stocktakes/{id}/post': {
    post: S('inventory', 'Post a stocktake', [200, 'POSTED', ref('Stocktake')], { params: [idParam()], body: v.postCountInput, errors: [409, 422], description: 'Stock changes by counted minus the stock when counted, as STOCKTAKE movements.' }),
  },
  '/api/v1/shop/stocktakes/{id}/cancel': { post: S('inventory', 'Cancel a stocktake', [200, 'CANCELLED', ref('Stocktake')], { params: [idParam()], errors: [409] }) },
  '/api/v1/shop/suppliers/{id}/statement': { get: S('purchasing', 'What the shop owes a supplier', [200, 'Balance, ageing and entries', ref('SupplierStatement')], { params: [idParam()] }) },
  '/api/v1/shop/suppliers/{id}/bills': { post: S('purchasing', "Record a supplier's invoice", [201, 'The statement', ref('SupplierStatement')], { params: [idParam()], body: v.billInput, errors: [409, 422] }) },
  '/api/v1/shop/suppliers/{id}/payments': { post: S('purchasing', 'Pay a supplier', [201, 'The statement', ref('SupplierStatement')], { params: [idParam()], body: v.supplierPaymentInput, errors: [409, 422] }) },
  '/api/v1/shop/suppliers/{id}/adjustments': { post: S('purchasing', 'Adjust what the shop owes a supplier', [201, 'The statement', ref('SupplierStatement')], { params: [idParam()], body: v.supplierAdjustmentInput, errors: [422] }) },
  '/api/v1/shop/payables': { get: S('purchasing', 'What the shop owes, by supplier', [200, 'With ageing', arr(obj({ supplier: ref('Supplier'), balance: money, ageing: ref('Ageing') }))]) },
  '/api/v1/shop/supplier-returns': {
    get: S('purchasing', 'Stock sent back to suppliers', [200, 'Newest first', arr(ref('SupplierReturn'))], { params: [{ name: 'supplierId', in: 'query', schema: { type: 'string' } }] }),
    post: S('purchasing', 'Send stock back to a supplier', [201, 'The return', ref('SupplierReturn')], { body: v.supplierReturnInput, errors: [409, 422], description: 'Stock out at cost; the supplier credits the same.' }),
  },
  '/api/v1/shop/sales/{id}/void': {
    post: S('sales', 'Void a sale', [200, 'The sale, voided', ref('Sale')], { params: [idParam()], body: v.voidInput, errors: [409, 422], description: 'Stock back, account charge reversed, cash out of your drawer. Not once items were returned.' }),
  },
  '/api/v1/shop/sales/{id}/exchange': {
    post: S('sales', 'Exchange items from a sale', [201, 'Both sales, and any store credit left', obj({
      original: ref('Sale'), sale: ref('Sale'), credit: oneOrNull(ref('StoreCredit')), returned: money, due: { ...money, description: 'Paid on top' }, refunded: { ...money, description: 'Paid out of what came back' },
    })], {
      params: [idParam()], body: v.exchangeInput, errors: [403, 409, 422],
      description: 'What comes back pays for the new items (as store credit). A difference due needs payments or paymentMethod (DIFFERENCE_DUE); a leftover stays as store credit, or is refunded with balanceTo (a manager). Return rules apply (RETURN_RULE).',
    }),
  },
  '/api/v1/shop/credits': { get: S('sales', 'Store credit', [200, 'Newest first', arr(ref('StoreCredit'))], { params: queryParams(v.creditsQuery), errors: [422] }) },
  '/api/v1/shop/credits/{code}': { get: S('sales', 'Look up store credit by code', [200, 'The credit', ref('StoreCredit')], { params: [idParam('code')] }) },
  '/api/v1/shop/credits/{id}/cancel': { post: S('sales', 'Cancel store credit', [200, 'CANCELLED', ref('StoreCredit')], { params: [idParam()], body: v.creditCancelInput, errors: [409, 422] }) },
  '/api/v1/shop/warranty/claims': {
    get: S('sales', 'Warranty claims', [200, 'Newest first', arr(ref('WarrantyClaim'))], { params: queryParams(v.claimsQuery), errors: [422] }),
    post: S('sales', 'Open a warranty claim', [201, 'OPEN', ref('WarrantyClaim')], { body: v.claimInput, errors: [409, 422], description: 'For a sold item, by its sale line or serial number. Whether it is still covered is worked out.' }),
  },
  '/api/v1/shop/warranty/claims/{id}': { get: S('sales', 'A warranty claim', [200, 'The claim', ref('WarrantyClaim')], { params: [idParam()] }) },
  '/api/v1/shop/warranty/claims/{id}/resolve': {
    post: S('sales', 'Replace, refund, repair or reject', [200, 'Closed', ref('WarrantyClaim')], {
      params: [idParam()], body: v.resolveClaimInput, errors: [403, 409, 422],
      description: "REPLACE takes a new unit from stock (free, or the pro-rata charge) keeping the original warranty end; REFUND takes the unit back. Both need the owner or a manager (APPROVAL_REQUIRED).",
    }),
  },
  '/api/v1/shop/warranty/claims/{id}/supplier': {
    post: S('purchasing', "Claim on the supplier for the faulty unit", [200, 'Updated', ref('WarrantyClaim')], {
      params: [idParam()], body: v.supplierClaimInput, errors: [409, 422], description: "SEND, then CREDITED (on the supplier's ledger), REPLACED (a unit into stock) or REJECTED.",
    }),
  },
  '/api/v1/shop/return-rules': {
    get: S('sales', 'Return rules', [200, 'Default first', arr(ref('ReturnRule'))]),
    put: S('sales', 'Replace the return rules', [200, 'Saved', arr(ref('ReturnRule'))], { body: v.returnRulesInput, errors: [422] }),
  },
  '/api/v1/shop/warranty': {
    get: S('sales', 'Warranty lookup', [200, 'Sold items', arr(obj({
      sale: obj({ id: str, number: int, createdAt: timestamp, customerName: nullable('string'), customerPhone: nullable('string'), voided: bool }),
      item: obj({ id: str, partId: nullable('string'), description: str, serialNumber: nullable('string'), quantity: numb, returnedQty: numb }),
      warrantyUntil: dt, covered: bool,
    }))], { params: queryParams(v.warrantyQuery), errors: [422] }),
  },
  '/api/v1/shop/drafts': {
    get: S('sales', 'Held sales and quotations', [200, 'Newest first', arr(ref('Draft'))], { params: queryParams(v.draftsQuery), errors: [422] }),
    post: S('sales', 'Hold a sale, or write a quotation', [201, 'Priced', ref('Draft')], { body: v.draftInput, errors: [409, 422] }),
  },
  '/api/v1/shop/drafts/{id}': { get: S('sales', 'A held sale or quotation', [200, 'The draft', ref('Draft')], { params: [idParam()] }) },
  '/api/v1/shop/drafts/{id}/cancel': { post: S('sales', 'Drop a held sale or quotation', [200, 'CANCELLED', ref('Draft')], { params: [idParam()], errors: [409] }) },
  '/api/v1/shop/dashboard': { get: S('shop', 'Home screen numbers', [200, 'Today, open orders, stock and receivables', ref('Dashboard')]) },
  '/api/v1/shop/reports': { get: S('reports', 'Sales and profit for a date range', [200, 'The report', ref('Report')], { params: queryParams(v.reportQuery), errors: [422] }) },
  '/api/v1/shop/parts': {
    get: S('inventory', 'Search parts', [200, 'A page of parts', page('Part')], { params: queryParams(v.partsQuery), errors: [422], description: 'make/model/year returns universal parts plus parts whose fitment covers that car.' }),
    post: S('inventory', 'Add a part', [201, 'Created', partView], { body: v.partInput, errors: [409, 422], description: 'Opening stock is recorded as an OPENING movement.' }),
  },
  '/api/v1/shop/parts/lookup': { get: S('inventory', 'Find a part by barcode or number (scanning)', [200, 'The part, or null', oneOrNull(ref('Part'))], { params: queryParams(v.lookupQuery), errors: [422] }) },
  '/api/v1/shop/categories': { get: S('inventory', 'Categories in use', [200, 'With part counts', arr(obj({ category: str, parts: int }))]) },
  '/api/v1/shop/parts/{id}': {
    get: S('inventory', 'A part in full', [200, 'Stock by location, files, substitutes and stock history', partView], { params: [idParam()] }),
    patch: S('inventory', 'Edit a part', [200, 'Updated', partView], { params: [idParam()], body: v.partPatch, errors: [409, 422], description: 'Stock changes go through adjust, receiving and sales, never here.' }),
  },
  '/api/v1/shop/parts/{id}/fitments': { put: S('inventory', 'Replace the vehicles a part fits', [200, 'Updated', partView], { params: [idParam()], body: v.fitmentsInput, errors: [422] }) },
  '/api/v1/shop/parts/{id}/adjust': { post: S('inventory', 'Adjust stock at a location (add, remove, count, damage)', [200, 'Updated', partView], { params: [idParam()], body: v.adjustInput, errors: [409, 422], description: 'At the default location unless locationId is given. Never below zero.' }) },
  '/api/v1/shop/parts/{id}/transfer': { post: S('inventory', 'Move stock between locations', [200, 'Updated', partView], { params: [idParam()], body: v.transferInput, errors: [409, 422], description: 'The total stays the same; two MOVE movements.' }) },
  '/api/v1/shop/parts/{id}/trade': {
    get: S('inventory', "A part's sales, garage orders and purchases", [200, 'Newest first, 100 of each', obj({
      sales: arr(obj({ saleId: str, number: int, createdAt: timestamp, customerName: nullable('string'), plate: nullable('string'), cashierName: nullable('string'), voided: bool, quantity: numb, returnedQty: numb, unitPrice: money, discount: money, serialNumber: nullable('string'), unitCost: nullable('number') })),
      orders: arr(obj({ orderId: str, number: int, status: { enum: [...v.orderStatuses] }, garageName: str, createdAt: timestamp, completedAt: dt, quantity: numb, unitPrice: nullable('number') })),
      purchases: arr(obj({ purchaseId: str, number: int, status: { enum: [...v.purchaseStatuses] }, supplier: obj({ id: str, name: str }), createdAt: timestamp, receivedAt: dt, quantity: numb, receivedQty: numb, unitCost: money })),
      suppliers: arr(obj({ id: str, name: str, lastCost: money, bestCost: money, lastAt: timestamp, bought: numb })),
    })], { params: [idParam()], description: 'Purchases and supplier prices only for roles that see costs.' }),
  },
  '/api/v1/shop/parts/{id}/substitutes': { put: S('inventory', 'Link a substitute part', [200, 'Updated', partView], { params: [idParam()], body: v.substituteInput, errors: [422], description: 'Linked both ways.' }) },
  '/api/v1/shop/parts/{id}/substitutes/{otherId}': { delete: S('inventory', 'Unlink a substitute', [200, 'Updated', partView], { params: [idParam(), idParam('otherId')] }) },
  '/api/v1/shop/parts/{id}/files/link': { post: S('inventory', 'Add a link (datasheet, video, image URL)', [201, 'The file', ref('PartFile')], { params: [idParam()], body: v.linkInput, errors: [422] }) },
  '/api/v1/shop/parts/{id}/files/uploads': {
    post: S('inventory', 'Start uploading a photo or document', [201, 'PUT the bytes to upload.url with upload.headers, then complete', obj({ file: ref('PartFile'), upload: obj({ url: str, method: { const: 'PUT' }, headers: { type: 'object', additionalProperties: str }, expiresAt: timestamp }) })], {
      params: [idParam()], body: v.uploadInput, errors: [422], description: 'Photos (JPEG, PNG, WebP, GIF) up to 10 MB; documents (PDF, Word, Excel, text, zip) up to 25 MB. Stored on the local disk or S3, depending on FILES_DRIVER.',
    }),
  },
  '/api/v1/shop/parts/{id}/files/{fileId}/complete': { post: S('inventory', 'Finish an upload', [200, 'READY', ref('PartFile')], { params: [idParam(), idParam('fileId')], errors: [409] }) },
  '/api/v1/shop/parts/{id}/files/{fileId}': {
    patch: S('inventory', 'Rename a file, or make a photo the main one', [200, 'Updated', ref('PartFile')], { params: [idParam(), idParam('fileId')], body: v.filePatch, errors: [422] }),
    delete: S('inventory', 'Remove a file', [200, 'Removed', obj({ removed: { const: true } })], { params: [idParam(), idParam('fileId')] }),
  },
  '/api/v1/shop/parts/{id}/kit': {
    put: S('inventory', 'Make a part a kit, or change its components', [200, 'The kit', partView], { params: [idParam()], body: v.kitInput, errors: [409, 422], description: 'A kit holds no stock: selling one takes its components out.' }),
    delete: S('inventory', 'Make a kit an ordinary part again', [200, 'The part', partView], { params: [idParam()] }),
  },
  '/api/v1/shop/parts/{id}/open': {
    post: S('inventory', 'Open sealed packs into the loose part', [200, 'The pack', partView], { params: [idParam()], body: v.breakInput, errors: [409, 422], description: 'e.g. a 4 L bottle into 4 L loose; the loose stock comes in at the pack cost shared out.' }),
  },
  '/api/v1/shop/locations': {
    get: S('inventory', 'Locations: shelves, bins, stores', [200, 'Active first, by name', arr(ref('Location'))]),
    post: S('inventory', 'Add a location', [201, 'Created', ref('Location')], { body: v.locationInput, errors: [409, 422] }),
  },
  '/api/v1/shop/locations/{id}': { patch: S('inventory', 'Rename or retire a location', [200, 'Updated', ref('Location')], { params: [idParam()], body: v.locationPatch, errors: [409, 422], description: 'Retiring needs it empty and nobody using it as their default.' }) },
  '/api/v1/shop/tags': { get: S('inventory', 'Tags in use', [200, 'Most used first', arr(obj({ tag: str, parts: int }))]) },
  '/api/v1/files/{token}': {
    get: { tag: 'files', access: 'public', summary: 'Download a stored file (local file store)', params: [idParam('token')], errors: [403, 404], description: 'The signed link from a PartFile url; valid for an hour.', ok: [200, 'The file bytes (not the JSON envelope)', { type: 'string', format: 'binary' }] },
    put: { tag: 'files', access: 'public', summary: 'Upload a file (local file store)', params: [idParam('token')], description: 'The signed link from starting an upload; send the raw bytes with the given Content-Type.', ok: [200, 'Stored', obj({ size: int })] },
  },
  '/api/v1/shop/suppliers': {
    get: S('purchasing', 'Your suppliers', [200, 'Suppliers', arr({ allOf: [ref('Supplier'), obj({ partCount: int, openOrders: int, balance: { ...money, description: 'What the shop owes them' } })] })], { params: queryParams(v.searchQuery) }),
    post: S('purchasing', 'Add a supplier', [201, 'Created', ref('Supplier')], { body: v.supplierInput, errors: [422] }),
  },
  '/api/v1/shop/suppliers/{id}': { patch: S('purchasing', 'Edit a supplier', [200, 'Updated', ref('Supplier')], { params: [idParam()], body: v.supplierPatch, errors: [422] }) },
  '/api/v1/shop/reorder': {
    get: S('purchasing', 'What to reorder', [200, 'Low parts grouped by usual supplier', arr(obj({ supplier: oneOrNull(ref('Supplier')), lines: arr(obj({ part: ref('Part'), suggested: int, onOrder: numb })) }))], {
      description: 'Active parts at or below their reorder level; the suggestion is the reorder quantity less what is already on order.',
    }),
  },
  '/api/v1/shop/purchases': {
    get: S('purchasing', 'Purchase orders', [200, 'Newest first', arr(ref('Purchase'))], { params: queryParams(v.purchasesQuery), errors: [422] }),
    post: S('purchasing', 'Start a purchase order', [201, 'DRAFT', ref('Purchase')], { body: v.purchaseInput, errors: [422] }),
  },
  '/api/v1/shop/purchases/{id}': {
    get: S('purchasing', 'One purchase order', [200, 'The order', ref('Purchase')], { params: [idParam()] }),
    patch: S('purchasing', 'Edit a draft', [200, 'Updated', ref('Purchase')], { params: [idParam()], body: v.purchasePatch, errors: [409, 422] }),
  },
  '/api/v1/shop/purchases/{id}/order': { post: S('purchasing', 'Mark as sent to the supplier', [200, 'ORDERED', ref('Purchase')], { params: [idParam()], errors: [409] }) },
  '/api/v1/shop/purchases/{id}/receive': {
    post: S('purchasing', 'Receive stock', [200, 'PARTLY_RECEIVED or RECEIVED', ref('Purchase')], { params: [idParam()], body: v.receiveInput, errors: [409, 422], description: "Stock in at the price paid; the part's cost becomes the weighted average." }),
  },
  '/api/v1/shop/purchases/{id}/cancel': { post: S('purchasing', 'Cancel (before anything is received)', [200, 'CANCELLED', ref('Purchase')], { params: [idParam()], errors: [409] }) },
  '/api/v1/shop/sales': {
    get: S('sales', 'Counter sales', [200, 'Newest first', arr(ref('Sale'))], { params: queryParams(v.salesQuery), errors: [422] }),
    post: S('sales', 'Ring up a sale', [201, 'The sale (receipt)', ref('Sale')], {
      body: v.saleInput, errors: [409, 422],
      description: "Stock out for stocked lines; VAT per line at the part's rate after discounts. Payments must add up to the total; ACCOUNT charges the account within its credit. A discount past the shop's limit needs a manager (APPROVAL_REQUIRED without one).",
    }),
  },
  '/api/v1/shop/sales/{id}': { get: S('sales', 'One sale', [200, 'The sale', ref('Sale')], { params: [idParam()] }) },
  '/api/v1/shop/sales/{id}/returns': {
    post: S('sales', 'Return items from a sale', [201, 'The sale with the return', ref('Sale')], { params: [idParam()], body: v.returnInput, errors: [409, 422], description: 'Refunds in proportion to what was paid; restocks unless damaged; never more than was sold.' }),
  },
  '/api/v1/shop/accounts': {
    get: S('accounts', 'Credit accounts: garages and customers', [200, 'Garages, then customers, by name', arr(ref('Account'))]),
    post: S('accounts', 'Open a customer account', [201, 'The account', accountDetail], { body: v.customerAccountInput, errors: [422], description: "For anyone who isn't a Kaduna garage: a fleet, a local mechanic, a regular." }),
  },
  '/api/v1/shop/accounts/{id}': {
    get: S('accounts', 'An account and its statement', [200, 'Newest entry first', accountDetail], { params: [idParam()] }),
    patch: S('accounts', 'Set credit terms', [200, 'Updated', accountDetail], { params: [idParam()], body: v.accountPatch, errors: [422] }),
  },
  '/api/v1/shop/accounts/{id}/payments': { post: S('accounts', 'Record a payment on an account', [201, 'Updated', accountDetail], { params: [idParam()], body: v.paymentInput, errors: [422] }) },
  '/api/v1/shop/accounts/{id}/adjustments': { post: S('accounts', 'Record an adjustment or credit note', [201, 'Updated', accountDetail], { params: [idParam()], body: v.adjustmentInput, errors: [422] }) },
  '/api/v1/shop/orders': { get: S('orders', 'Orders from garages', [200, 'Newest first', arr(ref('ShopOrder'))], { params: queryParams(v.ordersQuery), errors: [422] }) },
  '/api/v1/shop/orders/{id}': { get: S('orders', 'One order', [200, 'The order', ref('ShopOrder')], { params: [idParam()] }) },
  '/api/v1/shop/orders/{id}/quote': {
    post: S('orders', 'Price an order', [200, 'CONFIRMED or QUOTED', ref('ShopOrder')], {
      params: [idParam()], body: v.quoteInput, errors: [409, 422],
      description: 'Every line must be listed. All catalogue lines, all available, at the trade price: confirmed at once (on account if the credit covers it). Otherwise it goes to the garage as a quote.',
    }),
  },
  '/api/v1/shop/orders/{id}/decline': { post: S('orders', "Decline an order you can't fill", [200, 'DECLINED', ref('ShopOrder')], { params: [idParam()], body: v.sellerNoteInput, errors: [409, 422] }) },
  '/api/v1/shop/orders/{id}/ready': { post: S('orders', 'Ready to collect, or out for delivery', [200, 'READY', ref('ShopOrder')], { params: [idParam()], errors: [409] }) },
  '/api/v1/shop/orders/{id}/complete': {
    post: S('orders', 'Hand the parts over', [200, 'COMPLETED', ref('ShopOrder')], {
      params: [idParam()], body: v.handoverInput, errors: [403, 409, 422],
      description: "Needs the receiving side's code. Stock goes out; an on-account order is charged to the garage; a pay-on-handover order needs paymentMethod. The parts then go on the garage's job.",
    }),
  },
  '/api/v1/garage/shops': { get: G('Find parts shops', [200, 'Live shops, with your account at each', arr({ allOf: [ref('PublicShop'), obj({ partCount: int, account: oneOrNull(ref('AccountSummary')) })] })], { params: queryParams(v.directoryQuery), errors: [422] }) },
  '/api/v1/garage/shops/{id}': { get: G('A shop and your account there', [200, 'The shop', { allOf: [ref('PublicShop'), obj({ account: oneOrNull(ref('AccountSummary')) })] }], { params: [idParam()], errors: [404] }) },
  '/api/v1/garage/shops/{id}/catalogue': {
    get: G("A shop's catalogue at your price", [200, 'Listed parts', obj({ vehicle: oneOrNull(obj({ make: nullable('string'), model: nullable('string'), year: nullable('integer') })), parts: arr(ref('CataloguePart')) })], {
      params: [idParam(), ...queryParams(v.catalogueQuery)], errors: [404, 422], description: "jobCardId filters to parts that fit the job's car.",
    }),
  },
  '/api/v1/garage/shops/{id}/link': {
    put: G('Add a shop to your sellers', [200, 'Your account there', ref('AccountSummary')], { params: [idParam()], errors: [404], description: 'Opens a trade account with no credit; the shop sets the terms.' }),
    delete: G('Remove a shop from your sellers', [200, 'Removed', obj({ linked: { const: false } })], { params: [idParam()], errors: [409], description: 'Not while it has open orders. The account history stays.' }),
  },
  '/api/v1/garage/shops/{id}/statement': { get: G('Your statement with a shop', [200, 'Balance and entries', { allOf: [ref('AccountSummary'), obj({ overdue: money, entries: arr(ref('AccountEntry')) })] }], { params: [idParam()], errors: [404] }) },
  '/api/v1/garage/orders': {
    get: G('Your part orders', [200, 'Newest first', arr(ref('GarageOrder'))], { params: queryParams(v.ordersQuery), errors: [422] }),
    post: G('Order parts', [201, 'REQUESTED', ref('GarageOrder')], {
      body: v.orderInput, errors: [404, 409, 422],
      description: 'Catalogue lines at your trade price; free-text lines for the shop to price. PICKUP by VEHICLE_OWNER needs a job whose car has a plate a Kaduna member registered.',
    }),
  },
  '/api/v1/garage/orders/pickup-options': {
    get: G('Who could collect', [200, 'Mechanics and the vehicle owner', obj({ mechanics: arr(obj({ id: str, name: str, joined: bool })), vehicleOwner: oneOrNull(obj({ plate: str, registered: nullable('boolean') })) })], { params: queryParams(v.pickupOptionsQuery), errors: [404] }),
  },
  '/api/v1/garage/orders/{id}': { get: G('One part order', [200, 'The order', ref('GarageOrder')], { params: [idParam()], errors: [404] }) },
  '/api/v1/garage/orders/{id}/accept': { post: G("Accept the shop's quote", [200, 'CONFIRMED', ref('GarageOrder')], { params: [idParam()], errors: [404, 409] }) },
  '/api/v1/garage/orders/{id}/cancel': { post: G('Cancel an order', [200, 'CANCELLED', ref('GarageOrder')], { params: [idParam()], errors: [404, 409] }) },
  '/api/v1/garage/orders/{id}/pickup': { put: G('Change delivery or who collects', [200, 'Updated', ref('GarageOrder')], { params: [idParam()], body: v.pickupPatch, errors: [404, 409, 422] }) },
  '/api/v1/pickups': {
    get: {
      tag: 'pickups', access: 'signedIn', summary: 'Parts the caller has to collect',
      description: "As a mechanic named on an order, or as the owner of the job's car (matched on the plates registered in the caller's Kaduna account). Collected ones stay for three days.",
      ok: [200, 'Newest first', arr(ref('Pickup'))],
    },
  },
};

/** Who may call each shop route (the permissions in services/staff.ts, in words). */
const WHO = {
  all: 'Everyone at the shop.',
  sell: 'Owner, managers and cashiers.',
  stockroom: 'Owner, managers and storekeepers.',
  orders: 'Owner, managers, cashiers and storekeepers.',
  managers: 'Owner and managers.',
  owner: 'Owner only.',
  approval: "Owner and managers; cashiers with a manager's PIN.",
};
const ROLE_BY_ROUTE: [RegExp, string][] = [
  [/^put \/api\/v1\/shop\/pin$/, WHO.all],
  [/^(get|post|patch) \/api\/v1\/shop\/staff/, WHO.owner],
  [/^get \/api\/v1\/shop\/(dashboard|reports|audit)/, WHO.managers],
  [/^get \/api\/v1\/shop\/cash\/(current|sessions)/, `${WHO.all} Each person sees their own drawer; owner and managers see all.`],
  [/^post \/api\/v1\/shop\/cash\/sessions$/, WHO.sell],
  [/^post \/api\/v1\/shop\/cash\/sessions\/\{id\}\/close$/, `${WHO.sell} Your own drawer, or any for owner and managers.`],
  [/^post \/api\/v1\/shop\/cash\/sessions\/\{id\}\/movements$/, WHO.managers],
  [/^get \/api\/v1\/shop\/(parts|categories|tags|locations)(\/lookup|\/\{id\}|\/\{id\}\/trade)?$/, `${WHO.all} Cost prices only for owner, managers and storekeepers.`],
  [/^(post|patch) \/api\/v1\/shop\/locations/, WHO.stockroom],
  [/^(get|post|patch|put) \/api\/v1\/shop\/parts/, WHO.stockroom],
  [/^(get|post|put) \/api\/v1\/shop\/stocktakes/, WHO.stockroom],
  [/\/api\/v1\/shop\/(suppliers|payables|supplier-returns|reorder|purchases)/, WHO.stockroom],
  [/^post \/api\/v1\/shop\/sales\/\{id\}\/(returns|void)$/, WHO.approval],
  [/^post \/api\/v1\/shop\/sales\/\{id\}\/exchange$/, `${WHO.sell} Refunding a leftover in money, or overriding a return rule, needs a manager.`],
  [/^post \/api\/v1\/shop\/credits\/\{id\}\/cancel$/, WHO.managers],
  [/^get \/api\/v1\/shop\/credits/, WHO.sell],
  [/^post \/api\/v1\/shop\/warranty\/claims\/\{id\}\/resolve$/, WHO.approval],
  [/^post \/api\/v1\/shop\/warranty\/claims\/\{id\}\/supplier$/, WHO.stockroom],
  [/\/api\/v1\/shop\/warranty\/claims/, `${WHO.sell} Storekeepers can see them.`],
  [/^get \/api\/v1\/shop\/return-rules$/, WHO.all],
  [/^put \/api\/v1\/shop\/return-rules$/, WHO.owner],
  [/\/api\/v1\/shop\/(sales|drafts|warranty)/, WHO.sell],
  [/^(post \/api\/v1\/shop\/accounts$|patch \/api\/v1\/shop\/accounts\/\{id\}$|post \/api\/v1\/shop\/accounts\/\{id\}\/adjustments$)/, WHO.managers],
  [/\/api\/v1\/shop\/accounts/, WHO.sell],
  [/\/api\/v1\/shop\/orders/, WHO.orders],
];
const roleNote = (key: string) => ROLE_BY_ROUTE.find(([re]) => re.test(key))?.[1] ?? WHO.managers;


const operationIds: Record<string, string> = {
  'get /api/v1/public/shops': 'listPublicShops',
  'get /api/v1/public/parts': 'searchPublicParts',
  'get /api/v1/public/categories': 'listPublicCategories',
  'get /api/v1/me': 'getMe',
  'get /api/v1/shop': 'getShop',
  'put /api/v1/shop': 'saveShop',
  'get /api/v1/shop/dashboard': 'getDashboard',
  'get /api/v1/shop/reports': 'getReport',
  'get /api/v1/shop/parts': 'listParts',
  'post /api/v1/shop/parts': 'createPart',
  'get /api/v1/shop/parts/lookup': 'lookupPart',
  'get /api/v1/shop/categories': 'listCategories',
  'get /api/v1/shop/parts/{id}': 'getPart',
  'patch /api/v1/shop/parts/{id}': 'updatePart',
  'put /api/v1/shop/parts/{id}/fitments': 'replaceFitments',
  'post /api/v1/shop/parts/{id}/adjust': 'adjustStock',
  'get /api/v1/shop/suppliers': 'listSuppliers',
  'post /api/v1/shop/suppliers': 'createSupplier',
  'patch /api/v1/shop/suppliers/{id}': 'updateSupplier',
  'get /api/v1/shop/reorder': 'getReorderList',
  'get /api/v1/shop/purchases': 'listPurchases',
  'post /api/v1/shop/purchases': 'createPurchase',
  'get /api/v1/shop/purchases/{id}': 'getPurchase',
  'patch /api/v1/shop/purchases/{id}': 'updatePurchase',
  'post /api/v1/shop/purchases/{id}/order': 'placePurchase',
  'post /api/v1/shop/purchases/{id}/receive': 'receivePurchase',
  'post /api/v1/shop/purchases/{id}/cancel': 'cancelPurchase',
  'get /api/v1/shop/sales': 'listSales',
  'post /api/v1/shop/sales': 'createSale',
  'get /api/v1/shop/sales/{id}': 'getSale',
  'post /api/v1/shop/sales/{id}/returns': 'createReturn',
  'get /api/v1/shop/accounts': 'listAccounts',
  'get /api/v1/shop/accounts/{id}': 'getAccount',
  'patch /api/v1/shop/accounts/{id}': 'updateAccountTerms',
  'post /api/v1/shop/accounts/{id}/payments': 'recordAccountPayment',
  'post /api/v1/shop/accounts/{id}/adjustments': 'recordAccountAdjustment',
  'get /api/v1/shop/orders': 'listShopOrders',
  'get /api/v1/shop/orders/{id}': 'getShopOrder',
  'post /api/v1/shop/orders/{id}/quote': 'quoteOrder',
  'post /api/v1/shop/orders/{id}/decline': 'declineOrder',
  'post /api/v1/shop/orders/{id}/ready': 'markOrderReady',
  'post /api/v1/shop/orders/{id}/complete': 'completeOrder',
  'get /api/v1/garage/shops': 'listShops',
  'get /api/v1/garage/shops/{id}': 'getShopForGarage',
  'get /api/v1/garage/shops/{id}/catalogue': 'getCatalogue',
  'put /api/v1/garage/shops/{id}/link': 'linkShop',
  'delete /api/v1/garage/shops/{id}/link': 'unlinkShop',
  'get /api/v1/garage/shops/{id}/statement': 'getStatement',
  'get /api/v1/garage/orders': 'listGarageOrders',
  'post /api/v1/garage/orders': 'createGarageOrder',
  'get /api/v1/garage/orders/pickup-options': 'getPickupOptions',
  'get /api/v1/garage/orders/{id}': 'getGarageOrder',
  'post /api/v1/garage/orders/{id}/accept': 'acceptQuote',
  'post /api/v1/garage/orders/{id}/cancel': 'cancelGarageOrder',
  'put /api/v1/garage/orders/{id}/pickup': 'changePickup',
  'get /api/v1/pickups': 'listMyPickups',
  'put /api/v1/shop/pin': 'setApprovalPin',
  'get /api/v1/shop/staff': 'listStaff',
  'post /api/v1/shop/staff': 'addStaff',
  'patch /api/v1/shop/staff/{id}': 'updateStaff',
  'get /api/v1/shop/audit': 'listActivity',
  'get /api/v1/shop/cash/current': 'getMyDrawer',
  'get /api/v1/shop/cash/sessions': 'listDrawers',
  'post /api/v1/shop/cash/sessions': 'openDrawer',
  'get /api/v1/shop/cash/sessions/{id}': 'getDrawer',
  'post /api/v1/shop/cash/sessions/{id}/movements': 'moveDrawerCash',
  'post /api/v1/shop/cash/sessions/{id}/close': 'closeDrawer',
  'get /api/v1/shop/reports/stock': 'getStockReport',
  'get /api/v1/shop/reports/ageing': 'getAgeingReport',
  'get /api/v1/shop/parts/export': 'exportParts',
  'post /api/v1/shop/parts/import': 'importParts',
  'post /api/v1/shop/parts/barcodes': 'assignBarcodes',
  'get /api/v1/shop/stocktakes': 'listStocktakes',
  'post /api/v1/shop/stocktakes': 'startStocktake',
  'get /api/v1/shop/stocktakes/{id}': 'getStocktake',
  'put /api/v1/shop/stocktakes/{id}/lines': 'enterCounts',
  'post /api/v1/shop/stocktakes/{id}/post': 'postStocktake',
  'post /api/v1/shop/stocktakes/{id}/cancel': 'cancelStocktake',
  'get /api/v1/shop/suppliers/{id}/statement': 'getSupplierStatement',
  'post /api/v1/shop/suppliers/{id}/bills': 'addSupplierBill',
  'post /api/v1/shop/suppliers/{id}/payments': 'paySupplier',
  'post /api/v1/shop/suppliers/{id}/adjustments': 'adjustSupplier',
  'get /api/v1/shop/payables': 'listPayables',
  'get /api/v1/shop/supplier-returns': 'listSupplierReturns',
  'post /api/v1/shop/supplier-returns': 'returnToSupplier',
  'post /api/v1/shop/sales/{id}/void': 'voidSale',
  'get /api/v1/shop/warranty': 'lookupWarranty',
  'get /api/v1/shop/drafts': 'listDrafts',
  'post /api/v1/shop/drafts': 'saveDraft',
  'get /api/v1/shop/drafts/{id}': 'getDraft',
  'post /api/v1/shop/drafts/{id}/cancel': 'cancelDraft',
  'post /api/v1/shop/accounts': 'createCustomerAccount',
  'post /api/v1/shop/parts/{id}/transfer': 'transferStock',
  'get /api/v1/shop/parts/{id}/trade': 'getPartTrade',
  'put /api/v1/shop/parts/{id}/substitutes': 'addSubstitute',
  'delete /api/v1/shop/parts/{id}/substitutes/{otherId}': 'removeSubstitute',
  'post /api/v1/shop/parts/{id}/files/link': 'addPartLink',
  'post /api/v1/shop/parts/{id}/files/uploads': 'startPartUpload',
  'post /api/v1/shop/parts/{id}/files/{fileId}/complete': 'completePartUpload',
  'patch /api/v1/shop/parts/{id}/files/{fileId}': 'updatePartFile',
  'delete /api/v1/shop/parts/{id}/files/{fileId}': 'removePartFile',
  'get /api/v1/shop/locations': 'listLocations',
  'post /api/v1/shop/locations': 'createLocation',
  'patch /api/v1/shop/locations/{id}': 'updateLocation',
  'get /api/v1/shop/tags': 'listTags',
  'put /api/v1/shop/parts/{id}/kit': 'setKit',
  'delete /api/v1/shop/parts/{id}/kit': 'unsetKit',
  'post /api/v1/shop/parts/{id}/open': 'openPacks',
  'post /api/v1/shop/sales/{id}/exchange': 'exchangeSale',
  'get /api/v1/shop/credits': 'listStoreCredit',
  'get /api/v1/shop/credits/{code}': 'findStoreCredit',
  'post /api/v1/shop/credits/{id}/cancel': 'cancelStoreCredit',
  'get /api/v1/shop/warranty/claims': 'listWarrantyClaims',
  'post /api/v1/shop/warranty/claims': 'openWarrantyClaim',
  'get /api/v1/shop/warranty/claims/{id}': 'getWarrantyClaim',
  'post /api/v1/shop/warranty/claims/{id}/resolve': 'resolveWarrantyClaim',
  'post /api/v1/shop/warranty/claims/{id}/supplier': 'claimOnSupplier',
  'get /api/v1/shop/return-rules': 'listReturnRules',
  'put /api/v1/shop/return-rules': 'setReturnRules',
  'get /api/v1/files/{token}': 'downloadFile',
  'put /api/v1/files/{token}': 'uploadFile',
};

export function buildOpenApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Kaduna.lk — Parts Management Service',
      version: '1.0.0',
      description:
        'The spare parts shop system: inventory with vehicle fitment, stock control and stocktakes, purchasing with supplier bills and returns, counter sales (split payments, accounts, discounts with manager approval, VAT, warranty, core deposits, voids, held sales and quotations), cash drawers, credit accounts, and garage orders for a job, delivered or collected (by a mechanic or the car owner) against a handover code. ' +
        'Every /api/v1 route needs a Supabase bearer token. Any account can run one shop and add staff (manager, cashier, storekeeper) by email; garages act through their owner or mechanics, as known to the garage-management service. ' +
        'Generated from src/openapi.ts (request shapes come from the zod validators); do not edit by hand.',
    },
    servers: [
      { url: 'https://parts.kaduna.lk', description: 'Production' },
      { url: 'http://localhost:3003', description: 'Local development' },
    ],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'shop', description: 'The shop itself and its home screen' },
      { name: 'staff', description: 'Staff, roles, approval PINs and the activity log' },
      { name: 'cash', description: 'Cash drawers: float, pay in and out, count and close' },
      { name: 'inventory', description: 'Parts, fitment, stock control, import and export, barcodes and stocktakes' },
      { name: 'purchasing', description: 'Suppliers, purchase orders, receiving, bills, payments and returns' },
      { name: 'sales', description: 'Counter sales, returns, voids, held sales, quotations and warranty' },
      { name: 'accounts', description: 'Credit accounts (garages and customers): terms, statements and payments' },
      { name: 'orders', description: 'Orders from garages, from the shop side' },
      { name: 'reports', description: 'Sales, profit, VAT, cashiers, stock value, dead stock and ageing' },
      { name: 'garages', description: 'The garage side: finding shops, catalogue, account, orders' },
      { name: 'pickups', description: 'What mechanics and car owners collect' },
      { name: 'public', description: 'No sign-in: shops and listed parts for kaduna.lk' },
      { name: 'files', description: 'The local file store: signed upload and download links' },
      { name: 'health', description: 'Liveness' },
    ],
    paths: {
      '/health': {
        get: {
          operationId: 'health', tags: ['health'], summary: 'Liveness and database check', security: [],
          responses: { 200: reply('Healthy', obj({ service: { const: 'parts-management' }, status: { const: 'healthy' }, database: { const: 'connected' } })), 503: failure('Database unreachable') },
        },
      },
      ...Object.fromEntries(Object.entries(paths).map(([path, ops]) => [path, Object.fromEntries(Object.entries(ops).map(([m, op]) => [m, operation(`${m} ${path}`, op)]))])),
    },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Supabase access token' } }, schemas: responses },
  };
}
