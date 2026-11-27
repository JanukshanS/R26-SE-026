/**
 * Request bodies, validated at the API boundary with zod. The same schemas feed
 * the OpenAPI contract (src/openapi.ts), so the docs cannot drift from what the
 * service actually accepts.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const money = z.number().min(0).max(99_999_999);
const quantity = z.number().positive().max(99_999);
const id = z.string().min(1).max(64);

export const jobStatuses = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY', 'CLOSED', 'CANCELLED'] as const;

export const garageInput = z.object({
  name: text(160),
  phone: optionalText(40),
  address: optionalText(500),
  labourRate: money.default(0).describe('Default hourly labour charge, used when a labour line has no price.'),
  taxRate: z.number().min(0).max(100).default(0).describe('Percentage added to invoices.'),
  // Invoice branding. Left out of a request, each keeps its saved value.
  email: z.email().max(200).nullish(),
  registrationNo: optionalText(80).describe('Business registration or VAT number, printed on invoices'),
  logoUrl: z
    .string()
    .max(300_000)
    .refine((s) => /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(s) || /^https:\/\//.test(s), 'Use an https URL or a data:image URL')
    .nullish()
    .describe('A small data:image URL (under ~200 KB) or an https URL'),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #ff6a13')
    .nullish(),
  invoiceTerms: optionalText(1000).describe('Payment terms, for example "Due on collection"'),
  invoiceFooter: optionalText(500),
  bankDetails: optionalText(500),
});

export const customerInput = z.object({
  name: text(160),
  phone: optionalText(40),
  email: z.email().max(200).nullish(),
  notes: optionalText(2000),
});
export const customerPatch = customerInput.partial();

export const vehicleInput = z.object({
  customerId: id.nullish(),
  plate: optionalText(20),
  make: optionalText(60),
  model: optionalText(60),
  year: z.number().int().min(1950).max(2100).nullish(),
  odometerKm: z.number().int().min(0).nullish(),
  notes: optionalText(2000),
});
export const vehiclePatch = vehicleInput.partial();

export const partInput = z.object({
  sku: text(60),
  name: text(160),
  brand: optionalText(80),
  unitCost: money.default(0),
  unitPrice: money.default(0),
  reorderLevel: z.number().min(0).max(99_999).default(0),
  openingStock: z.number().min(0).max(99_999).default(0),
  supplierId: id.nullish().describe('Where the part is usually bought'),
  kind: z.enum(['PART', 'CONSUMABLE']).default('PART').describe('A consumable is bulk workshop supply (oil, cleaner, fasteners) used without a job'),
  category: optionalText(80),
  barcode: optionalText(64),
  locationId: id.nullish().describe('Which shelf or bay it is kept on'),
});
// .partial() alone keeps the create defaults (cost 0, price 0, ...), which would silently reset
// anything a PATCH leaves out. Re-declare those fields without defaults.
export const partPatch = partInput
  .omit({ sku: true, openingStock: true })
  .partial()
  .extend({
    unitCost: money.optional(),
    unitPrice: money.optional(),
    reorderLevel: partInput.shape.reorderLevel.unwrap().optional(),
    kind: z.enum(['PART', 'CONSUMABLE']).optional(),
    active: z.boolean().optional(),
  });

export const stockAdjustInput = z.object({
  quantityChange: z.number().refine((n) => n !== 0, 'Cannot be zero').describe('Positive adds stock, negative removes it.'),
  reason: z.enum(['PURCHASE', 'RETURN', 'ADJUSTMENT', 'WORKSHOP_USE']),
  note: optionalText(240),
  supplierId: id.nullish().describe("PURCHASE only: who supplied it. Becomes the part's usual supplier if it has none"),
  unitCost: money.nullish().describe("PURCHASE only: cost per unit. Becomes the part's cost price"),
});

export const jobCardInput = z.object({
  customerId: id.nullish(),
  vehicleId: id.nullish(),
  complaint: optionalText(4000),
  odometerIn: z.number().int().min(0).nullish(),
  assignedTo: optionalText(120),
  mechanicId: id.nullish().describe('The mechanic doing the work'),
  promisedAt: z.iso.datetime({ offset: true }).nullish(),
});
export const jobCardPatch = jobCardInput.partial().extend({ diagnosis: optionalText(4000) });

export const statusInput = z.object({ status: z.enum(jobStatuses) });

export const jobItemInput = z
  .object({
    kind: z.enum(['LABOUR', 'PART']),
    description: optionalText(240).describe('Defaults to the part name for inventory parts.'),
    quantity: quantity.default(1),
    unitPrice: money.nullish().describe("Defaults to the part's price, or the garage labour rate."),
    partId: id.nullish().describe('Use a part from inventory; its stock goes down.'),
  })
  .refine((v) => v.kind === 'PART' || !v.partId, { message: 'Only part lines can use inventory', path: ['partId'] })
  .refine((v) => Boolean(v.partId) || Boolean(v.description), { message: 'Describe the work or choose a part', path: ['description'] });

export const fromDispatchInput = z.object({ incidentId: id });

export const paymentInput = z.object({ method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER']) });

export const listJobsQuery = z.object({
  status: z.enum(jobStatuses).optional(),
  active: z.enum(['true', 'false']).optional().describe('true: only jobs not CLOSED or CANCELLED'),
  customerId: id.optional(),
  vehicleId: id.optional(),
  mechanicId: id.optional(),
  mine: z.enum(['true', 'false']).optional().describe('Mechanics: true for only the jobs assigned to you'),
  q: z.string().trim().max(100).optional(),
});
export const searchQuery = z.object({ q: z.string().trim().max(100).optional(), customerId: id.optional() });
export const partsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  kind: z.enum(['PART', 'CONSUMABLE']).optional(),
  category: z.string().trim().max(80).optional(),
  locationId: z.string().max(64).optional(),
});
export const invoicesQuery = z.object({ status: z.enum(['UNPAID', 'PAID', 'VOID']).optional() });

// ─── Staff ─────────────────────────────────────────────────────────────────

export const staffInput = z.object({ name: text(120), phone: optionalText(40) });
export const staffPatch = staffInput.partial().extend({ active: z.boolean().optional().describe('false: the mechanic can no longer sign in to the garage') });
export const joinInput = z.object({ code: z.string().trim().toUpperCase().min(6).max(12).describe('The invite code the garage owner gave you') });

// ─── Job timeline ────────────────────────────────────────────────────────────

export const jobUpdateInput = z.object({
  note: text(1000),
  public: z.boolean().default(true).describe('Shown to the customer on the tracking link'),
});

// ─── Inspections ───────────────────────────────────────────────────────────

export const checkResults = ['NOT_CHECKED', 'OK', 'ATTENTION', 'URGENT'] as const;
export const approvals = ['PENDING', 'APPROVED', 'DECLINED'] as const;

export const inspectionCreateInput = z.object({
  template: z.enum(['STANDARD', 'BLANK']).default('STANDARD').describe('STANDARD starts with a 25-point checklist'),
});
export const inspectionPatch = z.object({ summary: optionalText(2000) });
export const inspectionItemInput = z.object({
  category: text(60),
  name: text(120),
  result: z.enum(checkResults).default('NOT_CHECKED'),
  note: optionalText(1000),
  estimate: money.nullish().describe('Price of the recommended work; items with one are sent for approval'),
});
export const inspectionItemPatch = z.object({
  result: z.enum(checkResults).optional(),
  note: optionalText(1000),
  estimate: money.nullish(),
  approval: z.enum(approvals).optional().describe("Record the customer's answer yourself, for example when they call"),
});
export const decisionInput = z.object({ decision: z.enum(['APPROVED', 'DECLINED']) });

// ─── Appointments ──────────────────────────────────────────────────────────

export const appointmentStatuses = ['BOOKED', 'CONFIRMED', 'ARRIVED', 'CANCELLED', 'NO_SHOW'] as const;

const appointmentFields = z.object({
  customerId: id.nullish(),
  vehicleId: id.nullish(),
  customerName: optionalText(160).describe('For someone not saved as a customer yet'),
  phone: optionalText(40),
  plate: optionalText(20),
  service: text(160),
  notes: optionalText(2000),
  startsAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int().min(15).max(600).default(60),
  mechanicId: id.nullish(),
});
export const appointmentInput = appointmentFields.refine((a) => Boolean(a.customerId) || Boolean(a.customerName), {
  message: 'Choose a customer or enter a name',
  path: ['customerName'],
});
export const appointmentPatch = appointmentFields.partial();
export const appointmentStatusInput = z.object({ status: z.enum(['BOOKED', 'CONFIRMED', 'CANCELLED', 'NO_SHOW']).describe('Use check-in to mark someone ARRIVED') });
export const appointmentsQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(appointmentStatuses).optional(),
});

// ─── Suppliers ─────────────────────────────────────────────────────────────

export const supplierInput = z.object({
  name: text(160),
  contactName: optionalText(120),
  phone: optionalText(40),
  email: z.email().max(200).nullish(),
  address: optionalText(500),
  notes: optionalText(2000),
});
export const supplierPatch = supplierInput.partial().extend({ active: z.boolean().optional() });
export const suppliersQuery = z.object({ q: z.string().trim().max(100).optional(), includeInactive: z.enum(['true', 'false']).optional() });

// ─── Reports & drivers ───────────────────────────────────────────────────────

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const reportsQuery = z.object({
  from: day.optional().describe('First day, garage time. Defaults to 29 days before `to`'),
  to: day.optional().describe('Last day, garage time. Defaults to today'),
});
export const repairsQuery = z.object({
  incidentIds: z
    .string()
    .trim()
    .min(1)
    .max(64 * 50)
    .describe('Comma-separated Kaduna incident ids, up to 50'),
});
export const inspectionBoardQuery = z.object({
  mine: z.enum(['true', 'false']).optional().describe('Mechanics: true for only the jobs assigned to you'),
  mechanicId: id.optional(),
});

// ─── Online booking ──────────────────────────────────────────────────────────

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 08:30');
export const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const openHours = z
  .object({ open: clock, close: clock })
  .refine((h) => h.open < h.close, { message: 'Closing time must be after opening time', path: ['close'] })
  .nullable()
  .describe('null: closed that day');

export const bookingSettingsInput = z.object({
  enabled: z.boolean().describe('Off: the booking link shows that online booking is closed'),
  listed: z.boolean().default(true).describe('While booking is on, the garage is also listed on kaduna.lk and in the Kaduna dashboards of drivers'),
  slotMinutes: z.number().int().min(15).max(240).default(60).describe('Length of each bookable slot'),
  capacity: z.number().int().min(1).max(20).default(1).describe('Cars that can be booked into the same slot (bays)'),
  leadHours: z.number().int().min(0).max(168).default(2).describe('Minimum notice before a slot'),
  daysAhead: z.number().int().min(1).max(90).default(14).describe('How far ahead customers can book'),
  hours: z.object(Object.fromEntries(weekdays.map((d) => [d, openHours])) as Record<(typeof weekdays)[number], typeof openHours>),
  services: z.array(z.string().trim().min(1).max(80)).max(20).default([]).describe('Offered as choices; empty lets customers describe the job'),
  note: optionalText(500).describe('Shown to customers on the booking page'),
});

export const slotsQuery = z.object({ from: day.optional().describe('First day, garage time; defaults to today'), days: z.coerce.number().int().min(1).max(14).default(7) });

export const publicBookingInput = z.object({
  startsAt: z.iso.datetime({ offset: true }).describe('Must be one of the slots offered'),
  service: text(160),
  name: text(160),
  phone: z.string().trim().min(7).max(40),
  plate: optionalText(20),
  vehicle: optionalText(120).describe('Make and model, e.g. Toyota Aqua'),
  notes: optionalText(1000),
  website: z.string().max(0).optional().describe('Leave empty (spam trap)'),
});

// ─── The vehicle owner's side: their cars at garages, and booking ──────────

export const garageDirectoryQuery = z.object({ q: z.string().trim().max(100).optional().describe('Garage name or address') });

export const ownerBookingInput = z.object({
  startsAt: z.iso.datetime({ offset: true }).describe('Must be one of the slots offered'),
  service: text(160),
  plate: text(20).describe("One of the caller's registered vehicles; the visit then shows in their dashboard"),
  vehicle: optionalText(120).describe('Make and model, e.g. Toyota Aqua'),
  name: text(160),
  phone: z.string().trim().min(7).max(40),
  notes: optionalText(1000),
});

// ─── Internal API (other Kaduna services, shared secret) ────────────────────

export const internalNoteInput = z.object({ note: text(1000) });
export const internalPartsInput = z.object({
  lines: z.array(z.object({ description: text(200), quantity, unitPrice: money })).min(1).max(50),
  note: text(1000).describe('Added to the job timeline (not shown to the customer)'),
});


// ─── Stock locations, stocktakes, purchase orders ───────────────────────────

export const locationInput = z.object({ name: text(80), note: optionalText(240) });
export const locationPatch = locationInput.partial().extend({ active: z.boolean().optional() });

export const stockCountInput = z.object({
  note: optionalText(240),
  lines: z
    .array(z.object({ partId: id, counted: z.number().min(0).max(99_999) }))
    .min(1)
    .max(500)
    .describe('What was counted on the shelf. Parts left out are not touched.'),
});

export const purchaseOrderInput = z.object({
  supplierId: id,
  note: optionalText(500),
  lines: z
    .array(z.object({ partId: id, quantity: quantity, unitCost: money }))
    .min(1)
    .max(200),
});
export const purchaseOrderPatch = z.object({
  note: optionalText(500),
  lines: purchaseOrderInput.shape.lines.optional().describe('Replaces all lines. Only while the order is still a draft'),
});
export const receiveInput = z.object({
  lines: z
    .array(z.object({ lineId: id, quantity: quantity }))
    .min(1)
    .describe('How many of each line arrived. Can be called more than once for a partial delivery'),
  note: optionalText(240),
});
export const purchaseOrdersQuery = z.object({ status: z.enum(['DRAFT', 'ORDERED', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional() });

// ─── Assets (tools & equipment) ─────────────────────────────────────────────

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const assetConditions = ['GOOD', 'FAIR', 'NEEDS_REPAIR', 'RETIRED'] as const;
export const assetInput = z.object({
  name: text(160),
  tag: optionalText(40).describe('Your own asset number, unique in the garage, for example AST-014'),
  category: optionalText(80),
  serialNo: optionalText(80),
  purchaseDate: dateOnly.nullish(),
  cost: money.default(0),
  locationId: id.nullish(),
  condition: z.enum(assetConditions).default('GOOD'),
  serviceIntervalDays: z.number().int().min(1).max(3650).nullish().describe('Days between services. Sets the next due date after each service'),
  nextServiceDue: dateOnly.nullish(),
  warrantyUntil: dateOnly.nullish(),
  note: optionalText(1000),
});
export const assetPatch = assetInput.partial().extend({ active: z.boolean().optional() });
export const assetsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  status: z.enum(['available', 'out', 'due', 'attention']).optional().describe('out: checked out; due: service due or overdue; attention: needs repair'),
  includeInactive: z.enum(['true', 'false']).optional(),
});
export const assetCheckOutInput = z.object({ staffId: id, note: optionalText(240) });
export const assetCheckInInput = z.object({ condition: z.enum(assetConditions).optional(), note: optionalText(240) });
export const assetServiceInput = z.object({ note: optionalText(500), nextServiceDue: dateOnly.nullish(), condition: z.enum(assetConditions).optional() });

// ─── Customer parts held ────────────────────────────────────────────────────

export const heldInput = z.object({
  name: text(160),
  quantity: quantity.default(1),
  customerId: id.nullish(),
  vehicleId: id.nullish(),
  jobCardId: id.nullish(),
  locationId: id.nullish(),
  note: optionalText(500),
});
export const heldPatch = heldInput.partial().extend({ status: z.enum(['HELD', 'FITTED', 'RETURNED']).optional() });
export const heldQuery = z.object({ status: z.enum(['HELD', 'FITTED', 'RETURNED', 'open']).optional(), q: z.string().trim().max(100).optional() });

// ─── Calls to garages ───────────────────────────────────────────────────────

export const callInput = z.object({
  garageId: id,
  source: z.enum(['app', 'web']).default('app').describe('Where the call was started'),
});
export const callStatsQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().describe('First day (UTC). Defaults to 30 days before `to`'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().describe('Last day (UTC), inclusive. Defaults to now'),
});
