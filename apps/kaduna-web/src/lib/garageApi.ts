// Garage-management service client for /provider/garage, /workshop and /track.
// Shapes follow contracts/garage-management.openapi.yaml (generated from the
// service), and the transport matches dispatchApi.ts: Supabase bearer,
// `{ success, data }`.
import { authHeaders } from "./supabase";

const BASE_URL = process.env.NEXT_PUBLIC_GARAGE_URL ?? "http://localhost:3002";

export type JobStatus = "OPEN" | "IN_PROGRESS" | "WAITING_PARTS" | "READY" | "CLOSED" | "CANCELLED";
export type ItemKind = "LABOUR" | "PART";
export type InvoiceStatus = "UNPAID" | "PAID" | "VOID";
export type PaymentMethod = "CASH" | "CARD" | "BANK_TRANSFER" | "OTHER";
export type Role = "OWNER" | "MECHANIC";
export type InspectionStatus = "DRAFT" | "SENT";
export type CheckResult = "NOT_CHECKED" | "OK" | "ATTENTION" | "URGENT";
export type Approval = "PENDING" | "APPROVED" | "DECLINED";
export type AppointmentStatus = "BOOKED" | "CONFIRMED" | "ARRIVED" | "CANCELLED" | "NO_SHOW";

export const JOB_STATUSES: JobStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "READY", "CLOSED", "CANCELLED"];
export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CARD", "BANK_TRANSFER", "OTHER"];
export const CHECK_RESULTS: CheckResult[] = ["OK", "ATTENTION", "URGENT", "NOT_CHECKED"];

