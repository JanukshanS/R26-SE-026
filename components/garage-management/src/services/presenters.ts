/**
 * Database rows to API responses. Decimal money and quantities become plain
 * numbers (Prisma would otherwise serialise them as strings), and internal
 * columns like garageId and the number counters are left out.
 */
import {
  Appointment,
  Customer,
  Garage,
  Inspection,
  InspectionItem,
  Invoice,
  JobCard,
  JobItem,
  JobUpdate,
  Part,
  Prisma,
  StaffMember,
  StockMovement,
  Supplier,
  Vehicle,
} from '@prisma/client';

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : d.toNumber());

export const presentGarage = (g: Garage) => ({
  id: g.id,
  providerId: g.providerId,
  name: g.name,
  phone: g.phone,
  address: g.address,
  labourRate: num(g.labourRate),
  taxRate: num(g.taxRate),
  currency: g.currency,
  email: g.email,
  registrationNo: g.registrationNo,
  logoUrl: g.logoUrl,
  brandColor: g.brandColor,
  invoiceTerms: g.invoiceTerms,
  invoiceFooter: g.invoiceFooter,
  bankDetails: g.bankDetails,
  createdAt: g.createdAt,
});

export const presentCustomer = (c: Customer) => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  notes: c.notes,
  createdAt: c.createdAt,
});

export const presentVehicle = (v: Vehicle) => ({
  id: v.id,
  customerId: v.customerId,
  plate: v.plate,
  make: v.make,
  model: v.model,
  year: v.year,
  odometerKm: v.odometerKm,
  notes: v.notes,
  createdAt: v.createdAt,
});

export const presentPart = (p: Part) => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  brand: p.brand,
  unitCost: num(p.unitCost),
  unitPrice: num(p.unitPrice),
  stockQty: num(p.stockQty),
  reorderLevel: num(p.reorderLevel),
  active: p.active,
  lowStock: p.active && p.stockQty.lte(p.reorderLevel),
  supplierId: p.supplierId,
});

export const presentMovement = (m: StockMovement) => ({
  id: m.id,
  partId: m.partId,
  quantityChange: num(m.quantityChange),
  reason: m.reason,
  jobCardId: m.jobCardId,
  supplierId: m.supplierId,
  unitCost: num(m.unitCost),
  note: m.note,
  createdAt: m.createdAt,
});

export const presentItem = (i: JobItem) => ({
  id: i.id,
  kind: i.kind,
  description: i.description,
  quantity: num(i.quantity),
  unitPrice: num(i.unitPrice),
  partId: i.partId,
  lineTotal: i.quantity.mul(i.unitPrice).toDecimalPlaces(2).toNumber(),
});

export const presentInvoice = (inv: Invoice & { jobCard?: { number: number } | null }) => ({
  id: inv.id,
  number: inv.number,
  jobCardId: inv.jobCardId,
  jobNumber: inv.jobCard?.number ?? null,
  status: inv.status,
  lines: inv.lines,
  subtotal: num(inv.subtotal),
  tax: num(inv.tax),
  total: num(inv.total),
  paymentMethod: inv.paymentMethod,
  issuedAt: inv.issuedAt,
  paidAt: inv.paidAt,
});

/** The invite code is the owner's to hand out, so mechanics never see each other's. */
export const presentStaff = (s: StaffMember, opts: { withInvite?: boolean } = {}) => ({
  id: s.id,
  name: s.name,
  phone: s.phone,
  active: s.active,
  joined: Boolean(s.userId),
  joinedAt: s.joinedAt,
  inviteCode: opts.withInvite ? s.inviteCode : null,
  createdAt: s.createdAt,
});

const mechanicRef = (m: StaffMember | null | undefined) => (m ? { id: m.id, name: m.name } : null);

export const presentUpdate = (u: JobUpdate) => ({
  id: u.id,
  status: u.status,
  note: u.note,
  author: u.author,
  public: u.public,
  createdAt: u.createdAt,
});

type JobCardSummary = JobCard & { customer: Customer | null; vehicle: Vehicle | null; mechanic?: StaffMember | null };

