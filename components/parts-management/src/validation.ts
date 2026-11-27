/**
 * Request bodies and queries, validated at the API boundary with zod. The
 * same schemas feed the OpenAPI contract (src/openapi.ts).
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const money = z.number().min(0).max(99_999_999);
const quantity = z.number().positive().max(99_999);
const id = z.string().min(1).max(64);
const bool = z.enum(['true', 'false']).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Money changing hands. */
export const paymentMethods = ['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;
/** How a counter sale can be paid: money, or on the customer's account. */
export const saleMethods = [...paymentMethods, 'ACCOUNT', 'VOUCHER'] as const;
export const orderStatuses = ['REQUESTED', 'QUOTED', 'CONFIRMED', 'READY', 'COMPLETED', 'DECLINED', 'CANCELLED'] as const;
export const purchaseStatuses = ['DRAFT', 'ORDERED', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export const stockReasons = ['OPENING', 'PURCHASE', 'SALE', 'GARAGE_ORDER', 'RETURN', 'ADJUSTMENT', 'DAMAGED', 'STOCKTAKE', 'VOID', 'RETURN_TO_SUPPLIER', 'MOVE', 'BREAK_BULK', 'WARRANTY'] as const;
export const staffRoles = ['MANAGER', 'CASHIER', 'STOREKEEPER'] as const;
export const roles = ['OWNER', ...staffRoles] as const;
const pin = z.string().regex(/^\d{4,6}$/, '4 to 6 digits');
const approvalPin = pin.nullish().describe("A manager's PIN, when the caller's role can't do this on their own");

// ─── The shop ───────────────────────────────────────────────────────────────

export const shopInput = z.object({
  name: text(160).describe('Shop name, as garages and customers see it'),
  phone: optionalText(40),
  email: z.email().max(200).nullish(),
  address: optionalText(500).describe('Where collectors come to pick parts up'),
  city: optionalText(80),
  registrationNo: optionalText(80).describe('Business registration or VAT number, printed on receipts'),
  openingHours: optionalText(200),
  // No zod defaults here: left out of an edit, each keeps its saved value.
  delivers: z.boolean().optional().describe('Whether the shop delivers; true when first set up and left out'),
  deliveryNote: optionalText(500).describe('Areas, fees and times for delivery'),
  taxRate: z.number().min(0).max(100).optional().describe('Percent added to counter sales; 0 when left out at setup'),
  receiptFooter: optionalText(500),
  vatNumber: optionalText(40).describe('VAT registration number; needed for tax invoices'),
  receiptWidth: z.enum(['58mm', '80mm', 'A4']).optional().describe('Receipt printer: thermal roll width, or A4'),
  maxDiscountPct: z.number().min(0).max(100).optional().describe('Discounts deeper than this need a manager (percent off the list price)'),
  requireCashSession: z.boolean().optional().describe("true: cash can't be taken without an open cash drawer"),
});
export const shopPatch = shopInput.partial().extend({ active: z.boolean().optional().describe('false: hidden from garages, no new garage orders') });

// ─── Inventory ──────────────────────────────────────────────────────────────

export const fitmentInput = z
  .object({
    make: text(60),
    model: text(80),
    yearFrom: z.number().int().min(1950).max(2100).nullish(),
    yearTo: z.number().int().min(1950).max(2100).nullish(),
    note: optionalText(120).describe('Engine or variant, e.g. "1.5 hybrid"'),
  })
  .refine((f) => f.yearFrom == null || f.yearTo == null || f.yearFrom <= f.yearTo, { message: 'yearFrom must be before yearTo', path: ['yearTo'] });

export const specInput = z.object({ name: text(60).describe('e.g. "Thread size"'), value: text(120).describe('e.g. "M12 x 1.5"') });

const partFields = {
  sku: text(60).describe("The shop's own code, unique in the shop"),
  name: text(160),
  description: optionalText(1000),
  brand: optionalText(80),
  category: optionalText(80),
  oemNumber: optionalText(80).describe("The carmaker's part number"),
  partNumber: optionalText(80).describe("The part maker's number"),
  crossRefs: z.array(z.string().trim().min(1).max(80)).max(30).optional().describe('Other numbers this part is known by'),
  barcode: optionalText(80),
  location: optionalText(60).describe('Default location by name, e.g. A3-02 (made if new). Or give defaultLocationId'),
  defaultLocationId: id.nullish().describe('Where new stock goes and the counter takes from first'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().describe('Free labels; stored lower case'),
  specs: z.array(specInput).max(50).optional().describe('Specifications, e.g. [{ "name": "Voltage", "value": "12 V" }]'),
  unit: z.string().trim().min(1).max(20).optional(),
  costPrice: money.optional(),
  retailPrice: money,
  tradePrice: money.nullish().describe('What garages pay; empty: the retail price'),
  reorderLevel: z.number().min(0).max(99_999).optional(),
  reorderQty: z.number().min(0).max(99_999).optional(),
  universal: z.boolean().optional().describe('Fits any vehicle (oil, bulbs, wipers by size): no fitment filtering'),
  listed: z.boolean().optional().describe('Shown to garages in the online catalogue (default true)'),
  supplierId: id.nullish().describe('Usually bought from'),
  notes: optionalText(1000),
  taxRate: z.number().min(0).max(100).nullish().describe("VAT percent for this part; empty: the shop's rate, 0: exempt"),
  warrantyMonths: z.number().int().min(0).max(120).nullish().describe('Warranty from the day of sale'),
  coreCharge: money.nullish().describe('Refundable deposit until the old unit is brought back'),
  serialized: z.boolean().optional().describe('Ask for each unit serial number at the counter'),
  fractional: z.boolean().optional().describe('Sold by measure (litres, metres): any quantity, not just whole units'),
  quickQtys: z.array(z.number().positive().max(9999)).max(8).optional().describe('Quick amounts at the counter, e.g. [0.5, 1, 4]'),
  purchaseUnit: optionalText(20).describe('Bought in a bigger unit, e.g. "drum", "box"'),
  purchaseFactor: z.number().positive().max(100_000).optional().describe('Selling units per purchase unit, e.g. 208 litres in a drum (1: the same)'),
  breaksIntoId: id.nullish().describe('A sealed pack: the loose part it opens into'),
  breaksIntoQty: z.number().positive().max(100_000).nullish().describe('How many of the loose part one pack makes, e.g. 4 (litres)'),
  warrantyFreeMonths: z.number().int().min(0).max(120).nullish().describe('Months of the warranty that are free; after that a replacement is charged pro rata'),
};

export const partInput = z.object({
  ...partFields,
  openingStock: z.number().min(0).max(99_999).default(0).describe('Stock on the shelf now, recorded as OPENING'),
  fitments: z.array(fitmentInput).max(50).default([]),
});
export const partPatch = z.object(partFields).partial().extend({ active: z.boolean().optional() });
export const fitmentsInput = z.object({ fitments: z.array(fitmentInput).max(50) });

export const partsQuery = z.object({
  q: z.string().trim().max(100).optional().describe('Name, SKU, OEM, part or cross-reference number, brand, barcode'),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(80).optional(),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
  category: z.string().trim().max(80).optional(),
  tag: z.string().trim().max(40).optional(),
  locationId: id.optional().describe('Only parts with stock at this location'),
  lowStock: bool.describe('true: at or below the reorder level'),
  includeInactive: bool,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const lookupQuery = z.object({ code: z.string().trim().min(1).max(80).describe('Barcode, SKU or part number') });

export const adjustInput = z
  .object({
    change: z.number().min(-99_999).max(99_999).nullish().describe('Add (+) or remove (−) this many'),
    countedQty: z.number().min(0).max(99_999).nullish().describe('Or: set stock to what was counted'),
    reason: z.enum(['ADJUSTMENT', 'DAMAGED']).default('ADJUSTMENT'),
    locationId: id.nullish().describe("Where; the part's default location if left out"),
    note: optionalText(500),
  })
  .refine((a) => (a.change == null) !== (a.countedQty == null), { message: 'Give either change or countedQty' });

export const transferInput = z.object({
  fromLocationId: id,
  toLocationId: id,
  quantity,
  note: optionalText(500),
});

export const kitInput = z.object({
  components: z.array(z.object({ partId: id, quantity: z.number().positive().max(9999) })).min(1).max(30).describe('What one kit takes out of stock'),
});
export const breakInput = z.object({
  quantity: z.number().int().positive().max(9999).describe('How many packs to open'),
  locationId: id.nullish().describe('Take the packs from here'),
  intoLocationId: id.nullish().describe("Put the loose stock here; the loose part's default location if left out"),
});

export const locationInput = z.object({ name: text(60).describe('e.g. "A3-02", "Back store", "Van 1"'), note: optionalText(500) });
export const locationPatch = z.object({ name: text(60).optional(), note: optionalText(500), active: z.boolean().optional().describe('false: not used any more (must be empty)') });

export const substituteInput = z.object({ partId: id.describe('The part that can stand in'), note: optionalText(300).describe('e.g. "Same pads, Akebono brand"') });

export const fileKinds = ['IMAGE', 'DOCUMENT', 'LINK'] as const;
export const linkInput = z.object({
  name: text(160),
  url: z.url({ protocol: /^https?$/ }).max(2000),
  kind: z.enum(fileKinds).default('LINK').describe('IMAGE: show it as a photo (a direct image URL)'),
});
export const uploadInput = z.object({
  name: text(160).describe('The file name'),
  contentType: z.string().trim().min(3).max(100).describe('e.g. image/jpeg, application/pdf'),
  size: z.number().int().positive().max(25_000_000).describe('Bytes'),
});
export const filePatch = z.object({ name: text(160).optional(), primary: z.literal(true).optional().describe('Make this the photo shown for the part') });

// ─── Purchasing ─────────────────────────────────────────────────────────────

export const supplierInput = z.object({
  name: text(160),
  paymentDays: z.number().int().min(0).max(365).optional().describe('Days to pay a bill that has no due date (default 30)'),
  contactName: optionalText(120),
  phone: optionalText(40),
  email: z.email().max(200).nullish(),
  address: optionalText(500),
  notes: optionalText(2000),
});
export const supplierPatch = supplierInput.partial().extend({ active: z.boolean().optional() });
export const searchQuery = z.object({ q: z.string().trim().max(100).optional(), includeInactive: bool });

const purchaseLine = z.object({ partId: id, quantity, unitCost: money.optional().describe("Defaults to the part's cost price") });
export const purchaseInput = z.object({
  supplierId: id,
  expectedAt: z.iso.datetime({ offset: true }).nullish(),
  note: optionalText(1000),
  items: z.array(purchaseLine).min(1).max(200),
});
export const purchasePatch = purchaseInput.partial();
export const purchasesQuery = z.object({ status: z.enum(purchaseStatuses).optional(), supplierId: id.optional() });
const billFields = {
  reference: text(80).describe("The supplier's invoice number"),
  billDate: day.optional().describe('Defaults to today'),
  dueDate: day.nullish().describe("Defaults to the bill date plus the supplier's payment days"),
  note: optionalText(500),
};
export const receiveInput = z.object({
  items: z
    .array(z.object({ itemId: id, quantity: z.number().min(0).max(99_999), unitCost: money.optional().describe('If the invoice price differs'), locationId: id.nullish().describe("Where it goes; the part's default location if left out") }))
    .min(1)
    .max(200),
  extraCosts: money.default(0).describe('Freight, duty and clearing for this delivery: spread over the lines by value, into their cost'),
  bill: z.object({ ...billFields, amount: money.optional().describe('Defaults to the value received plus the extra costs') }).nullish().describe("Record the supplier's invoice for this delivery"),
  note: optionalText(500),
});

// ─── Counter sales ──────────────────────────────────────────────────────────

const saleLine = z.object({
  partId: id.nullish().describe('A stocked part: takes its name, price and VAT rate, and reduces stock'),
  description: optionalText(200).describe('Required without partId'),
  quantity,
  unitPrice: money.optional().describe('Override the price for this sale'),
  discount: money.default(0).describe('Off this line (an amount)'),
  taxRate: z.number().min(0).max(100).optional().describe("Without partId: VAT percent (default the shop's rate)"),
  serialNumbers: z.array(z.string().trim().min(1).max(80)).max(100).optional().describe('Serialized parts: one per unit'),
  coreReturned: z.boolean().default(false).describe('The customer handed the old unit in: no core deposit'),
  locationId: id.nullish().describe("Take it from here; otherwise the part's default location first"),
});
const customerFields = {
  customerName: optionalText(160),
  customerPhone: optionalText(40),
  customerAddress: optionalText(500),
  customerVatNo: optionalText(40),
  plate: optionalText(20),
};
export const saleInput = z
  .object({
    items: z.array(saleLine).min(1).max(100),
    discount: money.default(0).describe('Off the whole sale, after line discounts'),
    payments: z
      .array(z.object({ method: z.enum(saleMethods), amount: z.number().positive().max(99_999_999), reference: optionalText(80).describe('Card slip or transfer number') }))
      .min(1)
      .max(5)
      .optional()
      .describe('How it was paid; must add up to the total. Or give paymentMethod for one payment of the total'),
    paymentMethod: z.enum(saleMethods).optional().describe('Shorthand for one payment of the whole total'),
    tendered: money.nullish().describe('Cash handed over, for the change'),
    accountId: id.nullish().describe('ACCOUNT payments: the trade or customer account to charge'),
    taxInvoice: z.boolean().default(false).describe('Issue a VAT tax invoice (needs the shop VAT number and the buyer name)'),
    ...customerFields,
    note: optionalText(500),
    draftId: id.nullish().describe('Completes this held sale or quote'),
    approvalPin,
  })
  .refine((s) => s.payments || s.paymentMethod, { message: 'Give payments or paymentMethod', path: ['payments'] });
export const salesQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  q: z.string().trim().max(100).optional().describe('Customer, phone, plate or sale number'),
  accountId: id.optional(),
});
const returnLines = z.array(z.object({ saleItemId: id, quantity, restock: z.boolean().default(true).describe('false: damaged, not back on the shelf') })).min(1).max(100);
const ruleOverrides = {
  override: z.boolean().default(false).describe("Take it back even though the shop's return rules say no (owner or manager)"),
  waiveFee: z.boolean().default(false).describe('Skip the restocking fee (owner or manager)'),
};
export const returnInput = z.object({
  items: returnLines,
  refundMethod: z.enum(saleMethods).describe('ACCOUNT: credit the account the sale was charged to. VOUCHER: store credit'),
  reason: optionalText(500),
  ...ruleOverrides,
  approvalPin,
});
export const exchangeInput = z
  .object({
    returnItems: returnLines.describe('What comes back from this sale'),
    items: z.array(saleLine).min(1).max(100).describe('What the customer takes instead'),
    discount: money.default(0),
    payments: z.array(z.object({ method: z.enum(saleMethods), amount: z.number().positive().max(99_999_999), reference: optionalText(80) })).max(5).optional().describe('For a difference to pay'),
    paymentMethod: z.enum(saleMethods).optional().describe('Shorthand for one payment of the difference'),
    tendered: money.nullish(),
    balanceTo: z.enum([...paymentMethods, 'ACCOUNT', 'VOUCHER']).default('VOUCHER').describe('If what came back is worth more: refund the rest this way (VOUCHER: store credit)'),
    reason: optionalText(500),
    ...ruleOverrides,
    approvalPin,
  });
export const voidInput = z.object({ reason: text(500), approvalPin });

export const creditsQuery = z.object({ q: z.string().trim().max(80).optional().describe('Code, customer or phone'), status: z.enum(['ACTIVE', 'USED', 'CANCELLED']).optional() });
export const creditCancelInput = z.object({ note: text(300) });

// ─── Warranty claims ────────────────────────────────────────────────────────

export const claimInput = z
  .object({
    saleItemId: id.nullish().describe('The sold item (from a warranty lookup)'),
    serialNumber: optionalText(80).describe('Or find it by serial number'),
    fault: text(1000).describe('What the customer says is wrong'),
    customerPhone: optionalText(40),
  })
  .refine((c) => c.saleItemId || c.serialNumber, { message: 'Give saleItemId or serialNumber', path: ['saleItemId'] });
export const claimsQuery = z.object({ status: z.enum(['OPEN', 'REPLACED', 'REFUNDED', 'REPAIRED', 'REJECTED']).optional(), supplier: z.enum(['PENDING']).optional().describe('PENDING: waiting on a supplier') });
export const resolveClaimInput = z.object({
  outcome: z.enum(['REPLACE', 'REFUND', 'REPAIR', 'REJECT']),
  charge: money.nullish().describe("REPLACE: what the customer pays (pro rata); left out: the suggested charge"),
  paymentMethod: z.enum(saleMethods).nullish().describe('REPLACE with a charge: how it was paid'),
  serialNumber: optionalText(80).describe('REPLACE, serialized parts: the new unit'),
  refundMethod: z.enum(saleMethods).nullish().describe('REFUND: how'),
  locationId: id.nullish().describe('REPLACE: take the new unit from here'),
  note: optionalText(1000),
  approvalPin,
});
export const supplierClaimInput = z.object({
  action: z.enum(['SEND', 'CREDITED', 'REPLACED', 'REJECTED']),
  supplierId: id.nullish().describe("SEND: who to claim from; defaults to the part's usual supplier"),
  amount: money.nullish().describe("CREDITED: the credit; defaults to the part's cost"),
  locationId: id.nullish().describe('REPLACED: where the new unit goes'),
  note: optionalText(500),
});

// ─── Return rules ───────────────────────────────────────────────────────────

export const returnRulesInput = z.object({
  rules: z
    .array(
      z.object({
        category: optionalText(80).describe('null: the default for every category without its own rule'),
        returnable: z.boolean().default(true),
        days: z.number().int().min(0).max(3650).nullish().describe('Days after the sale; empty: any time'),
        feePct: z.number().min(0).max(100).default(0).describe('Restocking fee, percent of the refund'),
        note: optionalText(300),
      }),
    )
    .max(100),
});

export const draftInput = z.object({
  kind: z.enum(['HELD', 'QUOTE']),
  items: z.array(saleLine).min(1).max(100),
  discount: money.default(0),
  ...customerFields,
  accountId: id.nullish(),
  note: optionalText(500),
  validDays: z.number().int().min(1).max(90).default(14).describe('QUOTE: how long the prices hold'),
});
export const draftsQuery = z.object({ kind: z.enum(['HELD', 'QUOTE']).optional(), status: z.enum(['OPEN', 'CONVERTED', 'CANCELLED']).default('OPEN') });
export const warrantyQuery = z.object({ q: text(80).describe('Serial number, or a sale number') });

// ─── Cash drawer ────────────────────────────────────────────────────────────

export const openSessionInput = z.object({ openingFloat: money.describe('Cash in the drawer to start with'), note: optionalText(500) });
export const cashMovementInput = z.object({ kind: z.enum(['PAY_IN', 'PAY_OUT']), amount: z.number().positive().max(99_999_999), reason: text(200) });
export const closeSessionInput = z.object({ countedCash: money.describe('Cash counted in the drawer'), note: optionalText(500) });
export const sessionsQuery = z.object({ from: day.optional(), to: day.optional(), status: z.enum(['OPEN', 'CLOSED']).optional() });

// ─── Staff ──────────────────────────────────────────────────────────────────

export const staffInput = z.object({
  email: z.email().max(200).describe('They sign in to Kaduna with this email to get in'),
  name: text(120),
  phone: optionalText(40),
  role: z.enum(staffRoles),
});
export const staffPatch = z.object({ name: text(120).optional(), phone: optionalText(40), role: z.enum(staffRoles).optional(), active: z.boolean().optional() });
export const pinInput = z.object({ pin });
export const auditQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  action: z.string().trim().max(40).optional().describe('e.g. sale, sale.void, stock, cash'),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// ─── Trade accounts ─────────────────────────────────────────────────────────

export const customerAccountInput = z.object({
  name: text(160),
  phone: optionalText(40),
  address: optionalText(500),
  creditLimit: money.default(0),
  paymentDays: z.number().int().min(0).max(180).default(30),
});
export const accountPatch = z.object({
  name: text(160).optional().describe('CUSTOMER accounts only'),
  phone: optionalText(40).describe('CUSTOMER accounts only'),
  address: optionalText(500).describe('CUSTOMER accounts only'),
  creditLimit: money.optional().describe('0: everything is paid on handover'),
  paymentDays: z.number().int().min(0).max(180).optional(),
  onHold: z.boolean().optional().describe('true: new orders are pay on handover'),
});
const paymentShape = () =>
  z.object({
    amount: z.number().positive().max(99_999_999),
    method: z.enum(paymentMethods),
    reference: optionalText(80).describe('Cheque or transfer number'),
    note: optionalText(500),
  });
export const paymentInput = paymentShape();
export const adjustmentInput = z.object({
  amount: z.number().min(-99_999_999).max(99_999_999).refine((n) => n !== 0, 'Not zero').describe('+ adds to what the garage owes, − takes off (credit note)'),
  note: text(500),
});

// ─── Garage orders ──────────────────────────────────────────────────────────

const fulfilmentFields = {
  fulfilment: z.enum(['DELIVERY', 'PICKUP']),
  deliveryAddress: optionalText(500).describe("DELIVERY: defaults to the garage's address"),
  pickupBy: z.enum(['MECHANIC', 'VEHICLE_OWNER']).nullish().describe('PICKUP: who collects'),
  pickupStaffId: id.nullish().describe("PICKUP by MECHANIC: the mechanic's id in the garage"),
};

export const orderInput = z.object({
  shopId: id,
  jobCardId: id.nullish().describe('The job the parts are for'),
  ...fulfilmentFields,
  note: optionalText(1000),
  items: z
    .array(
      z.object({
        partId: id.nullish().describe("From the shop's catalogue: its name and trade price are used"),
        description: optionalText(200).describe('Required without partId: what you need'),
        partNumber: optionalText(80),
        quantity,
      }),
    )
    .min(1)
    .max(50),
});
export const pickupPatch = z.object(fulfilmentFields);
export const ordersQuery = z.object({
  status: z.enum(orderStatuses).optional(),
  jobCardId: id.optional(),
  open: bool.describe('true: only orders not yet handed over, declined or cancelled'),
});
export const pickupOptionsQuery = z.object({ jobCardId: id.optional() });

export const quoteInput = z.object({
  items: z
    .array(
      z.object({
        id,
        unitPrice: money.nullish().describe('Required for an available line'),
        available: z.boolean().default(true),
        partId: id.nullish().describe('Match a requested line to a stocked part, so stock goes down when it is handed over'),
      }),
    )
    .min(1)
    .max(50),
  sellerNote: optionalText(1000),
});
export const sellerNoteInput = z.object({ sellerNote: optionalText(1000) });
export const handoverInput = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'The 6-digit code from the collector or the garage'),
  paymentMethod: z.enum(paymentMethods).nullish().describe('Pay-on-handover orders: how it was paid'),
});

