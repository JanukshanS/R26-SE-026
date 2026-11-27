/**
 * The service's OpenAPI 3.1 contract, built from code rather than written by
 * hand: request bodies and query parameters come from the same zod schemas the
 * routes validate with, so the contract cannot drift from what is enforced.
 *
 * `npm run openapi` writes it to contracts/garage-management.openapi.yaml, and
 * tests/openapi.test.ts fails if the committed file is out of date.
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
const money = { type: 'number', description: 'Amount in the garage currency, 2 decimal places' };
const timestamp = { type: 'string', format: 'date-time' };
const obj = (properties: Json, required = Object.keys(properties)) => ({ type: 'object', properties, required });

/** Response bodies, mirroring src/services/presenters.ts. */
const responses: Record<string, Json> = {
  Garage: obj({
    id: { type: 'string' }, providerId: { type: 'string' }, name: { type: 'string' }, phone: nullable('string'),
    address: nullable('string'), labourRate: money, taxRate: { type: 'number', description: 'Percent, 0-100' },
    currency: { type: 'string', example: 'LKR' }, email: nullable('string'), registrationNo: nullable('string'),
    logoUrl: nullable('string', { description: 'data:image URL or https URL' }), brandColor: nullable('string', { example: '#ff6a13' }),
    invoiceTerms: nullable('string'), invoiceFooter: nullable('string'), bankDetails: nullable('string'), createdAt: timestamp,
  }),
  Customer: obj({
    id: { type: 'string' }, name: { type: 'string' }, phone: nullable('string'), email: nullable('string'),
    notes: nullable('string'), createdAt: timestamp,
  }),
  Vehicle: obj({
    id: { type: 'string' }, customerId: nullable('string'),
    plate: nullable('string', { description: 'Normalised: upper case, letters and digits split by a dash. Null when not known yet.', example: 'CAB-1234' }),
    make: nullable('string'), model: nullable('string'), year: nullable('integer'), odometerKm: nullable('integer'),
    notes: nullable('string'), createdAt: timestamp,
  }),
  Part: obj({
    id: { type: 'string' }, sku: { type: 'string' }, name: { type: 'string' }, brand: nullable('string'),
    unitCost: money, unitPrice: money, stockQty: { type: 'number' }, reorderLevel: { type: 'number' },
    active: { type: 'boolean' }, lowStock: { type: 'boolean', description: 'Active and at or below the reorder level' },
    supplierId: nullable('string'),
    kind: { enum: ['PART', 'CONSUMABLE'], description: 'A consumable is bulk workshop supply used without a job' },
    category: nullable('string'), barcode: nullable('string'), locationId: nullable('string'),
  }),
  StockMovement: obj({
    id: { type: 'string' }, partId: { type: 'string' },
    quantityChange: { type: 'number', description: 'Positive into stock, negative out' },
    reason: { enum: ['PURCHASE', 'JOB_USE', 'RETURN', 'ADJUSTMENT', 'WORKSHOP_USE', 'COUNT'] }, jobCardId: nullable('string'),
    supplierId: nullable('string'), unitCost: nullable('number', { description: 'Cost per unit for purchases and job use' }),
    note: nullable('string'), createdAt: timestamp,
  }),
  JobItem: obj({
    id: { type: 'string' }, kind: { enum: ['LABOUR', 'PART'] }, description: { type: 'string' },
    quantity: { type: 'number' }, unitPrice: money, partId: nullable('string'), lineTotal: money,
  }),
  JobCardSummary: obj({
    id: { type: 'string' }, number: { type: 'integer', description: 'Per garage, starting at 1, no gaps' },
    status: { enum: [...v.jobStatuses] }, source: { enum: ['WALK_IN', 'KADUNA_DISPATCH'] },
    customer: { oneOf: [ref('Customer'), { type: 'null' }] }, vehicle: { oneOf: [ref('Vehicle'), { type: 'null' }] },
    mechanic: { oneOf: [ref('MechanicRef'), { type: 'null' }] },
    complaint: nullable('string'), promisedAt: nullable('string', { format: 'date-time' }), createdAt: timestamp, updatedAt: timestamp,
  }),
  JobCard: {
    allOf: [
      ref('JobCardSummary'),
      obj({
        dispatchIncidentId: nullable('string'), diagnosis: nullable('string'), odometerIn: nullable('integer'),
        assignedTo: nullable('string', { description: 'Legacy free-text name; see mechanic' }), closedAt: nullable('string', { format: 'date-time' }),
        trackingToken: { type: 'string', description: 'Key for the customer tracking link /track?t=…' },
        items: { type: 'array', items: ref('JobItem') }, subtotal: money,
        invoice: {
          description: 'The current (not voided) invoice, if any',
          oneOf: [obj({ id: { type: 'string' }, number: { type: 'integer' }, status: { enum: ['UNPAID', 'PAID'] }, total: money }), { type: 'null' }],
        },
        updates: { type: 'array', description: 'Timeline, newest first (up to 100)', items: ref('JobUpdate') },
        inspection: {
          oneOf: [
            obj({
              id: { type: 'string' }, status: { enum: ['DRAFT', 'SENT'] }, checked: { type: 'integer' }, total: { type: 'integer' },
              attention: { type: 'integer', description: 'Items needing attention or urgent' }, pendingApproval: { type: 'integer' },
            }),
            { type: 'null' },
          ],
        },
      }),
    ],
  },
  Invoice: obj({
    id: { type: 'string' }, number: { type: 'integer' }, jobCardId: { type: 'string' }, jobNumber: nullable('integer'),
    status: { enum: ['UNPAID', 'PAID', 'VOID'] },
    lines: {
      type: 'array', description: 'Snapshot of the job lines when the invoice was issued',
      items: obj({ kind: { enum: ['LABOUR', 'PART'] }, description: { type: 'string' }, quantity: { type: 'number' }, unitPrice: money, lineTotal: money }),
    },
    subtotal: money, tax: money, total: money,
    paymentMethod: { oneOf: [{ enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'] }, { type: 'null' }] },
    issuedAt: timestamp, paidAt: nullable('string', { format: 'date-time' }),
  }),
  Dashboard: obj({
    jobsByStatus: { type: 'object', additionalProperties: { type: 'integer' } },
    openJobs: { type: 'integer', description: 'Jobs not CLOSED or CANCELLED' },
    jobsDueToday: { type: 'integer', description: 'Open jobs promised for today (Sri Lanka time)' },
    revenueThisMonth: { ...money, description: 'Paid invoices this calendar month' },
    unpaidTotal: money,
    lowStockParts: { type: 'array', items: ref('Part') },
  }),
  MechanicRef: obj({ id: { type: 'string' }, name: { type: 'string' } }),
  JobUpdate: obj({
    id: { type: 'string' }, status: { oneOf: [{ enum: [...v.jobStatuses] }, { type: 'null' }] }, note: nullable('string'),
    author: nullable('string', { description: "Mechanic's name, 'Customer', or null for the workshop" }),
    public: { type: 'boolean', description: 'Shown on the tracking link' }, createdAt: timestamp,
  }),
  StaffMember: obj({
    id: { type: 'string' }, name: { type: 'string' }, phone: nullable('string'), active: { type: 'boolean' },
    joined: { type: 'boolean', description: 'A Kaduna account has joined with the invite code' },
    joinedAt: nullable('string', { format: 'date-time' }),
    inviteCode: nullable('string', { description: 'Shown to the owner until the mechanic joins' }), createdAt: timestamp,
  }),
  Me: obj({
    role: { oneOf: [{ enum: ['OWNER', 'MECHANIC'] }, { type: 'null' }] },
    garage: { oneOf: [ref('Garage'), { type: 'null' }] },
    staff: { oneOf: [ref('StaffMember'), { type: 'null' }] },
  }),
  InspectionItem: obj({
    id: { type: 'string' }, category: { type: 'string' }, name: { type: 'string' }, result: { enum: [...v.checkResults] },
    note: nullable('string'), estimate: nullable('number', { description: 'Price of the recommended work' }),
    approval: { oneOf: [{ enum: [...v.approvals] }, { type: 'null' }], description: 'null: nothing for the customer to decide' },
    decidedAt: nullable('string', { format: 'date-time' }), jobItemId: nullable('string', { description: 'Set once added to the job' }),
    sortOrder: { type: 'integer' },
  }),
  Inspection: obj({
    id: { type: 'string' }, jobCardId: { type: 'string' }, status: { enum: ['DRAFT', 'SENT'] }, summary: nullable('string'),
    sentAt: nullable('string', { format: 'date-time' }), createdAt: timestamp, updatedAt: timestamp,
    items: { type: 'array', items: ref('InspectionItem') },
  }),
  InspectionBoardRow: obj({
    job: ref('JobCardSummary'),
    inspection: {
      description: 'null: not inspected yet',
      oneOf: [
        obj({
          id: { type: 'string' }, status: { enum: ['DRAFT', 'SENT'] }, sentAt: nullable('string', { format: 'date-time' }), updatedAt: timestamp,
          total: { type: 'integer' }, checked: { type: 'integer' }, attention: { type: 'integer' }, urgent: { type: 'integer' },
          pendingApproval: { type: 'integer' }, approvedToAdd: { type: 'integer', description: 'Approved by the customer, not on the job yet' },
          declined: { type: 'integer' },
        }),
        { type: 'null' },
      ],
    },
  }),
  Appointment: obj({
    id: { type: 'string' }, customerId: nullable('string'), vehicleId: nullable('string'),
    customerName: nullable('string'), phone: nullable('string'), plate: nullable('string'),
    vehicle: { oneOf: [ref('Vehicle'), { type: 'null' }] }, service: { type: 'string' }, notes: nullable('string'),
    startsAt: timestamp, durationMin: { type: 'integer' }, status: { enum: [...v.appointmentStatuses] },
    source: { enum: ['STAFF', 'ONLINE'], description: 'ONLINE: booked by the customer through the booking link' },
    mechanic: { oneOf: [ref('MechanicRef'), { type: 'null' }] }, jobCardId: nullable('string'), jobNumber: nullable('integer'), createdAt: timestamp,
  }),
  BookingSettings: schema(v.bookingSettingsInput),
  BookingConfig: obj({
    settings: ref('BookingSettings'),
    token: nullable('string', { description: 'Key for the booking link /book?g=…; null until settings are first saved' }),
  }),
  BookingPage: obj({
    garage: obj({ name: { type: 'string' }, phone: nullable('string'), address: nullable('string'), logoUrl: nullable('string'), brandColor: nullable('string') }),
    enabled: { type: 'boolean' }, slotMinutes: { type: 'integer' }, daysAhead: { type: 'integer' },
    hours: { type: 'object', additionalProperties: { oneOf: [obj({ open: { type: 'string' }, close: { type: 'string' } }), { type: 'null' }] } },
    services: { type: 'array', items: { type: 'string' } }, note: nullable('string'),
    timeZoneOffsetMinutes: { type: 'integer', description: 'The garage clock, minutes ahead of UTC' },
  }),
  DaySlots: obj({
    date: { type: 'string', format: 'date' }, weekday: { enum: [...v.weekdays] }, open: { type: 'boolean' },
    slots: { type: 'array', items: obj({ startsAt: timestamp, time: { type: 'string', example: '08:30' }, free: { type: 'integer', description: '0: full' } }) },
  }),
  PublicBooking: obj({
    garage: obj({ name: { type: 'string' }, phone: nullable('string'), address: nullable('string'), logoUrl: nullable('string'), brandColor: nullable('string') }),
    service: { type: 'string' }, startsAt: timestamp, durationMin: { type: 'integer' }, status: { enum: [...v.appointmentStatuses] },
    name: nullable('string'), plate: nullable('string'), cancellable: { type: 'boolean' },
  }),
  Supplier: obj({
    id: { type: 'string' }, name: { type: 'string' }, contactName: nullable('string'), phone: nullable('string'), email: nullable('string'),
    address: nullable('string'), notes: nullable('string'), active: { type: 'boolean' }, partCount: nullable('integer'), createdAt: timestamp,
  }),
  StockLocation: obj({
    id: { type: 'string' }, name: { type: 'string' }, note: nullable('string'), active: { type: 'boolean' },
    partCount: nullable('integer'), assetCount: nullable('integer'), heldCount: nullable('integer'),
  }),
  StockCount: obj({
    id: { type: 'string' }, note: nullable('string'), countedBy: nullable('string'), createdAt: timestamp,
    lineCount: { type: 'integer' }, mismatches: { type: 'integer', description: 'Lines where the count differed from the books' },
    netVarianceValue: { ...money, description: 'Value of the differences at cost; negative means stock was missing' },
    lines: { type: 'array', items: obj({ partId: { type: 'string' }, sku: { type: 'string' }, name: { type: 'string' }, expected: { type: 'number' }, counted: { type: 'number' }, variance: { type: 'number' }, varianceValue: money }) },
  }),
  PurchaseOrder: obj({
    id: { type: 'string' }, number: { type: 'integer' }, reference: { type: 'string', example: 'PO-7' },
    status: { enum: ['DRAFT', 'ORDERED', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED'] }, note: nullable('string'),
    supplierId: { type: 'string' }, supplierName: { type: 'string' }, orderedAt: nullable('string', { format: 'date-time' }),
    receivedAt: nullable('string', { format: 'date-time' }), createdAt: timestamp, total: money,
    lines: { type: 'array', items: obj({ id: { type: 'string' }, partId: { type: 'string' }, sku: { type: 'string' }, name: { type: 'string' }, quantity: { type: 'number' }, unitCost: money, receivedQty: { type: 'number' }, lineTotal: money }) },
  }),
  Asset: obj({
    id: { type: 'string' }, name: { type: 'string' }, tag: nullable('string'), category: nullable('string'), serialNo: nullable('string'),
    purchaseDate: nullable('string', { format: 'date' }), cost: money, locationId: nullable('string'), locationName: nullable('string'),
    condition: { enum: ['GOOD', 'FAIR', 'NEEDS_REPAIR', 'RETIRED'] }, heldById: nullable('string'), heldByName: nullable('string'),
    checkedOutAt: nullable('string', { format: 'date-time' }), serviceIntervalDays: nullable('integer'),
    nextServiceDue: nullable('string', { format: 'date' }), dueInDays: nullable('integer', { description: 'Negative when overdue' }),
    serviceState: { oneOf: [{ enum: ['OK', 'SOON', 'OVERDUE'] }, { type: 'null' }], description: 'SOON: due within 14 days' },
    warrantyUntil: nullable('string', { format: 'date' }), note: nullable('string'), active: { type: 'boolean' }, createdAt: timestamp,
  }),
  AssetLog: obj({ id: { type: 'string' }, type: { enum: ['CHECK_OUT', 'CHECK_IN', 'SERVICE', 'CONDITION', 'NOTE'] }, staffName: nullable('string'), note: nullable('string'), createdAt: timestamp }),
  HeldPart: obj({
    id: { type: 'string' }, name: { type: 'string' }, quantity: { type: 'number' }, customerId: nullable('string'), customerName: nullable('string'),
    vehicleId: nullable('string'), vehicleLabel: nullable('string'), jobCardId: nullable('string'), jobNumber: nullable('integer'),
    locationId: nullable('string'), locationName: nullable('string'), status: { enum: ['HELD', 'FITTED', 'RETURNED'] },
    note: nullable('string'), receivedAt: timestamp, closedAt: nullable('string', { format: 'date-time' }),
  }),
  GarageCall: obj({
    id: { type: 'string' }, garageId: { type: 'string' }, garageName: { type: 'string' },
    phone: { type: 'string', description: 'The number to dial' },
    counted: { type: 'boolean', description: 'false when this repeats the same caller\'s call from the last two minutes' },
    createdAt: timestamp,
  }),
  GarageCallStats: obj({
    from: timestamp, to: timestamp, total: { type: 'integer' }, uniqueCallers: { type: 'integer' }, garagesCalled: { type: 'integer' },
    byGarage: { type: 'array', items: obj({ garageId: { type: 'string' }, name: nullable('string'), phone: nullable('string'), address: nullable('string'), calls: { type: 'integer' }, lastCallAt: nullable('string', { format: 'date-time' }) }) },
    byDay: { type: 'array', items: obj({ date: { type: 'string', format: 'date' }, calls: { type: 'integer' } }) },
    recent: { type: 'array', description: 'Newest first, up to 50', items: obj({ id: { type: 'string' }, garageId: { type: 'string' }, garageName: { type: 'string' }, userId: { type: 'string' }, source: { type: 'string' }, phone: nullable('string'), createdAt: timestamp }) },
  }),
  Report: obj({
    from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' },
    totals: obj({
      revenue: { ...money, description: 'Paid invoices, tax included' }, net: money, tax: money, invoices: { type: 'integer' },
      averageInvoice: money, labour: money, parts: money, partsCost: money, grossProfit: { ...money, description: 'net minus parts cost' },
    }),
    days: { type: 'array', items: obj({ date: { type: 'string', format: 'date' }, labour: money, parts: money, total: money }) },
    paymentMethods: { type: 'array', items: obj({ method: { enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'] }, count: { type: 'integer' }, total: money }) },
    jobs: obj({
      opened: { type: 'integer' }, walkIn: { type: 'integer' }, kaduna: { type: 'integer' }, closed: { type: 'integer' },
      averageTurnaroundHours: nullable('number'),
    }),
    mechanics: { type: 'array', items: obj({ mechanicId: nullable('string'), name: nullable('string'), jobsClosed: { type: 'integer' }, labour: money }) },
    topServices: { type: 'array', items: obj({ description: { type: 'string' }, count: { type: 'integer' }, revenue: money }) },
    topParts: { type: 'array', items: obj({ description: { type: 'string' }, quantity: { type: 'number' }, revenue: money }) },
    inspections: obj({
      recommended: { type: 'integer' }, approved: { type: 'integer' }, declined: { type: 'integer' }, pending: { type: 'integer' },
      approvedValue: money, declinedValue: money,
    }),
    customers: obj({ new: { type: 'integer' } }),
    appointments: obj({ total: { type: 'integer' }, arrived: { type: 'integer' }, noShow: { type: 'integer' }, cancelled: { type: 'integer' } }),
  }),
  Tracking: obj({
    garage: obj({
      name: { type: 'string' }, phone: nullable('string'), address: nullable('string'), logoUrl: nullable('string'),
      brandColor: nullable('string'), currency: { type: 'string' }, taxRate: { type: 'number' },
    }),
    job: obj({
      number: { type: 'integer' }, status: { enum: [...v.jobStatuses] }, source: { enum: ['WALK_IN', 'KADUNA_DISPATCH'] },
      complaint: nullable('string'), diagnosis: nullable('string'), promisedAt: nullable('string', { format: 'date-time' }),
      createdAt: timestamp, closedAt: nullable('string', { format: 'date-time' }),
      customerName: nullable('string', { description: 'First name only' }), mechanicName: nullable('string', { description: 'First name only' }),
      vehicle: { oneOf: [obj({ plate: nullable('string'), make: nullable('string'), model: nullable('string'), year: nullable('integer') }), { type: 'null' }] },
    }),
    items: { type: 'array', items: obj({ kind: { enum: ['LABOUR', 'PART'] }, description: { type: 'string' }, quantity: { type: 'number' }, unitPrice: money, lineTotal: money }) },
    subtotal: money,
    invoice: {
      oneOf: [
        obj({ number: { type: 'integer' }, status: { enum: ['UNPAID', 'PAID'] }, subtotal: money, tax: money, total: money, issuedAt: timestamp, paidAt: nullable('string', { format: 'date-time' }) }),
        { type: 'null' },
      ],
    },
    updates: { type: 'array', description: 'Public timeline, newest first', items: obj({ id: { type: 'string' }, status: { oneOf: [{ enum: [...v.jobStatuses] }, { type: 'null' }] }, note: nullable('string'), author: nullable('string'), createdAt: timestamp }) },
    inspection: {
      description: 'Only once the garage has sent it; unchecked points are left out',
      oneOf: [
        obj({
          summary: nullable('string'), sentAt: nullable('string', { format: 'date-time' }),
          items: {
            type: 'array',
            items: obj({
              id: { type: 'string' }, category: { type: 'string' }, name: { type: 'string' }, result: { enum: ['OK', 'ATTENTION', 'URGENT'] },
              note: nullable('string'), estimate: nullable('number'), approval: { oneOf: [{ enum: [...v.approvals] }, { type: 'null' }] },
              inJob: { type: 'boolean', description: 'The workshop has added it to the job; no longer changeable' },
            }),
          },
        }),
        { type: 'null' },
      ],
    },
  }),
  Repair: obj({
    incidentId: { type: 'string' },
    garage: obj({ name: { type: 'string' }, phone: nullable('string'), address: nullable('string') }),
    jobNumber: { type: 'integer' }, status: { enum: [...v.jobStatuses] }, promisedAt: nullable('string', { format: 'date-time' }), updatedAt: timestamp,
    lastUpdate: { oneOf: [obj({ status: { oneOf: [{ enum: [...v.jobStatuses] }, { type: 'null' }] }, note: nullable('string'), createdAt: timestamp }), { type: 'null' }] },
    approvalsWaiting: { type: 'integer', description: 'Inspection items waiting for the customer (decide on the tracking link)' },
  }),
  OwnerVisits: obj({
    repairs: {
      type: 'array',
      description: 'Open jobs for the caller\'s plates, and finished ones from the last year that ended after they registered the car',
      items: obj({
        id: { type: 'string' }, garage: obj({ id: { type: 'string' }, name: { type: 'string' }, phone: nullable('string'), address: nullable('string'), logoUrl: nullable('string'), brandColor: nullable('string') }), jobNumber: { type: 'integer' }, status: { enum: [...v.jobStatuses] },
        source: { enum: ['WALK_IN', 'KADUNA_DISPATCH'] }, incidentId: nullable('string'), plate: nullable('string'), vehicle: { oneOf: [obj({ plate: nullable('string'), make: nullable('string'), model: nullable('string'), year: nullable('integer') }), { type: 'null' }] },
        complaint: nullable('string'), mechanicName: nullable('string', { description: 'First name only' }), promisedAt: nullable('string', { format: 'date-time' }),
        createdAt: timestamp, updatedAt: timestamp, closedAt: nullable('string', { format: 'date-time' }),
        lastUpdate: { oneOf: [obj({ status: { oneOf: [{ enum: [...v.jobStatuses] }, { type: 'null' }] }, note: nullable('string'), createdAt: timestamp }), { type: 'null' }] },
        approvalsWaiting: { type: 'integer' },
        invoice: { oneOf: [obj({ status: { enum: ['UNPAID', 'PAID'] }, total: money }), { type: 'null' }] },
        trackingToken: { type: 'string', description: 'For /track?t=…: the full job, prices and inspection approvals' },
      }),
    },
    bookings: {
      type: 'array',
      description: 'Upcoming bookings for the caller\'s plates, soonest first',
      items: obj({
        id: { type: 'string' }, garage: obj({ id: { type: 'string' }, name: { type: 'string' }, phone: nullable('string'), address: nullable('string'), logoUrl: nullable('string'), brandColor: nullable('string') }), service: { type: 'string' }, startsAt: timestamp, durationMin: { type: 'integer' },
        status: { enum: ['BOOKED', 'CONFIRMED'] }, plate: nullable('string'), source: { enum: ['STAFF', 'ONLINE'] },
        manageToken: nullable('string', { description: 'Online bookings: for /book?a=… to view or cancel' }), cancellable: { type: 'boolean' },
      }),
    },
  }),
  DirectoryGarage: obj({
    id: { type: 'string' }, name: { type: 'string' }, phone: nullable('string'), address: nullable('string'),
    logoUrl: nullable('string'), brandColor: nullable('string'), services: { type: 'array', items: { type: 'string' } }, note: nullable('string'),
    bookingToken: { type: 'string', description: 'For the public booking page /book?g=…' },
  }),
  Error: obj({
    success: { const: false }, error: { type: 'string' },
    details: { type: 'array', items: obj({ path: { type: 'string' }, message: { type: 'string' } }) },
    timestamp,
  }, ['success', 'error', 'timestamp']),
};

const envelope = (data: Json) => obj({ success: { const: true }, data, timestamp });
const pageOf = (item: string) =>
  obj({ items: { type: 'array', items: ref(item) }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } });

const reply = (description: string, data: Json) => ({ description, content: { 'application/json': { schema: envelope(data) } } });
const failure = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } });

const pageParams = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
];
const queryParams = (s: z.ZodObject) =>
  Object.entries((schema(s).properties ?? {}) as Record<string, Json>).map(([name, sch]) => ({ name, in: 'query', schema: sch }));
const idParam = (name = 'id') => ({ name, in: 'path', required: true, schema: { type: 'string' } });

interface Op {
  tag: string;
  summary: string;
  description?: string;
  body?: z.ZodType;
  params?: Json[];
  ok: [number, string, Json];
  errors?: number[];
  /** public: no sign-in. signedIn: any Kaduna account, no garage needed. Default: acting for a garage. */
  access?: 'public' | 'signedIn' | 'internal';
  /** Garage owner only. Defaults from the tag (see OWNER_TAGS); set it for single job-card operations. */
  owner?: boolean;
}

/** Areas only the owner may use, and areas where mechanics may read but not change. */
const OWNER_TAGS = new Set(['dashboard', 'customers', 'vehicles', 'invoices', 'staff', 'suppliers', 'reports', 'stock', 'assets']);
const OWNER_WRITES_TAGS = new Set(['inventory', 'appointments']);

const errorText: Record<number, string> = {
  400: 'Malformed JSON',
  403: 'Not allowed (for example, a dispatch job assigned to another provider)',
  404: 'Not found in this garage',
  409: 'Conflicts with the current state (wrong status, stock too low, duplicate)',
  422: 'Validation failed; `details` lists each field',
  502: 'The dispatch service could not be reached',
};

const operation = (key: string, op: Op) => {
  const [status, description, data] = op.ok;
  const operationId = operationIds[key];
  if (!operationId) throw new Error(`No operationId for ${key}`);
  const method = key.split(' ')[0];
  const inGarage = !op.access;
  const owner = inGarage && (op.owner ?? (OWNER_TAGS.has(op.tag) || (OWNER_WRITES_TAGS.has(op.tag) && method !== 'get')));
  const text = [op.description, owner ? 'Garage owner only.' : inGarage ? 'Owner and mechanics.' : null].filter(Boolean).join(' ');
  const result: Json = {
    operationId,
    tags: [op.tag],
    summary: op.summary,
    ...(text && { description: text }),
    ...(op.access === 'public' && { security: [] }),
    ...(op.access === 'internal' && { security: [{ internalToken: [] }] }),
    ...(op.params && { parameters: op.params }),
    ...(op.body && { requestBody: { required: true, content: { 'application/json': { schema: schema(op.body) } } } }),
    responses: {
      [status]: reply(description, data),
      ...(op.access === 'internal'
        ? { 401: failure('Missing or wrong X-Internal-Token') }
        : op.access !== 'public' && { 401: failure('Missing or invalid Supabase token') }),
      ...(inGarage && {
        403: failure(owner ? 'Not linked to a garage, or a mechanic calling an owner-only operation' : 'Not linked to a garage'),
        404: failure('Set up your garage first, or the record is not in this garage'),
      }),
      ...Object.fromEntries((op.errors ?? []).map((code) => [code, failure(errorText[code])])),
    },
  };
  return result;
};

const paths: Record<string, Record<string, Op>> = {
  '/api/v1/public/track/{token}': {
    get: {
      tag: 'tracking', access: 'public', summary: "A customer's view of their job", params: [idParam('token')],
      description: 'Status, timeline, work and prices, and the inspection report once sent. The token is the only key; resetting it revokes the link.',
      ok: [200, 'The job', ref('Tracking')], errors: [404],
    },
  },
  '/api/v1/public/track/{token}/inspection/items/{itemId}': {
    post: {
      tag: 'tracking', access: 'public', summary: 'Approve or decline recommended work', params: [idParam('token'), idParam('itemId')],
      body: v.decisionInput, errors: [404, 409, 422],
      description: 'The customer can change their mind until the workshop adds the work to the job.',
      ok: [200, 'The job, updated', ref('Tracking')],
    },
  },
  '/api/v1/public/garages': {
    get: {
      tag: 'booking', access: 'public', summary: 'Public garage directory', params: queryParams(v.garageDirectoryQuery), errors: [422],
      description: 'Garages taking online bookings that chose to be listed (booking setting `listed`), for kaduna.lk. Contact details and the booking link only.',
      ok: [200, 'By name', { type: 'array', items: ref('DirectoryGarage') }],
    },
  },
  '/api/v1/public/book/{token}': {
    get: { tag: 'booking', access: 'public', summary: "A garage's booking page", params: [idParam('token')], errors: [404], ok: [200, 'The garage and its booking rules', ref('BookingPage')] },
    post: {
      tag: 'booking', access: 'public', summary: 'Book a slot', params: [idParam('token')], body: v.publicBookingInput, errors: [404, 409, 422],
      description: 'The slot is re-checked under a per-garage lock, so the last place in a slot goes to one customer only. Limited to 20 bookings per hour per address, and 3 upcoming online bookings per phone number.',
      ok: [201, 'Booked', obj({ token: { type: 'string', description: 'For /book?a=… to view or cancel' }, booking: ref('PublicBooking') })],
    },
  },
  '/api/v1/public/book/{token}/slots': {
    get: {
      tag: 'booking', access: 'public', summary: 'Free slots', params: [idParam('token'), ...queryParams(v.slotsQuery)], errors: [404, 422],
      description: 'Opening hours cut into slots, in garage time, minus live appointments, notice period and anything beyond the booking window. Empty while booking is off.',
      ok: [200, 'One entry per day', { type: 'array', items: ref('DaySlots') }],
    },
  },
  '/api/v1/public/bookings/{token}': {
    get: { tag: 'booking', access: 'public', summary: "A customer's booking", params: [idParam('token')], errors: [404], ok: [200, 'The booking', ref('PublicBooking')] },
  },
  '/api/v1/public/bookings/{token}/cancel': {
    post: { tag: 'booking', access: 'public', summary: 'Cancel a booking', params: [idParam('token')], errors: [404, 409], description: 'Only before it starts and before check-in.', ok: [200, 'Cancelled', ref('PublicBooking')] },
  },
  '/api/v1/booking-settings': {
    get: { tag: 'booking', owner: true, summary: 'Online booking rules and link', ok: [200, 'The settings (defaults until saved)', ref('BookingConfig')] },
    put: { tag: 'booking', owner: true, summary: 'Save online booking rules', body: v.bookingSettingsInput, errors: [422], description: 'The first save also creates the booking link.', ok: [200, 'Saved', ref('BookingConfig')] },
  },
  '/api/v1/booking-settings/reset-link': {
    post: { tag: 'booking', owner: true, summary: 'New booking link (the old one stops working)', ok: [200, 'With the new link', ref('BookingConfig')] },
  },
  '/api/v1/me': {
    get: {
      tag: 'garage', access: 'signedIn', summary: 'Who the caller is to the garage service',
      description: 'OWNER (garage is null before setup), MECHANIC with their garage, or role null for an account linked to neither.',
      ok: [200, 'The caller', ref('Me')],
    },
  },
  '/api/v1/repairs': {
    get: {
      tag: 'tracking', access: 'signedIn', summary: 'Repair status for Kaduna dispatch jobs', params: queryParams(v.repairsQuery), errors: [422],
      description: 'For the driver app: the garage and status of job cards opened from these incidents. Status only; prices and approvals are on the tracking link.',
      ok: [200, 'One entry per incident that has a job card', { type: 'array', items: ref('Repair') }],
    },
  },
  '/api/v1/staff/join': {
    post: {
      tag: 'staff', access: 'signedIn', summary: 'Join a garage as a mechanic', body: v.joinInput, errors: [404, 409, 422],
      description: 'Links the signed-in account to the garage that issued the invite code. A code works once.',
      ok: [200, 'Joined', ref('Me')],
    },
  },
  '/api/v1/garage': {
    get: { tag: 'garage', access: 'signedIn', summary: "The caller's garage", errors: [403], ok: [200, 'The garage, or null before setup', { oneOf: [ref('Garage'), { type: 'null' }] }] },
    put: {
      tag: 'garage', access: 'signedIn', summary: 'Set up or update the garage', body: v.garageInput, errors: [403, 422],
      description: 'Creates the garage on first call (201), updates it after (200). One garage per provider. Branding fields left out keep their saved values.',
      ok: [200, 'Updated (201 when created)', ref('Garage')],
    },
  },
  '/api/v1/dashboard': {
    get: { tag: 'dashboard', summary: 'Counts and totals for the home screen', ok: [200, 'Dashboard', ref('Dashboard')] },
  },
  '/api/v1/customers': {
    get: { tag: 'customers', summary: 'List or search customers', params: [...queryParams(v.searchQuery), ...pageParams], ok: [200, 'A page of customers', pageOf('Customer')] },
    post: { tag: 'customers', summary: 'Add a customer', body: v.customerInput, errors: [422], ok: [201, 'Created', ref('Customer')] },
  },
  '/api/v1/customers/{id}': {
    get: { tag: 'customers', summary: 'A customer with their vehicles', params: [idParam()], ok: [200, 'The customer', { allOf: [ref('Customer'), obj({ vehicles: { type: 'array', items: ref('Vehicle') } })] }] },
    patch: { tag: 'customers', summary: 'Edit a customer', params: [idParam()], body: v.customerPatch, errors: [422], ok: [200, 'Updated', ref('Customer')] },
  },
  '/api/v1/vehicles': {
    get: { tag: 'vehicles', summary: 'List or search vehicles', params: [...queryParams(v.searchQuery), ...pageParams], ok: [200, 'A page of vehicles', pageOf('Vehicle')] },
    post: { tag: 'vehicles', summary: 'Add a vehicle', body: v.vehicleInput, errors: [409, 422], ok: [201, 'Created', ref('Vehicle')] },
  },
  '/api/v1/vehicles/{id}': {
    get: { tag: 'vehicles', summary: 'A vehicle', params: [idParam()], ok: [200, 'The vehicle', ref('Vehicle')] },
    patch: { tag: 'vehicles', summary: 'Edit a vehicle', params: [idParam()], body: v.vehiclePatch, errors: [409, 422], ok: [200, 'Updated', ref('Vehicle')] },
  },
  '/api/v1/parts': {
    get: { tag: 'inventory', summary: 'List parts', params: [...queryParams(v.partsQuery), ...pageParams], ok: [200, 'A page of parts', pageOf('Part')] },
    post: {
      tag: 'inventory', summary: 'Add a part', body: v.partInput, errors: [409, 422],
      description: 'Opening stock is recorded as a PURCHASE movement, so stock always equals the sum of its movements.',
      ok: [201, 'Created', ref('Part')],
    },
  },
  '/api/v1/parts/{id}': {
    get: { tag: 'inventory', summary: 'A part', params: [idParam()], ok: [200, 'The part', ref('Part')] },
    patch: { tag: 'inventory', summary: 'Edit a part (not its stock)', params: [idParam()], body: v.partPatch, errors: [422], ok: [200, 'Updated', ref('Part')] },
  },
  '/api/v1/parts/{id}/stock': {
    post: {
      tag: 'inventory', summary: 'Receive, return or correct stock', params: [idParam()], body: v.stockAdjustInput, errors: [409, 422],
      description: 'Stock changes only through movements. Refuses to take stock below zero.',
      ok: [200, 'The part with its new stock', ref('Part')],
    },
  },
  '/api/v1/parts/{id}/movements': {
    get: { tag: 'inventory', summary: 'Stock history, newest first', params: [idParam(), ...pageParams], ok: [200, 'A page of movements', pageOf('StockMovement')] },
  },
  '/api/v1/job-cards': {
    get: { tag: 'job-cards', summary: 'List or search job cards', params: [...queryParams(v.listJobsQuery), ...pageParams], ok: [200, 'A page of job cards', pageOf('JobCardSummary')] },
    post: { tag: 'job-cards', owner: true, summary: 'Open a walk-in job card', body: v.jobCardInput, errors: [422], ok: [201, 'Opened', ref('JobCard')] },
  },
  '/api/v1/job-cards/from-dispatch': {
    post: {
      tag: 'job-cards', owner: true, summary: 'Open a job card from a Kaduna dispatch job', body: v.fromDispatchInput, errors: [403, 422, 502],
      description:
        "Reads the incident from the dispatch service with the caller's token, checks it was assigned to this provider, and opens a job card with the vehicle and complaint filled in. Safe to repeat: the same incident returns the existing job card (200).",
      ok: [201, 'Opened (200 when it already existed)', ref('JobCard')],
    },
  },
  '/api/v1/job-cards/{id}': {
    get: { tag: 'job-cards', summary: 'A job card with its lines', params: [idParam()], ok: [200, 'The job card', ref('JobCard')] },
    patch: {
      tag: 'job-cards', summary: 'Edit a job card', params: [idParam()], body: v.jobCardPatch, errors: [409, 422],
      description: 'Mechanics may change only the complaint, diagnosis and odometer.',
      ok: [200, 'Updated', ref('JobCard')],
    },
  },
  '/api/v1/job-cards/{id}/status': {
    post: {
      tag: 'job-cards', summary: 'Move a job card through its workflow', params: [idParam()], body: v.statusInput, errors: [409, 422],
      description:
        'OPEN → IN_PROGRESS → (WAITING_PARTS ↔ IN_PROGRESS) → READY → CLOSED; any open state → CANCELLED; READY → IN_PROGRESS to reopen. Cancelling returns used parts to stock and is refused while an invoice is live. Mechanics cannot close or cancel. Each change is added to the timeline.',
      ok: [200, 'The job card', ref('JobCard')],
    },
  },
  '/api/v1/job-cards/{id}/items': {
    post: {
      tag: 'job-cards', summary: 'Add a labour or part line', params: [idParam()], body: v.jobItemInput, errors: [409, 422],
      description: 'A part line with partId takes that quantity from stock. Labour without a price uses the garage labour rate. Refused once the job is finished or invoiced.',
      ok: [201, 'The job card', ref('JobCard')],
    },
  },
  '/api/v1/job-cards/{id}/items/{itemId}': {
    delete: { tag: 'job-cards', summary: 'Remove a line (parts go back to stock)', params: [idParam(), idParam('itemId')], errors: [409], ok: [200, 'The job card', ref('JobCard')] },
  },
  '/api/v1/job-cards/{id}/invoice': {
    post: {
      tag: 'invoices', summary: 'Invoice a READY or CLOSED job card', params: [idParam()], errors: [409],
      description: 'Copies the lines into the invoice and adds tax at the garage rate. One live invoice per job; void it to re-invoice.',
      ok: [201, 'Issued', ref('Invoice')],
    },
  },
  '/api/v1/invoices': {
    get: { tag: 'invoices', summary: 'List invoices', params: [...queryParams(v.invoicesQuery), ...pageParams], ok: [200, 'A page of invoices', pageOf('Invoice')] },
  },
  '/api/v1/invoices/{id}': {
    get: { tag: 'invoices', summary: 'An invoice', params: [idParam()], ok: [200, 'The invoice', ref('Invoice')] },
  },
  '/api/v1/invoices/{id}/pay': {
    post: { tag: 'invoices', summary: 'Record payment', params: [idParam()], body: v.paymentInput, errors: [409, 422], ok: [200, 'Paid', ref('Invoice')] },
  },
  '/api/v1/invoices/{id}/void': {
    post: { tag: 'invoices', summary: 'Void an unpaid invoice', params: [idParam()], errors: [409], ok: [200, 'Voided', ref('Invoice')] },
  },
  '/api/v1/job-cards/{id}/updates': {
    post: {
      tag: 'job-cards', summary: 'Post a note on the job timeline', params: [idParam()], body: v.jobUpdateInput, errors: [422],
      description: 'Public notes show on the customer tracking link, for example "Waiting for pads from the supplier".',
      ok: [201, 'The job card', ref('JobCard')],
    },
  },
  '/api/v1/job-cards/{id}/tracking/reset': {
    post: { tag: 'job-cards', owner: true, summary: 'New tracking link (the old one stops working)', params: [idParam()], ok: [200, 'The job card', ref('JobCard')] },
  },
  '/api/v1/job-cards/{id}/inspection': {
    get: { tag: 'inspections', summary: "The job's inspection", params: [idParam()], ok: [200, 'The inspection, or null before one is started', { oneOf: [ref('Inspection'), { type: 'null' }] }] },
    post: {
      tag: 'inspections', summary: 'Start an inspection', params: [idParam()], body: v.inspectionCreateInput, errors: [409, 422],
      description: 'One per job. STANDARD starts with a 25-point checklist across six areas.',
      ok: [201, 'Started', ref('Inspection')],
    },
    patch: { tag: 'inspections', summary: 'Edit the summary for the customer', params: [idParam()], body: v.inspectionPatch, errors: [409, 422], ok: [200, 'Updated', ref('Inspection')] },
  },
  '/api/v1/job-cards/{id}/inspection/items': {
    post: { tag: 'inspections', summary: 'Add a check point', params: [idParam()], body: v.inspectionItemInput, errors: [409, 422], ok: [201, 'The inspection', ref('Inspection')] },
  },
  '/api/v1/job-cards/{id}/inspection/items/{itemId}': {
    patch: {
      tag: 'inspections', summary: 'Record a result, note or price', params: [idParam(), idParam('itemId')], body: v.inspectionItemPatch, errors: [409, 422],
      description: "Changing the price of a decided item asks the customer again. `approval` records the customer's answer given in person or by phone.",
      ok: [200, 'The inspection', ref('Inspection')],
    },
    delete: { tag: 'inspections', summary: 'Remove a check point', params: [idParam(), idParam('itemId')], errors: [409], ok: [200, 'The inspection', ref('Inspection')] },
  },
  '/api/v1/job-cards/{id}/inspection/mark-rest-ok': {
    post: { tag: 'inspections', summary: 'Mark every unchecked point OK', params: [idParam()], errors: [409], ok: [200, 'The inspection', ref('Inspection')] },
  },
  '/api/v1/inspections': {
    get: {
      tag: 'inspections', summary: 'Inspection work queue', params: queryParams(v.inspectionBoardQuery), errors: [422],
      description: 'Every job still in the workshop with where its inspection stands, plus closed jobs inspected in the last week. Newest first, up to 200.',
      ok: [200, 'One row per job', { type: 'array', items: ref('InspectionBoardRow') }],
    },
  },
  '/api/v1/job-cards/{id}/inspection/send': {
    post: {
      tag: 'inspections', summary: 'Send the report to the customer', params: [idParam()], errors: [409],
      description: 'Every priced item that needs attention becomes PENDING for the customer on the tracking link. Safe to send again after changes.',
      ok: [200, 'The inspection', ref('Inspection')],
    },
  },
  '/api/v1/job-cards/{id}/inspection/items/{itemId}/add-to-job': {
    post: {
      tag: 'inspections', summary: 'Add approved work to the job', params: [idParam(), idParam('itemId')], errors: [409],
      description: 'Adds a labour line at the approved price and locks the item.',
      ok: [201, 'The job card', ref('JobCard')],
    },
  },
  '/api/v1/appointments': {
    get: { tag: 'appointments', summary: 'Appointments in a time range', params: queryParams(v.appointmentsQuery), errors: [422], ok: [200, 'Appointments by start time (up to 500)', { type: 'array', items: ref('Appointment') }] },
    post: { tag: 'appointments', summary: 'Book an appointment', body: v.appointmentInput, errors: [422], ok: [201, 'Booked', ref('Appointment')] },
  },
  '/api/v1/appointments/{id}': {
    get: { tag: 'appointments', summary: 'An appointment', params: [idParam()], ok: [200, 'The appointment', ref('Appointment')] },
    patch: { tag: 'appointments', summary: 'Reschedule or edit', params: [idParam()], body: v.appointmentPatch, errors: [409, 422], ok: [200, 'Updated', ref('Appointment')] },
  },
  '/api/v1/appointments/{id}/status': {
    post: { tag: 'appointments', summary: 'Confirm, cancel or mark a no-show', params: [idParam()], body: v.appointmentStatusInput, errors: [409, 422], ok: [200, 'Updated', ref('Appointment')] },
  },
  '/api/v1/appointments/{id}/check-in': {
    post: {
      tag: 'appointments', summary: 'Check the customer in and open their job card', params: [idParam()], errors: [409],
      description: 'Creates the customer and vehicle if the booking only had a name and plate. Safe to repeat: returns the same job card (200).',
      ok: [201, 'Checked in (200 when already done)', obj({ appointment: ref('Appointment'), job: ref('JobCard') })],
    },
  },
  '/api/v1/staff': {
    get: { tag: 'staff', summary: 'Mechanics', ok: [200, 'Active first, then by name', { type: 'array', items: ref('StaffMember') }] },
    post: { tag: 'staff', summary: 'Add a mechanic', body: v.staffInput, errors: [422], ok: [201, 'Added, with an invite code to give them', ref('StaffMember')] },
  },
  '/api/v1/staff/{id}': {
    patch: { tag: 'staff', summary: 'Edit, or switch off, a mechanic', params: [idParam()], body: v.staffPatch, errors: [422], ok: [200, 'Updated', ref('StaffMember')] },
  },
  '/api/v1/staff/{id}/invite': {
    post: { tag: 'staff', summary: 'New invite code', params: [idParam()], description: 'Also unlinks the account that joined, for a mechanic who changed phone or account.', ok: [200, 'With the new code', ref('StaffMember')] },
  },
  '/api/v1/suppliers': {
    get: {
      tag: 'suppliers', summary: 'Suppliers', params: queryParams(v.suppliersQuery),
      ok: [200, 'By name, with spend', { type: 'array', items: { allOf: [ref('Supplier'), obj({ totalSpend: money, lastPurchaseAt: nullable('string', { format: 'date-time' }) })] } }],
    },
    post: { tag: 'suppliers', summary: 'Add a supplier', body: v.supplierInput, errors: [422], ok: [201, 'Added', ref('Supplier')] },
  },
  '/api/v1/suppliers/{id}': {
    get: {
      tag: 'suppliers', summary: 'A supplier with their parts and purchases', params: [idParam()],
      ok: [
        200,
        'The supplier',
        {
          allOf: [
            ref('Supplier'),
            obj({
              totalSpend: money,
              parts: { type: 'array', items: ref('Part') },
              purchases: { type: 'array', description: 'Newest first, up to 100', items: { allOf: [ref('StockMovement'), obj({ partName: { type: 'string' }, partSku: { type: 'string' } })] } },
            }),
          ],
        },
      ],
    },
    patch: { tag: 'suppliers', summary: 'Edit a supplier', params: [idParam()], body: v.supplierPatch, errors: [422], ok: [200, 'Updated', ref('Supplier')] },
  },
  '/api/v1/locations': {
    get: { tag: 'stock', summary: 'Shelves, bays and cabinets', params: queryParams(z.object({ includeInactive: z.enum(['true', 'false']).optional() })), ok: [200, 'By name, with how many parts, tools and held parts each holds', { type: 'array', items: ref('StockLocation') }] },
    post: { tag: 'stock', summary: 'Add a location', body: v.locationInput, errors: [409, 422], ok: [201, 'Added', ref('StockLocation')] },
  },
  '/api/v1/locations/{id}': {
    patch: { tag: 'stock', summary: 'Rename or switch off a location', params: [idParam()], body: v.locationPatch, errors: [409, 422], ok: [200, 'Updated', ref('StockLocation')] },
  },
  '/api/v1/stock-counts': {
    get: { tag: 'stock', summary: 'Past stocktakes', params: pageParams, ok: [200, 'A page of stocktakes, newest first', pageOf('StockCount')] },
    post: {
      tag: 'stock', summary: 'Record a stocktake', body: v.stockCountInput, errors: [404, 409, 422],
      description: 'Each counted part whose quantity differs gets a COUNT stock movement for the difference, so stock matches the shelf and the history still adds up.',
      ok: [201, 'The count, with expected against counted for every line', ref('StockCount')],
    },
  },
  '/api/v1/stock-counts/{id}': {
    get: { tag: 'stock', summary: 'A stocktake', params: [idParam()], errors: [404], ok: [200, 'The count', ref('StockCount')] },
  },
  '/api/v1/purchase-orders': {
    get: { tag: 'stock', summary: 'Purchase orders', params: [...queryParams(v.purchaseOrdersQuery), ...pageParams], ok: [200, 'A page of orders, newest first', pageOf('PurchaseOrder')] },
    post: { tag: 'stock', summary: 'Start a purchase order', body: v.purchaseOrderInput, errors: [404, 409, 422], description: 'Created as a draft with a gap-free PO number.', ok: [201, 'The draft', ref('PurchaseOrder')] },
  },
  '/api/v1/purchase-orders/{id}': {
    get: { tag: 'stock', summary: 'A purchase order', params: [idParam()], errors: [404], ok: [200, 'The order', ref('PurchaseOrder')] },
    patch: { tag: 'stock', summary: 'Edit a draft order', params: [idParam()], body: v.purchaseOrderPatch, errors: [404, 409, 422], ok: [200, 'Updated', ref('PurchaseOrder')] },
  },
  '/api/v1/purchase-orders/{id}/place': {
    post: { tag: 'stock', summary: 'Place the order with the supplier', params: [idParam()], errors: [404, 409], description: 'DRAFT to ORDERED. It can be received but no longer edited.', ok: [200, 'Ordered', ref('PurchaseOrder')] },
  },
  '/api/v1/purchase-orders/{id}/receive': {
    post: {
      tag: 'stock', summary: 'Goods in', params: [idParam()], body: v.receiveInput, errors: [404, 409, 422],
      description: "Books each delivered quantity into stock as a PURCHASE from the order's supplier at the order price (which becomes the part's cost). Status becomes PARTLY_RECEIVED or RECEIVED.",
      ok: [200, 'The order', ref('PurchaseOrder')],
    },
  },
  '/api/v1/purchase-orders/{id}/cancel': {
    post: { tag: 'stock', summary: 'Cancel an order', params: [idParam()], errors: [404, 409], description: 'Not possible once any stock has been received.', ok: [200, 'Cancelled', ref('PurchaseOrder')] },
  },
  '/api/v1/assets': {
    get: { tag: 'assets', summary: 'Tools and equipment', params: queryParams(v.assetsQuery), ok: [200, 'By name', { type: 'array', items: ref('Asset') }] },
    post: { tag: 'assets', summary: 'Register an asset', body: v.assetInput, errors: [404, 409, 422], ok: [201, 'Registered', ref('Asset')] },
  },
  '/api/v1/assets/{id}': {
    get: { tag: 'assets', summary: 'An asset', params: [idParam()], errors: [404], ok: [200, 'The asset', ref('Asset')] },
    patch: { tag: 'assets', summary: 'Edit or retire an asset', params: [idParam()], body: v.assetPatch, errors: [404, 409, 422], ok: [200, 'Updated', ref('Asset')] },
  },
  '/api/v1/assets/{id}/check-out': {
    post: { tag: 'assets', summary: 'Hand an asset to a mechanic', params: [idParam()], body: v.assetCheckOutInput, errors: [404, 409, 422], ok: [200, 'Checked out', ref('Asset')] },
  },
  '/api/v1/assets/{id}/check-in': {
    post: { tag: 'assets', summary: 'Take an asset back', params: [idParam()], body: v.assetCheckInInput, errors: [404, 409, 422], ok: [200, 'Back in the workshop', ref('Asset')] },
  },
  '/api/v1/assets/{id}/service': {
    post: { tag: 'assets', summary: 'Record a service', params: [idParam()], body: v.assetServiceInput, errors: [404, 422], description: "Sets the next due date from the date given, or from the asset's service interval.", ok: [200, 'Updated', ref('Asset')] },
  },
  '/api/v1/assets/{id}/log': {
    get: { tag: 'assets', summary: "An asset's history", params: [idParam()], errors: [404], ok: [200, 'Newest first, up to 100', { type: 'array', items: ref('AssetLog') }] },
  },
  '/api/v1/held-parts': {
    get: { tag: 'assets', summary: "Customers' parts the garage is holding", params: queryParams(v.heldQuery), ok: [200, 'Parts still held by default', { type: 'array', items: ref('HeldPart') }] },
    post: { tag: 'assets', summary: "Take in a customer's part", body: v.heldInput, errors: [404, 422], ok: [201, 'Recorded', ref('HeldPart')] },
  },
  '/api/v1/held-parts/{id}': {
    patch: { tag: 'assets', summary: 'Edit a held part, or mark it fitted or returned', params: [idParam()], body: v.heldPatch, errors: [404, 409, 422], ok: [200, 'Updated', ref('HeldPart')] },
  },
  '/api/v1/garage-calls': {
    post: {
      tag: 'calls', access: 'signedIn', summary: 'Log a call to a listed garage', body: v.callInput, errors: [404, 409, 422],
      description: 'Call this when the customer taps Call, then dial the phone number returned. A repeat from the same caller within two minutes returns the earlier call (200) instead of counting a new one (201).',
      ok: [201, 'Logged', ref('GarageCall')],
    },
  },
  '/api/v1/admin/garage-calls': {
    get: {
      tag: 'admin', access: 'signedIn', summary: 'Calls to garages, for the admin dashboard', params: queryParams(v.callStatsQuery), errors: [403, 422],
      description: "Kaduna administrators only (profiles.role = 'ops').",
      ok: [200, 'Totals, per garage, per day and the latest calls', ref('GarageCallStats')],
    },
  },
  '/api/v1/my/visits': {
    get: {
      tag: 'owners', access: 'signedIn', summary: "The caller's cars at garages",
      description: "Matched on the plates the caller registered in Kaduna: any garage's job cards and bookings for those cars, with no linking needed.",
      ok: [200, 'Repairs and bookings', ref('OwnerVisits')],
    },
  },
  '/api/v1/my/garages': {
    get: {
      tag: 'owners', access: 'signedIn', summary: 'Garages taking bookings', params: queryParams(v.garageDirectoryQuery), errors: [422],
      description: 'Garages with online booking on that show in the Kaduna app (booking setting `listed`).',
      ok: [200, 'By name', { type: 'array', items: ref('DirectoryGarage') }],
    },
  },
  '/api/v1/my/garages/{id}': {
    get: { tag: 'owners', access: 'signedIn', summary: "A garage's booking rules", params: [idParam()], errors: [404], ok: [200, 'Hours, services and slot length', ref('BookingPage')] },
  },
  '/api/v1/my/garages/{id}/slots': {
    get: { tag: 'owners', access: 'signedIn', summary: 'Free slots at a garage', params: [idParam(), ...queryParams(v.slotsQuery)], errors: [404, 422], ok: [200, 'One entry per day', { type: 'array', items: ref('DaySlots') }] },
  },
  '/api/v1/my/garages/{id}/book': {
    post: {
      tag: 'owners', access: 'signedIn', summary: 'Book a slot for one of your cars', params: [idParam()], body: v.ownerBookingInput, errors: [403, 404, 409, 422],
      description: 'The plate must be one the caller registered (403 otherwise), so the visit shows in their dashboard. Same slot rules and limits as the public booking link.',
      ok: [201, 'Booked', obj({ token: { type: 'string', description: 'For /book?a=… to view or cancel' }, booking: ref('PublicBooking') })],
    },
  },
  '/internal/v1/garages/{garageId}/staff': {
    get: {
      tag: 'internal', access: 'internal', summary: "A garage's mechanics, with their Kaduna accounts", params: [idParam('garageId')],
      ok: [200, 'Everyone on the staff list', { type: 'array', items: obj({ id: { type: 'string' }, name: { type: 'string' }, phone: nullable('string'), active: { type: 'boolean' }, userId: nullable('string', { description: 'null until they join with their invite code' }) }) }],
    },
  },
  '/internal/v1/garages/{garageId}/job-cards/{jobId}': {
    get: {
      tag: 'internal', access: 'internal', summary: 'A job card, briefly', params: [idParam('garageId'), idParam('jobId')], errors: [404],
      ok: [200, 'The job', obj({ id: { type: 'string' }, number: { type: 'integer' }, status: { enum: [...v.jobStatuses] }, editable: { type: 'boolean', description: 'Can take new lines: not finished, not invoiced' }, vehicle: { oneOf: [obj({ plate: nullable('string'), make: nullable('string'), model: nullable('string'), year: nullable('integer') }), { type: 'null' }] } })],
    },
  },
  '/internal/v1/garages/{garageId}/job-cards/{jobId}/notes': {
    post: { tag: 'internal', access: 'internal', summary: 'A private note on the job timeline', params: [idParam('garageId'), idParam('jobId')], body: v.internalNoteInput, errors: [404, 422], ok: [200, 'Added', obj({ added: { const: true } })] },
  },
  '/internal/v1/garages/{garageId}/job-cards/{jobId}/parts': {
    post: {
      tag: 'internal', access: 'internal', summary: 'Put received parts on the job', params: [idParam('garageId'), idParam('jobId')], body: v.internalPartsInput, errors: [404, 422],
      description: 'Adds PART lines at the price paid when the job can still take lines; the note goes on the timeline either way.',
      ok: [200, 'added: false when the job was finished or invoiced', obj({ added: { type: 'boolean' } })],
    },
  },
  '/api/v1/job-cards/{id}/owner-link': {
    get: {
      tag: 'job-cards', summary: "Whether the job's car belongs to a Kaduna member", params: [idParam()],
      description: 'A member who registered the plate follows the job in their own dashboard. registered is null when it cannot be checked.',
      ok: [200, 'The plate and whether a member registered it', obj({ plate: nullable('string'), registered: nullable('boolean') })],
    },
  },
  '/api/v1/reports': {
    get: { tag: 'reports', summary: 'Business report for a date range', params: queryParams(v.reportsQuery), errors: [422], ok: [200, 'The report', ref('Report')] },
  },
};

/** Stable names for client generators; every documented operation must have one. */
const operationIds: Record<string, string> = {
  'get /api/v1/public/garages': 'listPublicGarages',
  'get /internal/v1/garages/{garageId}/staff': 'internalListStaff',
  'get /internal/v1/garages/{garageId}/job-cards/{jobId}': 'internalGetJob',
  'post /internal/v1/garages/{garageId}/job-cards/{jobId}/notes': 'internalAddJobNote',
  'post /internal/v1/garages/{garageId}/job-cards/{jobId}/parts': 'internalAddJobParts',
  'get /api/v1/job-cards/{id}/owner-link': 'getJobOwnerLink',
  'get /api/v1/my/visits': 'listMyVisits',
  'get /api/v1/my/garages': 'listBookableGarages',
  'get /api/v1/my/garages/{id}': 'getBookableGarage',
  'get /api/v1/my/garages/{id}/slots': 'getBookableGarageSlots',
  'post /api/v1/my/garages/{id}/book': 'bookGarage',
  'get /api/v1/garage': 'getGarage',
  'put /api/v1/garage': 'saveGarage',
  'get /api/v1/dashboard': 'getDashboard',
  'get /api/v1/customers': 'listCustomers',
  'post /api/v1/customers': 'createCustomer',
  'get /api/v1/customers/{id}': 'getCustomer',
  'patch /api/v1/customers/{id}': 'updateCustomer',
  'get /api/v1/vehicles': 'listVehicles',
  'post /api/v1/vehicles': 'createVehicle',
  'get /api/v1/vehicles/{id}': 'getVehicle',
  'patch /api/v1/vehicles/{id}': 'updateVehicle',
  'get /api/v1/parts': 'listParts',
  'post /api/v1/parts': 'createPart',
  'get /api/v1/parts/{id}': 'getPart',
  'patch /api/v1/parts/{id}': 'updatePart',
  'post /api/v1/parts/{id}/stock': 'adjustStock',
  'get /api/v1/parts/{id}/movements': 'listStockMovements',
  'get /api/v1/job-cards': 'listJobCards',
  'post /api/v1/job-cards': 'createJobCard',
  'post /api/v1/job-cards/from-dispatch': 'createJobCardFromDispatch',
  'get /api/v1/job-cards/{id}': 'getJobCard',
  'patch /api/v1/job-cards/{id}': 'updateJobCard',
  'post /api/v1/job-cards/{id}/status': 'changeJobCardStatus',
  'post /api/v1/job-cards/{id}/items': 'addJobItem',
  'delete /api/v1/job-cards/{id}/items/{itemId}': 'removeJobItem',
  'post /api/v1/job-cards/{id}/invoice': 'issueInvoice',
  'get /api/v1/invoices': 'listInvoices',
  'get /api/v1/invoices/{id}': 'getInvoice',
  'post /api/v1/invoices/{id}/pay': 'payInvoice',
  'post /api/v1/invoices/{id}/void': 'voidInvoice',
  'get /api/v1/public/track/{token}': 'getTracking',
  'post /api/v1/public/track/{token}/inspection/items/{itemId}': 'decideInspectionItem',
  'get /api/v1/me': 'getMe',
  'get /api/v1/public/book/{token}': 'getBookingPage',
  'post /api/v1/public/book/{token}': 'bookOnline',
  'get /api/v1/public/book/{token}/slots': 'listFreeSlots',
  'get /api/v1/public/bookings/{token}': 'getPublicBooking',
  'post /api/v1/public/bookings/{token}/cancel': 'cancelPublicBooking',
  'get /api/v1/booking-settings': 'getBookingSettings',
  'put /api/v1/booking-settings': 'saveBookingSettings',
  'post /api/v1/booking-settings/reset-link': 'resetBookingLink',
  'get /api/v1/repairs': 'listRepairs',
  'post /api/v1/staff/join': 'joinGarage',
  'post /api/v1/job-cards/{id}/updates': 'postJobUpdate',
  'post /api/v1/job-cards/{id}/tracking/reset': 'resetTracking',
  'get /api/v1/job-cards/{id}/inspection': 'getInspection',
  'post /api/v1/job-cards/{id}/inspection': 'createInspection',
  'patch /api/v1/job-cards/{id}/inspection': 'updateInspection',
  'post /api/v1/job-cards/{id}/inspection/items': 'addInspectionItem',
  'patch /api/v1/job-cards/{id}/inspection/items/{itemId}': 'updateInspectionItem',
  'delete /api/v1/job-cards/{id}/inspection/items/{itemId}': 'removeInspectionItem',
  'post /api/v1/job-cards/{id}/inspection/send': 'sendInspection',
  'post /api/v1/job-cards/{id}/inspection/mark-rest-ok': 'markInspectionRestOk',
  'get /api/v1/inspections': 'getInspectionBoard',
  'post /api/v1/job-cards/{id}/inspection/items/{itemId}/add-to-job': 'addInspectionItemToJob',
  'get /api/v1/appointments': 'listAppointments',
  'post /api/v1/appointments': 'createAppointment',
  'get /api/v1/appointments/{id}': 'getAppointment',
  'patch /api/v1/appointments/{id}': 'updateAppointment',
  'post /api/v1/appointments/{id}/status': 'setAppointmentStatus',
  'post /api/v1/appointments/{id}/check-in': 'checkInAppointment',
  'get /api/v1/staff': 'listStaff',
  'post /api/v1/staff': 'createStaff',
  'patch /api/v1/staff/{id}': 'updateStaff',
  'post /api/v1/staff/{id}/invite': 'resetStaffInvite',
  'get /api/v1/suppliers': 'listSuppliers',
  'post /api/v1/suppliers': 'createSupplier',
  'get /api/v1/suppliers/{id}': 'getSupplier',
  'patch /api/v1/suppliers/{id}': 'updateSupplier',
  'get /api/v1/locations': 'listLocations',
  'post /api/v1/locations': 'createLocation',
  'patch /api/v1/locations/{id}': 'updateLocation',
  'get /api/v1/stock-counts': 'listStockCounts',
  'post /api/v1/stock-counts': 'createStockCount',
  'get /api/v1/stock-counts/{id}': 'getStockCount',
  'get /api/v1/purchase-orders': 'listPurchaseOrders',
  'post /api/v1/purchase-orders': 'createPurchaseOrder',
  'get /api/v1/purchase-orders/{id}': 'getPurchaseOrder',
  'patch /api/v1/purchase-orders/{id}': 'updatePurchaseOrder',
  'post /api/v1/purchase-orders/{id}/place': 'placePurchaseOrder',
  'post /api/v1/purchase-orders/{id}/receive': 'receivePurchaseOrder',
  'post /api/v1/purchase-orders/{id}/cancel': 'cancelPurchaseOrder',
  'get /api/v1/assets': 'listAssets',
  'post /api/v1/assets': 'createAsset',
  'get /api/v1/assets/{id}': 'getAsset',
  'patch /api/v1/assets/{id}': 'updateAsset',
  'post /api/v1/assets/{id}/check-out': 'checkOutAsset',
  'post /api/v1/assets/{id}/check-in': 'checkInAsset',
  'post /api/v1/assets/{id}/service': 'recordAssetService',
  'get /api/v1/assets/{id}/log': 'getAssetLog',
  'get /api/v1/held-parts': 'listHeldParts',
  'post /api/v1/held-parts': 'createHeldPart',
  'patch /api/v1/held-parts/{id}': 'updateHeldPart',
  'post /api/v1/garage-calls': 'logGarageCall',
  'get /api/v1/admin/garage-calls': 'getGarageCallStats',
  'get /api/v1/reports': 'getReport',
};

export function buildOpenApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Kaduna.lk — Garage Management Service',
      version: '1.0.0',
      description:
        'A workshop system for Kaduna service providers: customers and vehicles, appointments, job cards, digital inspections, parts stock and suppliers, mechanics, invoices and reports, plus customer tracking links and what vehicle owners see. Parts shops are a separate service (parts-management). ' +
        'Every /api/v1 route except /api/v1/public needs a Supabase bearer token. The provider who owns a garage is its OWNER; mechanics join with an invite code and act as MECHANIC, with no access to money, settings or staff. Each garage sees only its own records. ' +
        'Generated from src/openapi.ts (request shapes come from the zod validators); do not edit by hand.',
    },
    servers: [
      { url: 'https://garage.kaduna.lk', description: 'Production' },
      { url: 'http://localhost:3002', description: 'Local development' },
    ],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'garage', description: "The provider's workshop: name, contact, labour and tax rates" },
      { name: 'dashboard', description: 'Counts and totals for the home screen' },
      { name: 'customers', description: 'People who bring vehicles in' },
      { name: 'vehicles', description: 'Vehicles serviced, by plate' },
      { name: 'inventory', description: 'Parts and their stock history' },
      { name: 'job-cards', description: 'Work orders, from walk-ins or Kaduna dispatch jobs' },
      { name: 'invoices', description: 'Invoices issued from job cards, and payments' },
      { name: 'inspections', description: 'Digital vehicle inspections the customer approves' },
      { name: 'appointments', description: 'Bookings, and checking customers in' },
      { name: 'staff', description: 'Mechanics and how they join' },
      { name: 'suppliers', description: 'Where parts come from, and spend' },
      { name: 'calls', description: 'Customers calling garages through Kaduna' },
      { name: 'admin', description: 'Platform figures for Kaduna administrators' },
      { name: 'stock', description: 'Shelves and bays, stocktakes, and purchase orders with goods-in' },
      { name: 'assets', description: "Tools and equipment register, and customers' parts the garage is holding" },
      { name: 'internal', description: 'For other Kaduna services (the parts service): mechanics, jobs and received parts' },
      { name: 'owners', description: 'Vehicle owners: their cars at any garage, and booking a garage from the Kaduna dashboard' },
      { name: 'reports', description: 'Revenue, jobs, mechanics and inspections over a date range' },
      { name: 'tracking', description: 'What customers and drivers see' },
      { name: 'booking', description: "Customers booking a slot through the garage's link" },
      { name: 'health', description: 'Liveness' },
    ],
    paths: {
      '/health': {
        get: {
          operationId: 'health', tags: ['health'], summary: 'Liveness and database check', security: [],
          responses: {
            200: reply('Healthy', obj({ service: { const: 'garage-management' }, status: { const: 'healthy' }, database: { const: 'connected' } })),
            503: failure('Database unreachable'),
          },
        },
      },
      ...Object.fromEntries(
        Object.entries(paths).map(([path, ops]) => [path, Object.fromEntries(Object.entries(ops).map(([method, op]) => [method, operation(`${method} ${path}`, op)]))]),
      ),
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Supabase access token' },
        internalToken: { type: 'apiKey', in: 'header', name: 'X-Internal-Token', description: 'Shared secret between Kaduna services (INTERNAL_API_TOKEN); /internal is not reachable from outside' },
      },
      schemas: responses,
    },
  };
}