export const presentJobSummary = (j: JobCardSummary) => ({
  id: j.id,
  number: j.number,
  status: j.status,
  source: j.source,
  customer: j.customer ? presentCustomer(j.customer) : null,
  vehicle: j.vehicle ? presentVehicle(j.vehicle) : null,
  mechanic: mechanicRef(j.mechanic),
  complaint: j.complaint,
  promisedAt: j.promisedAt,
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
});

export const presentJob = (
  j: JobCardSummary & { items: JobItem[]; invoices: Invoice[]; updates?: JobUpdate[]; inspection?: (Inspection & { items: InspectionItem[] }) | null },
) => {
  const subtotal = j.items.reduce((sum, i) => sum.add(i.quantity.mul(i.unitPrice)), new Prisma.Decimal(0));
  const invoice = j.invoices.find((inv) => inv.status !== 'VOID') ?? null;
  const inspectionItems = j.inspection?.items ?? [];
  return {
    ...presentJobSummary(j),
    dispatchIncidentId: j.dispatchIncidentId,
    diagnosis: j.diagnosis,
    odometerIn: j.odometerIn,
    assignedTo: j.assignedTo,
    closedAt: j.closedAt,
    trackingToken: j.trackingToken,
    items: j.items.map(presentItem),
    subtotal: subtotal.toDecimalPlaces(2).toNumber(),
    invoice: invoice ? { id: invoice.id, number: invoice.number, status: invoice.status, total: num(invoice.total) } : null,
    updates: (j.updates ?? []).map(presentUpdate),
    inspection: j.inspection
      ? {
          id: j.inspection.id,
          status: j.inspection.status,
          checked: inspectionItems.filter((i) => i.result !== 'NOT_CHECKED').length,
          total: inspectionItems.length,
          attention: inspectionItems.filter((i) => i.result === 'ATTENTION' || i.result === 'URGENT').length,
          pendingApproval: inspectionItems.filter((i) => i.approval === 'PENDING').length,
        }
      : null,
  };
};

export const presentInspectionItem = (i: InspectionItem) => ({
  id: i.id,
  category: i.category,
  name: i.name,
  result: i.result,
  note: i.note,
  estimate: num(i.estimate),
  approval: i.approval,
  decidedAt: i.decidedAt,
  jobItemId: i.jobItemId,
  sortOrder: i.sortOrder,
});

export const presentInspection = (ins: Inspection & { items: InspectionItem[] }) => ({
  id: ins.id,
  jobCardId: ins.jobCardId,
  status: ins.status,
  summary: ins.summary,
  sentAt: ins.sentAt,
  createdAt: ins.createdAt,
  updatedAt: ins.updatedAt,
  items: ins.items.map(presentInspectionItem),
});

export const presentAppointment = (
  a: Appointment & { customer?: Customer | null; vehicle?: Vehicle | null; mechanic?: StaffMember | null; jobCard?: { number: number; status: string } | null },
) => ({
  id: a.id,
  customerId: a.customerId,
  vehicleId: a.vehicleId,
  customerName: a.customer?.name ?? a.customerName,
  phone: a.customer?.phone ?? a.phone,
  plate: a.vehicle?.plate ?? a.plate,
  vehicle: a.vehicle ? presentVehicle(a.vehicle) : null,
  service: a.service,
  notes: a.notes,
  startsAt: a.startsAt,
  durationMin: a.durationMin,
  status: a.status,
  source: a.source,
  mechanic: mechanicRef(a.mechanic),
  jobCardId: a.jobCardId,
  jobNumber: a.jobCard?.number ?? null,
  createdAt: a.createdAt,
});

export const presentSupplier = (s: Supplier & { _count?: { parts: number } }) => ({
  id: s.id,
  name: s.name,
  contactName: s.contactName,
  phone: s.phone,
  email: s.email,
  address: s.address,
  notes: s.notes,
  active: s.active,
  partCount: s._count?.parts ?? null,
  createdAt: s.createdAt,
});