/** Same workflow as the service (src/services/jobCards.ts); the server still enforces it. */
export const NEXT_STATUSES: Record<JobStatus, JobStatus[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_PARTS", "READY", "CANCELLED"],
  WAITING_PARTS: ["IN_PROGRESS", "CANCELLED"],
  READY: ["CLOSED", "IN_PROGRESS", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

/** Statuses a mechanic may not set: handing over and calling off are the owner's. */
export const OWNER_ONLY_STATUSES: JobStatus[] = ["CLOSED", "CANCELLED"];

export const isFinished = (s: JobStatus) => s === "CLOSED" || s === "CANCELLED";

export interface Garage {
  id: string;
  providerId: string;
  name: string;
  phone: string | null;
  address: string | null;
  labourRate: number;
  taxRate: number;
  currency: string;
  email: string | null;
  registrationNo: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  invoiceTerms: string | null;
  invoiceFooter: string | null;
  bankDetails: string | null;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  customerId: string | null;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  odometerKm: number | null;
  notes: string | null;
  createdAt: string;
}

export interface Part {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  unitCost: number;
  unitPrice: number;
  stockQty: number;
  reorderLevel: number;
  active: boolean;
  lowStock: boolean;
  supplierId: string | null;
  kind: "PART" | "CONSUMABLE";
  category: string | null;
  barcode: string | null;
  locationId: string | null;
}

export interface StockMovement {
  id: string;
  partId: string;
  quantityChange: number;
  reason: "PURCHASE" | "JOB_USE" | "RETURN" | "ADJUSTMENT" | "WORKSHOP_USE" | "COUNT";
  jobCardId: string | null;
  supplierId: string | null;
  unitCost: number | null;
  note: string | null;
  createdAt: string;
}

export interface JobItem {
  id: string;
  kind: ItemKind;
  description: string;
  quantity: number;
  unitPrice: number;
  partId: string | null;
  lineTotal: number;
}

export interface MechanicRef {
  id: string;
  name: string;
}

export interface JobUpdate {
  id: string;
  status: JobStatus | null;
  note: string | null;
  /** The mechanic's name, "Customer", or null for the workshop. */
  author: string | null;
  public: boolean;
  createdAt: string;
}

export interface JobCardSummary {
  id: string;
  number: number;
  status: JobStatus;
  source: "WALK_IN" | "KADUNA_DISPATCH";
  customer: Customer | null;
  vehicle: Vehicle | null;
  mechanic: MechanicRef | null;
  complaint: string | null;
  promisedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobCard extends JobCardSummary {
  dispatchIncidentId: string | null;
  diagnosis: string | null;
  odometerIn: number | null;
  assignedTo: string | null;
  closedAt: string | null;
  trackingToken: string;
  items: JobItem[];
  subtotal: number;
  invoice: { id: string; number: number; status: InvoiceStatus; total: number } | null;
  updates: JobUpdate[];
  inspection: { id: string; status: InspectionStatus; checked: number; total: number; attention: number; pendingApproval: number } | null;
}

export interface Invoice {
  id: string;
  number: number;
  jobCardId: string;
  jobNumber: number | null;
  status: InvoiceStatus;
  lines: { kind: ItemKind; description: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: PaymentMethod | null;
  issuedAt: string;
  paidAt: string | null;
}

export interface Dashboard {
  jobsByStatus: Partial<Record<JobStatus, number>>;
  openJobs: number;
  jobsDueToday: number;
  revenueThisMonth: number;
  unpaidTotal: number;
  lowStockParts: Part[];
}

export interface StaffMember {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
  joined: boolean;
  joinedAt: string | null;
  inviteCode: string | null;
  createdAt: string;
}

export interface Me {
  role: Role | null;
  garage: Garage | null;
  staff: StaffMember | null;
  /** The caller's parts shop, if they run one (any account can). */
  seller: { id: string; name: string } | null;
}

export interface InspectionItem {
  id: string;
  category: string;
  name: string;
  result: CheckResult;
  note: string | null;
  estimate: number | null;
  approval: Approval | null;
  decidedAt: string | null;
  jobItemId: string | null;
  sortOrder: number;
}

export interface Inspection {
  id: string;
  jobCardId: string;
  status: InspectionStatus;
  summary: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: InspectionItem[];
}

export interface InspectionBoardRow {
  job: JobCardSummary;
  /** null: not inspected yet. */
  inspection: {
    id: string;
    status: InspectionStatus;
    sentAt: string | null;
    updatedAt: string;
    total: number;
    checked: number;
    attention: number;
    urgent: number;
    pendingApproval: number;
    /** Approved by the customer, not on the job yet. */
    approvedToAdd: number;
    declined: number;
  } | null;
}

export interface Appointment {
  id: string;
  customerId: string | null;
  vehicleId: string | null;
  customerName: string | null;
  phone: string | null;
  plate: string | null;
  vehicle: Vehicle | null;
  service: string;
  notes: string | null;
  startsAt: string;
  durationMin: number;
  status: AppointmentStatus;
  /** ONLINE: the customer booked it through the booking link. */
  source: "STAFF" | "ONLINE";
  mechanic: MechanicRef | null;
  jobCardId: string | null;
  jobNumber: number | null;
  createdAt: string;
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type OpeningHours = { open: string; close: string } | null;

export interface BookingSettings {
  enabled: boolean;
  /** While booking is on, drivers can also find the garage and book from their Kaduna dashboard. Defaults to true. */
  listed?: boolean;
  slotMinutes: number;
  capacity: number;
  leadHours: number;
  daysAhead: number;
  hours: Record<Weekday, OpeningHours>;
  services: string[];
  note: string | null;
}

export interface BookingConfig {
  settings: BookingSettings;
  /** null until the settings are first saved. */
  token: string | null;
}

type PublicGarage = { name: string; phone: string | null; address: string | null; logoUrl: string | null; brandColor: string | null };

export interface BookingPage {
  garage: PublicGarage;
  enabled: boolean;
  slotMinutes: number;
  daysAhead: number;
  hours: Record<Weekday, OpeningHours>;
  services: string[];
  note: string | null;
  timeZoneOffsetMinutes: number;
}

export interface DaySlots {
  date: string;
  weekday: Weekday;
  open: boolean;
  slots: { startsAt: string; time: string; free: number }[];
}

export interface PublicBooking {
  garage: PublicGarage;
  service: string;
  startsAt: string;
  durationMin: number;
  status: AppointmentStatus;
  name: string | null;
  plate: string | null;
  cancellable: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  partCount: number | null;
  createdAt: string;
}

export interface SupplierRow extends Supplier {
  totalSpend: number;
  lastPurchaseAt: string | null;
}

export interface SupplierDetail extends Supplier {
  totalSpend: number;
  parts: Part[];
  purchases: (StockMovement & { partName: string; partSku: string })[];
}

export interface Report {
  from: string;
  to: string;
  totals: {
    revenue: number;
    net: number;
    tax: number;
    invoices: number;
    averageInvoice: number;
    labour: number;
    parts: number;
    partsCost: number;
    grossProfit: number;
  };
  days: { date: string; labour: number; parts: number; total: number }[];
  paymentMethods: { method: PaymentMethod; count: number; total: number }[];
  jobs: { opened: number; walkIn: number; kaduna: number; closed: number; averageTurnaroundHours: number | null };
  mechanics: { mechanicId: string | null; name: string | null; jobsClosed: number; labour: number }[];
  topServices: { description: string; count: number; revenue: number }[];
  topParts: { description: string; quantity: number; revenue: number }[];
  inspections: { recommended: number; approved: number; declined: number; pending: number; approvedValue: number; declinedValue: number };
  customers: { new: number };
  appointments: { total: number; arrived: number; noShow: number; cancelled: number };
}

export interface Tracking {
  garage: { name: string; phone: string | null; address: string | null; logoUrl: string | null; brandColor: string | null; currency: string; taxRate: number };
  job: {
    number: number;
    status: JobStatus;
    source: "WALK_IN" | "KADUNA_DISPATCH";
    complaint: string | null;
    diagnosis: string | null;
    promisedAt: string | null;
    createdAt: string;
    closedAt: string | null;
    customerName: string | null;
    mechanicName: string | null;
    vehicle: { plate: string | null; make: string | null; model: string | null; year: number | null } | null;
  };
  items: { kind: ItemKind; description: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  invoice: { number: number; status: "UNPAID" | "PAID"; subtotal: number; tax: number; total: number; issuedAt: string; paidAt: string | null } | null;
  updates: { id: string; status: JobStatus | null; note: string | null; author: string | null; createdAt: string }[];
  inspection: {
    summary: string | null;
    sentAt: string | null;
    items: { id: string; category: string; name: string; result: Exclude<CheckResult, "NOT_CHECKED">; note: string | null; estimate: number | null; approval: Approval | null; inJob: boolean }[];
  } | null;
}

export interface Repair {
  incidentId: string;
  garage: { name: string; phone: string | null; address: string | null };
  jobNumber: number;
  status: JobStatus;
  promisedAt: string | null;
  updatedAt: string;
  lastUpdate: { status: JobStatus | null; note: string | null; createdAt: string } | null;
  approvalsWaiting: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export class GarageApiError extends Error {
  status: number;
  details?: { path: string; message: string }[];
  constructor(status: number, message: string, details?: { path: string; message: string }[]) {
    super(message);
    this.name = "GarageApiError";
    this.status = status;
    this.details = details;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: { path: string; message: string }[];
}

async function request<T>(path: string, init?: RequestInit & { anonymous?: boolean }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.anonymous ? {} : await authHeaders()), ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GarageApiError(0, "Couldn't reach the garage service. Check your connection and try again.");
  }
  let body: Envelope<T> | undefined;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    /* non-JSON */
  }
  if (!res.ok || !body?.success) {
    const detail = body?.details?.[0];
    const message = detail ? `${body?.error ?? "Invalid"}: ${detail.path} ${detail.message}`.trim() : body?.error ?? `HTTP ${res.status}`;
    throw new GarageApiError(res.status, message, body?.details);
  }
  return body.data as T;
}

const get = <T>(path: string) => request<T>(path);
const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ─── Who am I, garage & dashboard ────────────────────────────────────────

export type GarageInput = {
  name: string;
  phone?: string | null;
  address?: string | null;
  labourRate: number;
  taxRate: number;
  email?: string | null;
  registrationNo?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  invoiceTerms?: string | null;
  invoiceFooter?: string | null;
  bankDetails?: string | null;
};

export const getMe = () => get<Me>("/api/v1/me");
export const joinGarage = (code: string) => send<Me>("POST", "/api/v1/staff/join", { code });
export const getGarage = () => get<Garage | null>("/api/v1/garage");
export const saveGarage = (input: GarageInput) => send<Garage>("PUT", "/api/v1/garage", input);
export const getDashboard = () => get<Dashboard>("/api/v1/dashboard");

// ─── Customers & vehicles ────────────────────────────────────────────────

export type CustomerInput = { name: string; phone?: string | null; email?: string | null; notes?: string | null };
export type VehicleInput = {
  customerId?: string | null;
  plate?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  odometerKm?: number | null;
  notes?: string | null;
};

export const listCustomers = (q?: string, limit = 50, offset = 0) => get<Page<Customer>>(`/api/v1/customers${qs({ q, limit, offset })}`);
export const getCustomer = (id: string) => get<Customer & { vehicles: Vehicle[] }>(`/api/v1/customers/${id}`);
export const createCustomer = (input: CustomerInput) => send<Customer>("POST", "/api/v1/customers", input);
export const updateCustomer = (id: string, input: Partial<CustomerInput>) => send<Customer>("PATCH", `/api/v1/customers/${id}`, input);

export const listVehicles = (opts: { q?: string; customerId?: string; limit?: number } = {}) =>
  get<Page<Vehicle>>(`/api/v1/vehicles${qs({ limit: 50, ...opts })}`);
export const createVehicle = (input: VehicleInput) => send<Vehicle>("POST", "/api/v1/vehicles", input);
export const updateVehicle = (id: string, input: Partial<VehicleInput>) => send<Vehicle>("PATCH", `/api/v1/vehicles/${id}`, input);

// ─── Inventory & suppliers ───────────────────────────────────────────────

export type PartInput = {
  sku: string;
  name: string;
  brand?: string | null;
  unitCost: number;
  unitPrice: number;
  reorderLevel: number;
  openingStock: number;
  supplierId?: string | null;
  kind?: "PART" | "CONSUMABLE";
  category?: string | null;
  barcode?: string | null;
  locationId?: string | null;
};
export type StockInput = {
  quantityChange: number;
  reason: "PURCHASE" | "RETURN" | "ADJUSTMENT" | "WORKSHOP_USE";
  note?: string | null;
  supplierId?: string | null;
  unitCost?: number | null;
};

export const listParts = (opts: { q?: string; lowStock?: boolean; includeInactive?: boolean; limit?: number; kind?: "PART" | "CONSUMABLE"; category?: string; locationId?: string } = {}) =>
  get<Page<Part>>(`/api/v1/parts${qs({ limit: 200, ...opts })}`);
export const createPart = (input: PartInput) => send<Part>("POST", "/api/v1/parts", input);
export const updatePart = (id: string, input: Partial<Omit<PartInput, "sku" | "openingStock">> & { active?: boolean }) =>
  send<Part>("PATCH", `/api/v1/parts/${id}`, input);
export const adjustStock = (id: string, input: StockInput) => send<Part>("POST", `/api/v1/parts/${id}/stock`, input);
export const listMovements = (id: string) => get<Page<StockMovement>>(`/api/v1/parts/${id}/movements?limit=100`);

export type SupplierInput = { name: string; contactName?: string | null; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null };

export const listSuppliers = (opts: { q?: string; includeInactive?: boolean } = {}) => get<SupplierRow[]>(`/api/v1/suppliers${qs(opts)}`);
export const getSupplier = (id: string) => get<SupplierDetail>(`/api/v1/suppliers/${id}`);
export const createSupplier = (input: SupplierInput) => send<Supplier>("POST", "/api/v1/suppliers", input);
export const updateSupplier = (id: string, input: Partial<SupplierInput> & { active?: boolean }) => send<Supplier>("PATCH", `/api/v1/suppliers/${id}`, input);

// ─── Job cards ───────────────────────────────────────────────────────────

export type JobCardInput = {
  customerId?: string | null;
  vehicleId?: string | null;
  complaint?: string | null;
  odometerIn?: number | null;
  assignedTo?: string | null;
  mechanicId?: string | null;
  promisedAt?: string | null;
};

export const listJobCards = (
  opts: { status?: JobStatus; active?: boolean; customerId?: string; vehicleId?: string; mechanicId?: string; mine?: boolean; q?: string; limit?: number; offset?: number } = {}
) => get<Page<JobCardSummary>>(`/api/v1/job-cards${qs({ limit: 50, ...opts })}`);
export const getJobCard = (id: string) => get<JobCard>(`/api/v1/job-cards/${id}`);
export const createJobCard = (input: JobCardInput) => send<JobCard>("POST", "/api/v1/job-cards", input);
export const createJobCardFromDispatch = (incidentId: string) => send<JobCard>("POST", "/api/v1/job-cards/from-dispatch", { incidentId });
export const updateJobCard = (id: string, input: JobCardInput & { diagnosis?: string | null }) => send<JobCard>("PATCH", `/api/v1/job-cards/${id}`, input);
export const changeJobStatus = (id: string, status: JobStatus) => send<JobCard>("POST", `/api/v1/job-cards/${id}/status`, { status });
export const addJobItem = (id: string, input: { kind: ItemKind; description?: string | null; quantity?: number; unitPrice?: number | null; partId?: string | null }) =>
  send<JobCard>("POST", `/api/v1/job-cards/${id}/items`, input);
export const removeJobItem = (id: string, itemId: string) => send<JobCard>("DELETE", `/api/v1/job-cards/${id}/items/${itemId}`);
export const issueInvoice = (id: string) => send<Invoice>("POST", `/api/v1/job-cards/${id}/invoice`);
export const postJobUpdate = (id: string, input: { note: string; public: boolean }) => send<JobCard>("POST", `/api/v1/job-cards/${id}/updates`, input);
export const resetTracking = (id: string) => send<JobCard>("POST", `/api/v1/job-cards/${id}/tracking/reset`);

/** The customer-facing page for a job, on this site. */
export const trackingUrl = (token: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/track?t=${encodeURIComponent(token)}`;

// ─── Inspections ─────────────────────────────────────────────────────────

const inspectionPath = (jobId: string) => `/api/v1/job-cards/${jobId}/inspection`;
export type InspectionItemPatch = { result?: CheckResult; note?: string | null; estimate?: number | null; approval?: Approval };

export const getInspection = (jobId: string) => get<Inspection | null>(inspectionPath(jobId));
export const startInspection = (jobId: string, template: "STANDARD" | "BLANK" = "STANDARD") => send<Inspection>("POST", inspectionPath(jobId), { template });
export const updateInspection = (jobId: string, input: { summary: string | null }) => send<Inspection>("PATCH", inspectionPath(jobId), input);
export const addInspectionItem = (jobId: string, input: { category: string; name: string; result?: CheckResult; note?: string | null; estimate?: number | null }) =>
  send<Inspection>("POST", `${inspectionPath(jobId)}/items`, input);
export const updateInspectionItem = (jobId: string, itemId: string, input: InspectionItemPatch) =>
  send<Inspection>("PATCH", `${inspectionPath(jobId)}/items/${itemId}`, input);
export const removeInspectionItem = (jobId: string, itemId: string) => send<Inspection>("DELETE", `${inspectionPath(jobId)}/items/${itemId}`);
export const markInspectionRestOk = (jobId: string) => send<Inspection>("POST", `${inspectionPath(jobId)}/mark-rest-ok`);
export const getInspectionBoard = (opts: { mine?: boolean } = {}) => get<InspectionBoardRow[]>(`/api/v1/inspections${qs(opts)}`);
export const sendInspection = (jobId: string) => send<Inspection>("POST", `${inspectionPath(jobId)}/send`);
export const addInspectionItemToJob = (jobId: string, itemId: string) => send<JobCard>("POST", `${inspectionPath(jobId)}/items/${itemId}/add-to-job`);

// ─── Appointments ────────────────────────────────────────────────────────

export type AppointmentInput = {
  customerId?: string | null;
  vehicleId?: string | null;
  customerName?: string | null;
  phone?: string | null;
  plate?: string | null;
  service: string;
  notes?: string | null;
  startsAt: string;
  durationMin?: number;
  mechanicId?: string | null;
};

export const listAppointments = (opts: { from?: string; to?: string; status?: AppointmentStatus } = {}) => get<Appointment[]>(`/api/v1/appointments${qs(opts)}`);
export const createAppointment = (input: AppointmentInput) => send<Appointment>("POST", "/api/v1/appointments", input);
export const updateAppointment = (id: string, input: Partial<AppointmentInput>) => send<Appointment>("PATCH", `/api/v1/appointments/${id}`, input);
export const setAppointmentStatus = (id: string, status: Exclude<AppointmentStatus, "ARRIVED">) =>
  send<Appointment>("POST", `/api/v1/appointments/${id}/status`, { status });
export const checkInAppointment = (id: string) => send<{ appointment: Appointment; job: JobCard }>("POST", `/api/v1/appointments/${id}/check-in`);

// ─── Staff & reports ─────────────────────────────────────────────────────

export const listStaff = () => get<StaffMember[]>("/api/v1/staff");
export const createStaff = (input: { name: string; phone?: string | null }) => send<StaffMember>("POST", "/api/v1/staff", input);
export const updateStaff = (id: string, input: { name?: string; phone?: string | null; active?: boolean }) => send<StaffMember>("PATCH", `/api/v1/staff/${id}`, input);
export const resetStaffInvite = (id: string) => send<StaffMember>("POST", `/api/v1/staff/${id}/invite`);
export const getReport = (from?: string, to?: string) => get<Report>(`/api/v1/reports${qs({ from, to })}`);

// ─── Invoices ────────────────────────────────────────────────────────────

export const listInvoices = (status?: InvoiceStatus) => get<Page<Invoice>>(`/api/v1/invoices${qs({ status, limit: 100 })}`);
export const getInvoice = (id: string) => get<Invoice>(`/api/v1/invoices/${id}`);
export const payInvoice = (id: string, method: PaymentMethod) => send<Invoice>("POST", `/api/v1/invoices/${id}/pay`, { method });
export const voidInvoice = (id: string) => send<Invoice>("POST", `/api/v1/invoices/${id}/void`);

// ─── Customers & drivers (tracking) ──────────────────────────────────────

/** No sign-in: the token is the key. */
export const getTracking = (token: string) => request<Tracking>(`/api/v1/public/track/${encodeURIComponent(token)}`, { anonymous: true });
export const decideInspectionItem = (token: string, itemId: string, decision: "APPROVED" | "DECLINED") =>
  request<Tracking>(`/api/v1/public/track/${encodeURIComponent(token)}/inspection/items/${itemId}`, {
    method: "POST",
    body: JSON.stringify({ decision }),
    anonymous: true,
  });
/** Repair status for the signed-in driver's Kaduna jobs. */
export const listRepairs = (incidentIds: string[]) =>
  incidentIds.length ? get<Repair[]>(`/api/v1/repairs${qs({ incidentIds: incidentIds.slice(0, 50).join(",") })}`) : Promise.resolve([] as Repair[]);

// ─── Online booking ──────────────────────────────────────────────────────

export const getBookingSettings = () => get<BookingConfig>("/api/v1/booking-settings");
export const saveBookingSettings = (settings: BookingSettings) => send<BookingConfig>("PUT", "/api/v1/booking-settings", settings);
export const resetBookingLink = () => send<BookingConfig>("POST", "/api/v1/booking-settings/reset-link");

/** The page a garage shares so customers can book, on this site. */
export const bookingUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/book?g=${encodeURIComponent(token)}`;

const pub = <T,>(path: string, init?: RequestInit) => request<T>(`/api/v1/public${path}`, { ...init, anonymous: true });
export const getBookingPage = (token: string) => pub<BookingPage>(`/book/${encodeURIComponent(token)}`);
export const getFreeSlots = (token: string, from?: string, days = 7) => pub<DaySlots[]>(`/book/${encodeURIComponent(token)}/slots${qs({ from, days })}`);
export const bookOnline = (
  token: string,
  input: { startsAt: string; service: string; name: string; phone: string; plate?: string | null; vehicle?: string | null; notes?: string | null; website?: string }
) => pub<{ token: string; booking: PublicBooking }>(`/book/${encodeURIComponent(token)}`, { method: "POST", body: JSON.stringify(input) });
export const getPublicBooking = (token: string) => pub<PublicBooking>(`/bookings/${encodeURIComponent(token)}`);
/** Whether the job's car belongs to a Kaduna member (who then follows it in their app); registered null: can't tell. */
export const getJobOwnerLink = (jobId: string) => get<{ plate: string | null; registered: boolean | null }>(`/api/v1/job-cards/${jobId}/owner-link`);
export const cancelPublicBooking = (token: string) => pub<PublicBooking>(`/bookings/${encodeURIComponent(token)}/cancel`, { method: "POST" });

// ─── Stock locations, stocktakes, purchase orders ────────────────────────

export interface StockLocation {
  id: string;
  name: string;
  note: string | null;
  active: boolean;
  partCount: number | null;
  assetCount: number | null;
  heldCount: number | null;
}
export const listLocations = (includeInactive = false) => get<StockLocation[]>(`/api/v1/locations${qs({ includeInactive: includeInactive || undefined })}`);
export const createLocation = (input: { name: string; note?: string | null }) => send<StockLocation>("POST", "/api/v1/locations", input);
export const updateLocation = (id: string, input: { name?: string; note?: string | null; active?: boolean }) => send<StockLocation>("PATCH", `/api/v1/locations/${id}`, input);

export interface StockCountLine {
  partId: string;
  sku: string;
  name: string;
  expected: number;
  counted: number;
  variance: number;
  varianceValue: number;
}
export interface StockCount {
  id: string;
  note: string | null;
  countedBy: string | null;
  createdAt: string;
  lineCount: number;
  mismatches: number;
  netVarianceValue: number;
  lines: StockCountLine[];
}
export const listStockCounts = () => get<Page<StockCount>>("/api/v1/stock-counts?limit=30");
export const createStockCount = (input: { note?: string | null; lines: { partId: string; counted: number }[] }) => send<StockCount>("POST", "/api/v1/stock-counts", input);

export type PurchaseStatus = "DRAFT" | "ORDERED" | "PARTLY_RECEIVED" | "RECEIVED" | "CANCELLED";
export interface PurchaseLine {
  id: string;
  partId: string;
  sku: string;
  name: string;
  quantity: number;
  unitCost: number;
  receivedQty: number;
  lineTotal: number;
}
export interface PurchaseOrder {
  id: string;
  number: number;
  reference: string;
  status: PurchaseStatus;
  note: string | null;
  supplierId: string;
  supplierName: string;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  total: number;
  lines: PurchaseLine[];
}
export type PurchaseOrderInput = { supplierId: string; note?: string | null; lines: { partId: string; quantity: number; unitCost: number }[] };
export const listPurchaseOrders = (status?: PurchaseStatus) => get<Page<PurchaseOrder>>(`/api/v1/purchase-orders${qs({ status, limit: 100 })}`);
export const createPurchaseOrder = (input: PurchaseOrderInput) => send<PurchaseOrder>("POST", "/api/v1/purchase-orders", input);
export const updatePurchaseOrder = (id: string, input: { note?: string | null; lines?: PurchaseOrderInput["lines"] }) => send<PurchaseOrder>("PATCH", `/api/v1/purchase-orders/${id}`, input);
export const placePurchaseOrder = (id: string) => send<PurchaseOrder>("POST", `/api/v1/purchase-orders/${id}/place`);
export const receivePurchaseOrder = (id: string, lines: { lineId: string; quantity: number }[]) => send<PurchaseOrder>("POST", `/api/v1/purchase-orders/${id}/receive`, { lines });
export const cancelPurchaseOrder = (id: string) => send<PurchaseOrder>("POST", `/api/v1/purchase-orders/${id}/cancel`);

// ─── Tools & equipment ───────────────────────────────────────────────────

export type AssetCondition = "GOOD" | "FAIR" | "NEEDS_REPAIR" | "RETIRED";
export interface Asset {
  id: string;
  name: string;
  tag: string | null;
  category: string | null;
  serialNo: string | null;
  purchaseDate: string | null;
  cost: number;
  locationId: string | null;
  locationName: string | null;
  condition: AssetCondition;
  heldById: string | null;
  heldByName: string | null;
  checkedOutAt: string | null;
  serviceIntervalDays: number | null;
  nextServiceDue: string | null;
  dueInDays: number | null;
  serviceState: "OK" | "SOON" | "OVERDUE" | null;
  warrantyUntil: string | null;
  note: string | null;
  active: boolean;
  createdAt: string;
}
export interface AssetLog {
  id: string;
  type: "CHECK_OUT" | "CHECK_IN" | "SERVICE" | "CONDITION" | "NOTE";
  staffName: string | null;
  note: string | null;
  createdAt: string;
}
export type AssetInput = {
  name: string;
  tag?: string | null;
  category?: string | null;
  serialNo?: string | null;
  purchaseDate?: string | null;
  cost?: number;
  locationId?: string | null;
  condition?: AssetCondition;
  serviceIntervalDays?: number | null;
  nextServiceDue?: string | null;
  warrantyUntil?: string | null;
  note?: string | null;
};
export const listAssets = (opts: { q?: string; category?: string; status?: "available" | "out" | "due" | "attention"; includeInactive?: boolean } = {}) =>
  get<Asset[]>(`/api/v1/assets${qs(opts)}`);
export const createAsset = (input: AssetInput) => send<Asset>("POST", "/api/v1/assets", input);
export const updateAsset = (id: string, input: Partial<AssetInput> & { active?: boolean }) => send<Asset>("PATCH", `/api/v1/assets/${id}`, input);
export const checkOutAsset = (id: string, input: { staffId: string; note?: string | null }) => send<Asset>("POST", `/api/v1/assets/${id}/check-out`, input);
export const checkInAsset = (id: string, input: { condition?: AssetCondition; note?: string | null }) => send<Asset>("POST", `/api/v1/assets/${id}/check-in`, input);
export const serviceAsset = (id: string, input: { note?: string | null; nextServiceDue?: string | null; condition?: AssetCondition }) => send<Asset>("POST", `/api/v1/assets/${id}/service`, input);
export const getAssetLog = (id: string) => get<AssetLog[]>(`/api/v1/assets/${id}/log`);

// ─── Customer parts held ─────────────────────────────────────────────────

export type HeldStatus = "HELD" | "FITTED" | "RETURNED";
export interface HeldPart {
  id: string;
  name: string;
  quantity: number;
  customerId: string | null;
  customerName: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  jobCardId: string | null;
  jobNumber: number | null;
  locationId: string | null;
  locationName: string | null;
  status: HeldStatus;
  note: string | null;
  receivedAt: string;
  closedAt: string | null;
}
export type HeldInput = { name: string; quantity?: number; customerId?: string | null; vehicleId?: string | null; jobCardId?: string | null; locationId?: string | null; note?: string | null };
export const listHeldParts = (status?: HeldStatus | "open") => get<HeldPart[]>(`/api/v1/held-parts${qs({ status })}`);
export const createHeldPart = (input: HeldInput) => send<HeldPart>("POST", "/api/v1/held-parts", input);
export const updateHeldPart = (id: string, input: Partial<HeldInput> & { status?: HeldStatus }) => send<HeldPart>("PATCH", `/api/v1/held-parts/${id}`, input);

// ─── Calls to garages (admin) ────────────────────────────────────────────

export interface GarageCallStats {
  from: string;
  to: string;
  total: number;
  uniqueCallers: number;
  garagesCalled: number;
  byGarage: { garageId: string; name: string | null; phone: string | null; address: string | null; calls: number; lastCallAt: string | null }[];
  byDay: { date: string; calls: number }[];
  recent: { id: string; garageId: string; garageName: string; userId: string; source: string; phone: string | null; createdAt: string }[];
}
/** Kaduna administrators only. Days are YYYY-MM-DD (UTC), both inclusive. */
export const getGarageCallStats = (from?: string, to?: string) => get<GarageCallStats>(`/api/v1/admin/garage-calls${qs({ from, to })}`);