export const directoryQuery = z.object({ q: z.string().trim().max(100).optional().describe('Shop name or city'), linked: bool.describe("true: only shops on this garage's list") });
export const catalogueQuery = z.object({
  q: z.string().trim().max(100).optional(),
  jobCardId: id.optional().describe("Filter to parts that fit this job's car"),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(80).optional(),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
});

// ─── Reports ────────────────────────────────────────────────────────────────

export const reportQuery = z.object({ from: day.optional().describe('Defaults to the 1st of this month'), to: day.optional().describe('Inclusive; defaults to today') });
export const stockReportQuery = z.object({ deadDays: z.coerce.number().int().min(7).max(730).default(90).describe('No sale in this many days counts as dead stock') });

// ─── Stockroom: import, labels, stocktakes ──────────────────────────────────

export const importInput = z.object({
  csv: z.string().min(1).max(5_000_000).describe('The spreadsheet saved as CSV, with a header row (GET /parts/export shows the columns)'),
  dryRun: z.boolean().default(true).describe('true: check it and report what would change, without saving'),
});
export const barcodesInput = z.object({
  partIds: z.array(id).max(500).optional().describe('These parts; left out: every active part without a barcode'),
});
export const stocktakeInput = z.object({
  category: optionalText(80).describe('Only this category'),
  location: optionalText(60).describe('Only locations whose name starts with this, e.g. "A3"'),
  locationId: id.nullish().describe('Only this location'),
  note: optionalText(500),
});
export const countLinesInput = z.object({
  lines: z
    .array(z.object({ partId: id, locationId: id.nullish().describe("The location counted; the part's line in this count (its default location first) if left out"), countedQty: z.number().min(0).max(99_999).nullable().describe('null: not counted yet') }))
    .min(1)
    .max(500),
});
export const postCountInput = z.object({ zeroUncounted: z.boolean().default(false).describe('true: parts nobody counted are set to 0') });

// ─── What the shop owes its suppliers ───────────────────────────────────────

export const billInput = z.object({ ...billFields, amount: z.number().positive().max(99_999_999), purchaseId: id.nullish() });
export const supplierPaymentInput = paymentShape();
export const supplierAdjustmentInput = z.object({
  amount: z.number().min(-99_999_999).max(99_999_999).refine((n) => n !== 0, 'Not zero').describe('+ adds to what the shop owes, − takes off'),
  note: text(500),
});
export const supplierReturnInput = z.object({
  supplierId: id,
  purchaseId: id.nullish(),
  items: z.array(z.object({ partId: id, quantity, unitCost: money.optional().describe("Defaults to the part's cost"), locationId: id.nullish().describe('Take it from here') })).min(1).max(100),
  reason: optionalText(500),
});


// ─── Public (kaduna.lk) ─────────────────────────────────────────────────────

export const publicShopsQuery = z.object({ q: z.string().trim().max(100).optional().describe('Shop name or city') });
export const publicPartsQuery = z.object({
  q: z.string().trim().max(100).optional().describe('Name, brand or any part number'),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(80).optional(),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
  category: z.string().trim().max(80).optional(),
  shopId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
});
