// The parts-management service: the spare parts shop system (inventory,
// counter sales, purchasing, trade accounts, garage orders) and the garage
// and collector sides of it. Shapes follow contracts/parts-management.openapi.yaml.
import { GarageApiError } from "./garageApi";
import { authHeaders } from "./supabase";

const BASE_URL = process.env.NEXT_PUBLIC_PARTS_URL ?? "http://localhost:3003";

export type PartOrderStatus = "REQUESTED" | "QUOTED" | "CONFIRMED" | "READY" | "COMPLETED" | "DECLINED" | "CANCELLED";
export type Fulfilment = "DELIVERY" | "PICKUP";
export type PickupBy = "MECHANIC" | "VEHICLE_OWNER";
export type PaymentTerms = "ACCOUNT" | "ON_HANDOVER";
/** Money changing hands. */
export type PaymentMethod = "CASH" | "CARD" | "BANK_TRANSFER" | "OTHER";
/** How a counter sale can be paid: money, or on an account. */
export type SaleMethod = PaymentMethod | "ACCOUNT" | "VOUCHER";
export type PurchaseStatus = "DRAFT" | "ORDERED" | "PARTLY_RECEIVED" | "RECEIVED" | "CANCELLED";
export type StockReason = "OPENING" | "PURCHASE" | "SALE" | "GARAGE_ORDER" | "RETURN" | "ADJUSTMENT" | "DAMAGED" | "STOCKTAKE" | "VOID" | "RETURN_TO_SUPPLIER" | "MOVE" | "BREAK_BULK" | "WARRANTY";
export type StaffRole = "MANAGER" | "CASHIER" | "STOREKEEPER";
export type ShopRole = "OWNER" | StaffRole;
export type Permission = "sell" | "discount" | "void" | "refund" | "catalogue" | "stock" | "cost" | "purchasing" | "accounts" | "payments" | "orders" | "reports" | "cash" | "settings" | "staff";

export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CARD", "BANK_TRANSFER", "OTHER"];
export const SALE_METHODS: SaleMethod[] = [...PAYMENT_METHODS, "ACCOUNT", "VOUCHER"];
export const STAFF_ROLES: StaffRole[] = ["MANAGER", "CASHIER", "STOREKEEPER"];
/** Still in play: not yet handed over, declined or cancelled. */
export const OPEN_ORDER_STATUSES: PartOrderStatus[] = ["REQUESTED", "QUOTED", "CONFIRMED", "READY"];
export const isOpenOrder = (s: PartOrderStatus) => OPEN_ORDER_STATUSES.includes(s);

// ─── Shapes ──────────────────────────────────────────────────────────────

export interface Shop {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  registrationNo: string | null;
  openingHours: string | null;
  delivers: boolean;
  deliveryNote: string | null;
  currency: string;
  taxRate: number;
  receiptFooter: string | null;
  vatNumber: string | null;
  receiptWidth: "58mm" | "80mm" | "A4";
  maxDiscountPct: number;
  requireCashSession: boolean;
  active: boolean;
  createdAt: string;
}
export type ShopInput = Partial<Omit<Shop, "id" | "createdAt" | "currency">>;

/** Who the caller is at the shop they run or work at. */
export interface PartsMe {
  shop: { id: string; name: string } | null;
  role: ShopRole | null;
  name: string | null;
  permissions: Permission[];
  hasPin: boolean;
}

export interface Fitment {
  id?: string;
  make: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  note: string | null;
}

export type Spec = { name: string; value: string };

export interface Part {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  oemNumber: string | null;
  partNumber: string | null;
  crossRefs: string[];
  barcode: string | null;
  /** The default location's name. */
  location: string | null;
  defaultLocationId: string;
  tags: string[];
  specs: Spec[];
  unit: string;
  /** null when the caller's role doesn't see costs. */
  costPrice: number | null;
  retailPrice: number;
  tradePrice: number | null;
  taxRate: number | null;
  warrantyMonths: number | null;
  coreCharge: number | null;
  serialized: boolean;
  /** Sold by measure: any quantity. */
  fractional: boolean;
  quickQtys: number[];
  purchaseUnit: string | null;
  purchaseFactor: number;
  breaksInto: { id: string; name: string | null; unit: string | null; stockQty: number | null; qty: number | null } | null;
  openedFrom: { id: string; sku: string; name: string; stockQty: number; qty: number | null }[];
  isKit: boolean;
  kitComponents: { partId: string; sku: string; name: string; unit: string; quantity: number; stockQty: number; costPrice: number | null; retailPrice: number }[];
  warrantyFreeMonths: number | null;
  /** Kits: how many the components make. */
  stockQty: number;
  reorderLevel: number;
  reorderQty: number;
  lowStock: boolean;
  universal: boolean;
  listed: boolean;
  active: boolean;
  supplierId: string | null;
  supplierName: string | null;
  notes: string | null;
  fitments: Fitment[];
  /** Detail only. */
  stockByLocation?: { locationId: string; name: string; qty: number; default: boolean }[];
  createdAt: string;
  updatedAt: string;
}

export interface PartFile {
  id: string;
  kind: "IMAGE" | "DOCUMENT" | "LINK";
  status: "PENDING" | "READY";
  name: string;
  url: string | null;
  contentType: string | null;
  size: number | null;
  primary: boolean;
  byName: string | null;
  createdAt: string;
}

/** A part in full, for its page. */
export type PartView = Part & {
  onOrder: number;
  files: PartFile[];
  substitutes: { note: string | null; part: Part }[];
  movements: StockMovement[];
};

export interface Location {
  id: string;
  name: string;
  note: string | null;
  active: boolean;
  parts: number;
  units: number;
  value: number | null;
  createdAt: string;
}

export interface PartTrade {
  sales: { saleId: string; number: number; createdAt: string; customerName: string | null; plate: string | null; cashierName: string | null; voided: boolean; quantity: number; returnedQty: number; unitPrice: number; discount: number; serialNumber: string | null; unitCost: number | null }[];
  orders: { orderId: string; number: number; status: PartOrderStatus; garageName: string; createdAt: string; completedAt: string | null; quantity: number; unitPrice: number | null }[];
  purchases: { purchaseId: string; number: number; status: PurchaseStatus; supplier: { id: string; name: string }; createdAt: string; receivedAt: string | null; quantity: number; receivedQty: number; unitCost: number }[];
  suppliers: { id: string; name: string; lastCost: number; bestCost: number; lastAt: string; bought: number }[];
}

export type PartInput = {
  sku: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  oemNumber?: string | null;
  partNumber?: string | null;
  crossRefs?: string[];
  barcode?: string | null;
  location?: string | null;
  defaultLocationId?: string | null;
  tags?: string[];
  specs?: Spec[];
  unit?: string;
  costPrice?: number;
  retailPrice: number;
  tradePrice?: number | null;
  reorderLevel?: number;
  reorderQty?: number;
  universal?: boolean;
  listed?: boolean;
  supplierId?: string | null;
  notes?: string | null;
  taxRate?: number | null;
  warrantyMonths?: number | null;
  coreCharge?: number | null;
  serialized?: boolean;
  fractional?: boolean;
  quickQtys?: number[];
  purchaseUnit?: string | null;
  purchaseFactor?: number;
  breaksIntoId?: string | null;
  breaksIntoQty?: number | null;
  warrantyFreeMonths?: number | null;
  openingStock?: number;
  fitments?: Omit<Fitment, "id">[];
};

export interface StockMovement {
  id: string;
  partId: string;
  quantityChange: number;
  reason: StockReason;
  unitCost: number | null;
  saleId: string | null;
  purchaseId: string | null;
  orderId: string | null;
  note: string | null;
  byName: string | null;
  locationId: string | null;
  locationName: string | null;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  paymentDays: number;
  active: boolean;
  createdAt: string;
  partCount?: number;
  openOrders?: number;
  /** What the shop owes them. */
  balance?: number;
}
export type SupplierInput = { name: string; contactName?: string | null; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null; paymentDays?: number; active?: boolean };

export interface Purchase {
  id: string;
  number: number;
  status: PurchaseStatus;
  supplier: { id: string; name: string; phone: string | null };
  expectedAt: string | null;
  note: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  items: { id: string; part: { id: string; sku: string; name: string; unit: string; stockQty: number }; quantity: number; unitCost: number; receivedQty: number; purchaseUnit: string | null; unitFactor: number; lineTotal: number }[];
  total: number;
}

export interface SaleItem {
  id: string;
  kind: "PART" | "OTHER" | "CORE";
  partId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  listPrice: number | null;
  discount: number;
  taxRate: number;
  tax: number;
  /** Before VAT and the sale discount. */
  lineTotal: number;
  returnedQty: number;
  serialNumber: string | null;
  warrantyUntil: string | null;
}
export interface Sale {
  id: string;
  number: number;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerVatNo: string | null;
  plate: string | null;
  account: { id: string; kind: AccountKind; name: string } | null;
  taxInvoice: boolean;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payments: { method: SaleMethod; amount: number; reference: string | null }[];
  paymentMethod: SaleMethod | "SPLIT";
  tendered: number | null;
  change: number | null;
  note: string | null;
  cashierName: string | null;
  approvedByName: string | null;
  voided: { at: string; by: string | null; reason: string | null } | null;
  exchangeOfId: string | null;
  returns: { id: string; number: number; total: number; fee: number; overridden: boolean; refundMethod: SaleMethod; storeCreditId: string | null; reason: string | null; byName: string | null; approvedByName: string | null; createdAt: string }[];
  refunded: number;
  createdAt: string;
}
export type SaleLineInput = {
  partId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  taxRate?: number;
  serialNumbers?: string[];
  coreReturned?: boolean;
  locationId?: string | null;
};
type CustomerFields = { customerName?: string | null; customerPhone?: string | null; customerAddress?: string | null; customerVatNo?: string | null; plate?: string | null };
export type SaleInput = CustomerFields & {
  items: SaleLineInput[];
  discount?: number;
  payments?: { method: SaleMethod; amount: number; reference?: string | null }[];
  paymentMethod?: SaleMethod;
  tendered?: number | null;
  accountId?: string | null;
  taxInvoice?: boolean;
  note?: string | null;
  draftId?: string | null;
  approvalPin?: string | null;
};

export interface StoreCredit {
  id: string;
  code: string;
  customerName: string | null;
  customerPhone: string | null;
  amount: number;
  balance: number;
  status: "ACTIVE" | "USED" | "CANCELLED";
  expiresAt: string | null;
  note: string | null;
  byName: string | null;
  entries: { id: string; kind: "ISSUE" | "REDEEM" | "RESTORE" | "CASH_OUT" | "CANCEL"; amount: number; saleId: string | null; returnId: string | null; method: SaleMethod | null; byName: string | null; createdAt: string }[];
  createdAt: string;
}
export type ExchangeResult = { original: Sale; sale: Sale; credit: StoreCredit | null; returned: number; due: number; refunded: number };

export type ClaimStatus = "OPEN" | "REPLACED" | "REFUNDED" | "REPAIRED" | "REJECTED";
export type SupplierClaimStatus = "NONE" | "PENDING" | "CREDITED" | "REPLACED" | "REJECTED";
export interface WarrantyClaim {
  id: string;
  number: number;
  part: { id: string; sku: string; name: string; serialized: boolean } | null;
  saleId: string | null;
  saleItemId: string | null;
  serialNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  fault: string;
  soldAt: string | null;
  warrantyUntil: string | null;
  covered: boolean;
  status: ClaimStatus;
  suggestedCharge: number;
  charged: number;
  replacementSaleId: string | null;
  refundReturnId: string | null;
  outcomeNote: string | null;
  supplier: { id: string | null; status: SupplierClaimStatus; credit: number | null; note: string | null; sentAt: string | null };
  createdByName: string;
  resolvedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
export interface ReturnRule {
  id?: string;
  category: string | null;
  returnable: boolean;
  days: number | null;
  feePct: number;
  note: string | null;
}

export type DraftKind = "HELD" | "QUOTE";
export interface Draft {
  id: string;
  kind: DraftKind;
  number: number | null;
  status: "OPEN" | "CONVERTED" | "CANCELLED";
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerVatNo: string | null;
  plate: string | null;
  accountId: string | null;
  note: string | null;
  items: SaleLineInput[];
  discountInput: number;
  lines: { kind: string; partId: string | null; description: string; quantity: number; unitPrice: number; discount: number; taxRate: number; tax: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  validUntil: string | null;
  createdByName: string;
  saleId: string | null;
  createdAt: string;
}
export type DraftInput = CustomerFields & { kind: DraftKind; items: SaleLineInput[]; discount?: number; accountId?: string | null; note?: string | null; validDays?: number };

export interface WarrantyHit {
  sale: { id: string; number: number; createdAt: string; customerName: string | null; customerPhone: string | null; voided: boolean };
  item: { id: string; partId: string | null; description: string; serialNumber: string | null; quantity: number; returnedQty: number };
  warrantyUntil: string | null;
  covered: boolean;
}

export interface Ageing {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  overdue: number;
  oldestOverdue: string | null;
}

export type AccountKind = "GARAGE" | "CUSTOMER";

export interface Account {
  id: string;
  kind: AccountKind;
  name: string;
  phone: string | null;
  address: string | null;
  /** GARAGE accounts: the Kaduna garage. */
  garage: { id: string | null; name: string; phone: string | null; address: string | null } | null;
  linked: boolean;
  creditLimit: number;
  paymentDays: number;
  onHold: boolean;
  balance: number;
  overdue: number;
  oldestOverdue: string | null;
  openOrders: number;
  orders: number;
  lastOrderAt: string | null;
  since: string;
}
export interface AccountEntry {
  id: string;
  kind: "CHARGE" | "PAYMENT" | "ADJUSTMENT";
  amount: number;
  method: PaymentMethod | null;
  reference: string | null;
  note: string | null;
  order: { id: string; number: number; jobNumber: number | null; plate: string | null } | null;
  sale: { id: string; number: number } | null;
  byName: string | null;
  balance: number;
  createdAt: string;
}
export type AccountDetail = Account & { ageing: Ageing; entries: AccountEntry[] };

/** The garage's view of its account at a shop. */
export interface AccountSummary {
  id: string;
  linked: boolean;
  creditLimit: number;
  paymentDays: number;
  onHold: boolean;
  balance: number;
  /** null: no orders on account right now (no credit, on hold or overdue). */
  available: number | null;
}

export interface OrderItem {
  id: string;
  partId: string | null;
  description: string;
  partNumber: string | null;
  quantity: number;
  available: boolean;
  unitPrice: number | null;
  lineTotal: number | null;
}
export type OrderVehicle = { plate: string | null; make: string | null; model: string | null; year: number | null } | null;

interface OrderBase {
  id: string;
  number: number;
  status: PartOrderStatus;
  fulfilment: Fulfilment;
  deliveryAddress: string | null;
  pickupBy: PickupBy | null;
  paymentTerms: PaymentTerms | null;
  paidAt: string | null;
  paymentMethod: PaymentMethod | null;
  note: string | null;
  sellerNote: string | null;
  job: { id: string; number: number | null; vehicle: OrderVehicle } | null;
  items: OrderItem[];
  total: number | null;
  quotedAt: string | null;
  confirmedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface GarageOrder extends OrderBase {
  shop: { id: string; name: string; phone: string | null; address: string | null; city: string | null; currency: string };
  pickupStaff: { id: string | null; name: string | null } | null;
  handoverCode: string;
  addedToJob: boolean;
}
export interface ShopOrder extends OrderBase {
  garage: { id: string; name: string; phone: string | null; address: string | null };
  accountId: string;
  collector: { kind: PickupBy; name: string | null; phone: string | null } | null;
}

export interface Pickup {
  id: string;
  number: number;
  status: "CONFIRMED" | "READY" | "COMPLETED";
  as: PickupBy;
  handoverCode: string | null;
  seller: { name: string; phone: string | null; address: string | null; city: string | null; openingHours: string | null };
  garage: { name: string; phone: string | null; address: string | null };
  job: { id: string; number: number | null; vehicle: OrderVehicle } | null;
  payOnCollection: boolean;
  items: { description: string; partNumber: string | null; quantity: number }[];
  note: string | null;
  sellerNote: string | null;
  readyAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface PublicShop {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  openingHours: string | null;
  delivers: boolean;
  deliveryNote: string | null;
  currency: string;
}
export type DirectoryShop = PublicShop & { partCount: number; account: AccountSummary | null };

export interface CataloguePart {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  oemNumber: string | null;
  partNumber: string | null;
  unit: string;
  price: number;
  retailPrice: number;
  stockQty: number;
  universal: boolean;
  fitments: Fitment[];
}

export interface PickupOptions {
  mechanics: { id: string; name: string; joined: boolean }[];
  vehicleOwner: { plate: string; registered: boolean | null } | null;
}

export type FulfilmentInput = { fulfilment: Fulfilment; deliveryAddress?: string | null; pickupBy?: PickupBy | null; pickupStaffId?: string | null };
export type GarageOrderInput = FulfilmentInput & {
  shopId: string;
  jobCardId?: string | null;
  note?: string | null;
  items: { partId?: string | null; description?: string | null; partNumber?: string | null; quantity: number }[];
};

export interface Dashboard {
  today: { sales: number; salesTotal: number; garageOrdersTotal: number };
  orders: { toPrice: number; awaitingGarage: number; toPrepare: number; ready: number };
  stock: { value: number; units: number; lines: number; lowStock: number };
  accounts: { receivable: number; overdue: number; garages: number };
  suppliers: { payable: number; overdue: number };
  drawers: { userName: string; openedAt: string }[];
  recentSales: { id: string; number: number; total: number; customerName: string | null; voided: boolean; createdAt: string }[];
  recentOrders: { id: string; number: number; status: PartOrderStatus; garageName: string; updatedAt: string }[];
}

export interface ShopReport {
  from: string;
  to: string;
  totals: { revenue: number; counter: number; trade: number; refunds: number; tax: number; cost: number; grossProfit: number; margin: number | null; sales: number; voided: number; garageOrders: number };
  days: { date: string; counter: number; trade: number; total: number }[];
  paymentMethods: { method: PaymentMethod; count: number; total: number }[];
  topParts: { partId: string; name: string; sku: string; quantity: number; revenue: number; profit: number }[];
  topGarages: { name: string; orders: number; total: number }[];
  vat: { rate: number; taxable: number; tax: number }[];
  cashiers: { name: string; sales: number; total: number; discounts: number; voids: number; refunds: number }[];
}

export interface StockReport {
  deadDays: number;
  totals: { cost: number; retail: number; lines: number; deadValue: number; deadLines: number };
  categories: { category: string | null; lines: number; units: number; cost: number; retail: number; share: number }[];
  dead: { partId: string; sku: string; name: string; location: string | null; stockQty: number; value: number; lastSoldAt: string | null }[];
}
export interface AgeingReport {
  receivables: (Ageing & { id: string; kind: AccountKind; name: string; phone: string | null; balance: number })[];
  payables: (Ageing & { id: string; name: string; phone: string | null; balance: number })[];
}

// ─── Staff, activity, cash ───────────────────────────────────────────────

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: StaffRole;
  active: boolean;
  joined: boolean;
  hasPin: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}
export interface AuditEvent {
  id: string;
  actorName: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  summary: string;
  amount: number | null;
  createdAt: string;
}
export interface CashSession {
  id: string;
  number: number;
  userName: string;
  status: "OPEN" | "CLOSED";
  openingFloat: number;
  openedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
  note: string | null;
  movements: { id: string; kind: "PAY_IN" | "PAY_OUT"; amount: number; reason: string; byName: string; createdAt: string }[];
  summary: {
    openingFloat: number;
    cashSales: number;
    cashRefunds: number;
    accountPayments: number;
    handovers: number;
    supplierPayments: number;
    payIns: number;
    payOuts: number;
    byMethod: { method: SaleMethod; total: number }[];
    sales: number;
    voided: number;
    returns: number;
    discounts: number;
  } | null;
}

// ─── Stockroom ───────────────────────────────────────────────────────────

export interface Stocktake {
  id: string;
  number: number;
  status: "OPEN" | "POSTED" | "CANCELLED";
  category: string | null;
  location: string | null;
  note: string | null;
  createdByName: string;
  postedByName: string | null;
  createdAt: string;
  postedAt: string | null;
  progress: { lines: number; counted: number; differences: number };
  varianceValue: number | null;
  lines: {
    id: string;
    part: { id: string; sku: string; name: string; brand: string | null; unit: string; barcode: string | null; stockQty: number };
    location: { id: string; name: string };
    expectedQty: number;
    countedQty: number | null;
    variance: number | null;
    varianceValue: number | null;
    countedByName: string | null;
    countedAt: string | null;
  }[];
}
export interface ImportResult {
  rows: number;
  create: number;
  update: number;
  errors: { row: number; message: string }[];
  ignoredColumns: string[];
  preview: { row: number; sku: string; name: string | null; action: "create" | "update" }[];
  applied: boolean;
}

// ─── Suppliers: what the shop owes ───────────────────────────────────────

export interface SupplierEntry {
  id: string;
  kind: "BILL" | "PAYMENT" | "RETURN" | "ADJUSTMENT";
  amount: number;
  reference: string | null;
  billDate: string | null;
  dueDate: string | null;
  purchase: { id: string; number: number | null } | null;
  method: PaymentMethod | null;
  note: string | null;
  byName: string | null;
  balance: number;
  createdAt: string;
}
export interface SupplierStatement {
  supplier: Supplier;
  balance: number;
  ageing: Ageing;
  entries: SupplierEntry[];
}
export interface SupplierReturn {
  id: string;
  number: number;
  supplier: { id: string; name: string };
  purchaseId: string | null;
  lines: { partId: string; sku: string; name: string; quantity: number; unitCost: number }[];
  total: number;
  reason: string | null;
  byName: string | null;
  createdAt: string;
}

export interface ReorderGroup {
  supplier: Supplier | null;
  lines: { part: Part; suggested: number; onOrder: number }[];
}

// ─── Transport ───────────────────────────────────────────────────────────

/** A failed call; `code` says what the screen can do about it (e.g. ask for a manager's PIN). */
export class PartsApiError extends GarageApiError {
  code: string | null;
  constructor(status: number, message: string, code: string | null, details?: { path: string; message: string }[]) {
    super(status, message, details);
    this.name = "PartsApiError";
    this.code = code;
  }
}
export const isApprovalNeeded = (e: unknown) => e instanceof PartsApiError && e.code === "APPROVAL_REQUIRED";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/v1${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GarageApiError(0, "Couldn't reach the parts service. Check your connection and try again.");
  }
  let body: { success: boolean; data?: T; error?: string; code?: string; details?: { path: string; message: string }[] } | undefined;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok || !body?.success) {
    const detail = body?.details?.[0];
    throw new PartsApiError(res.status, detail ? `${body?.error ?? "Invalid"}: ${detail.path} ${detail.message}` : body?.error ?? `HTTP ${res.status}`, body?.code ?? null, body?.details);
  }
  return body.data as T;
}

const get = <T>(path: string) => request<T>(path);
const send = <T>(method: string, path: string, body?: unknown) => request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

type OrdersQuery = { status?: PartOrderStatus; jobCardId?: string; open?: boolean };

// ─── The caller's shop ───────────────────────────────────────────────────

export const getPartsMe = () => get<PartsMe>("/me");
export const getMyShop = () => get<Shop | null>("/shop");
export const saveMyShop = (input: ShopInput) => send<Shop>("PUT", "/shop", input);
export const getShopDashboard = () => get<Dashboard>("/shop/dashboard");
export const getShopReport = (from?: string, to?: string) => get<ShopReport>(`/shop/reports${qs({ from, to })}`);
export const getStockReport = (deadDays = 90) => get<StockReport>(`/shop/reports/stock${qs({ deadDays })}`);
export const getAgeingReport = () => get<AgeingReport>("/shop/reports/ageing");
export const setMyPin = (pin: string) => send<{ hasPin: true }>("PUT", "/shop/pin", { pin });

export const listStaff = () => get<StaffMember[]>("/shop/staff");
export const addStaff = (input: { email: string; name: string; phone?: string | null; role: StaffRole }) => send<StaffMember>("POST", "/shop/staff", input);
export const updateStaff = (id: string, input: { name?: string; phone?: string | null; role?: StaffRole; active?: boolean }) => send<StaffMember>("PATCH", `/shop/staff/${id}`, input);
export const listActivity = (q: { from?: string; to?: string; action?: string; q?: string; limit?: number } = {}) => get<AuditEvent[]>(`/shop/audit${qs(q)}`);

export const getMyDrawer = () => get<CashSession | null>("/shop/cash/current");
export const listDrawers = (q: { from?: string; to?: string; status?: "OPEN" | "CLOSED" } = {}) => get<CashSession[]>(`/shop/cash/sessions${qs(q)}`);
export const getDrawer = (id: string) => get<CashSession>(`/shop/cash/sessions/${id}`);
export const openDrawer = (input: { openingFloat: number; note?: string | null }) => send<CashSession>("POST", "/shop/cash/sessions", input);
export const moveDrawerCash = (id: string, input: { kind: "PAY_IN" | "PAY_OUT"; amount: number; reason: string }) => send<CashSession>("POST", `/shop/cash/sessions/${id}/movements`, input);
export const closeDrawer = (id: string, input: { countedCash: number; note?: string | null }) => send<CashSession>("POST", `/shop/cash/sessions/${id}/close`, input);

export const listParts = (q: { q?: string; make?: string; model?: string; year?: number; category?: string; tag?: string; locationId?: string; lowStock?: boolean; includeInactive?: boolean; limit?: number; offset?: number } = {}) =>
  get<{ items: Part[]; total: number; limit: number; offset: number }>(`/shop/parts${qs(q)}`);
export const lookupPart = (code: string) => get<Part | null>(`/shop/parts/lookup${qs({ code })}`);
export const listCategories = () => get<{ category: string; parts: number }[]>("/shop/categories");
export const getPart = (id: string) => get<PartView>(`/shop/parts/${id}`);
export const getPartTrade = (id: string) => get<PartTrade>(`/shop/parts/${id}/trade`);
export const createPart = (input: PartInput) => send<PartView>("POST", "/shop/parts", input);
export const updatePart = (id: string, input: Partial<Omit<PartInput, "openingStock" | "fitments">> & { active?: boolean }) => send<PartView>("PATCH", `/shop/parts/${id}`, input);
export const replaceFitments = (id: string, fitments: Omit<Fitment, "id">[]) => send<PartView>("PUT", `/shop/parts/${id}/fitments`, { fitments });
export const adjustStock = (id: string, input: { change?: number | null; countedQty?: number | null; reason?: "ADJUSTMENT" | "DAMAGED"; note?: string | null; locationId?: string | null }) =>
  send<PartView>("POST", `/shop/parts/${id}/adjust`, input);
export const transferStock = (id: string, input: { fromLocationId: string; toLocationId: string; quantity: number; note?: string | null }) => send<PartView>("POST", `/shop/parts/${id}/transfer`, input);
export const addSubstitute = (id: string, partId: string, note?: string | null) => send<PartView>("PUT", `/shop/parts/${id}/substitutes`, { partId, note });
export const removeSubstitute = (id: string, otherId: string) => send<PartView>("DELETE", `/shop/parts/${id}/substitutes/${otherId}`);
export const addPartLink = (id: string, input: { name: string; url: string; kind?: PartFile["kind"] }) => send<PartFile>("POST", `/shop/parts/${id}/files/link`, input);
export const updatePartFile = (id: string, fileId: string, input: { name?: string; primary?: true }) => send<PartFile>("PATCH", `/shop/parts/${id}/files/${fileId}`, input);
export const removePartFile = (id: string, fileId: string) => send<{ removed: true }>("DELETE", `/shop/parts/${id}/files/${fileId}`);

/** Uploads a photo or document: asks for an upload link, sends the bytes straight to the file store, then confirms. */
export async function uploadPartFile(id: string, file: File, onProgress?: (fraction: number) => void): Promise<PartFile> {
  const contentType = file.type || "application/octet-stream";
  const { file: pending, upload } = await send<{ file: PartFile; upload: { url: string; method: "PUT"; headers: Record<string, string> } }>("POST", `/shop/parts/${id}/files/uploads`, {
    name: file.name,
    contentType,
    size: file.size,
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new GarageApiError(xhr.status, `The upload failed (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new GarageApiError(0, "The upload failed: check your connection"));
    xhr.send(file);
  });
  return send<PartFile>("POST", `/shop/parts/${id}/files/${pending.id}/complete`);
}

export const setKit = (id: string, components: { partId: string; quantity: number }[]) => send<PartView>("PUT", `/shop/parts/${id}/kit`, { components });
export const unsetKit = (id: string) => send<PartView>("DELETE", `/shop/parts/${id}/kit`);
export const openPacks = (id: string, input: { quantity: number; locationId?: string | null; intoLocationId?: string | null }) => send<PartView>("POST", `/shop/parts/${id}/open`, input);
export const listLocations = () => get<Location[]>("/shop/locations");
export const createLocation = (input: { name: string; note?: string | null }) => send<Location>("POST", "/shop/locations", input);
export const updateLocation = (id: string, input: { name?: string; note?: string | null; active?: boolean }) => send<Location>("PATCH", `/shop/locations/${id}`, input);
export const listTags = () => get<{ tag: string; parts: number }[]>("/shop/tags");
export const exportParts = () => get<{ csv: string; rows: number }>("/shop/parts/export");
export const importParts = (csv: string, dryRun: boolean) => send<ImportResult>("POST", "/shop/parts/import", { csv, dryRun });
export const assignBarcodes = (partIds?: string[]) => send<{ assigned: number }>("POST", "/shop/parts/barcodes", { partIds });

export const listStocktakes = () => get<Stocktake[]>("/shop/stocktakes");
export const startStocktake = (input: { category?: string | null; location?: string | null; locationId?: string | null; note?: string | null }) => send<Stocktake>("POST", "/shop/stocktakes", input);
export const getStocktake = (id: string) => get<Stocktake>(`/shop/stocktakes/${id}`);
export const enterCounts = (id: string, lines: { partId: string; locationId?: string | null; countedQty: number | null }[]) => send<Stocktake>("PUT", `/shop/stocktakes/${id}/lines`, { lines });
export const postStocktake = (id: string, zeroUncounted = false) => send<Stocktake>("POST", `/shop/stocktakes/${id}/post`, { zeroUncounted });
export const cancelStocktake = (id: string) => send<Stocktake>("POST", `/shop/stocktakes/${id}/cancel`);

export const listSuppliers = (q: { q?: string; includeInactive?: boolean } = {}) => get<Supplier[]>(`/shop/suppliers${qs(q)}`);
export const createSupplier = (input: SupplierInput) => send<Supplier>("POST", "/shop/suppliers", input);
export const updateSupplier = (id: string, input: Partial<SupplierInput>) => send<Supplier>("PATCH", `/shop/suppliers/${id}`, input);
export const getReorderList = () => get<ReorderGroup[]>("/shop/reorder");
export const listPurchases = (q: { status?: PurchaseStatus; supplierId?: string } = {}) => get<Purchase[]>(`/shop/purchases${qs(q)}`);
export const createPurchase = (input: { supplierId: string; expectedAt?: string | null; note?: string | null; items: { partId: string; quantity: number; unitCost?: number }[] }) => send<Purchase>("POST", "/shop/purchases", input);
export const placePurchase = (id: string) => send<Purchase>("POST", `/shop/purchases/${id}/order`);
export const receivePurchase = (
  id: string,
  items: { itemId: string; quantity: number; unitCost?: number; locationId?: string | null }[],
  more: { note?: string | null; extraCosts?: number; bill?: { reference: string; billDate?: string; dueDate?: string | null; amount?: number } | null } = {}
) => send<Purchase>("POST", `/shop/purchases/${id}/receive`, { items, ...more });
export const cancelPurchase = (id: string) => send<Purchase>("POST", `/shop/purchases/${id}/cancel`);
export const getSupplierStatement = (id: string) => get<SupplierStatement>(`/shop/suppliers/${id}/statement`);
export const addSupplierBill = (id: string, input: { reference: string; amount: number; billDate?: string; dueDate?: string | null; purchaseId?: string | null; note?: string | null }) =>
  send<SupplierStatement>("POST", `/shop/suppliers/${id}/bills`, input);
export const paySupplier = (id: string, input: { amount: number; method: PaymentMethod; reference?: string | null; note?: string | null }) => send<SupplierStatement>("POST", `/shop/suppliers/${id}/payments`, input);
export const adjustSupplier = (id: string, input: { amount: number; note: string }) => send<SupplierStatement>("POST", `/shop/suppliers/${id}/adjustments`, input);
export const listPayables = () => get<{ supplier: Supplier; balance: number; ageing: Ageing }[]>("/shop/payables");
export const listSupplierReturns = (supplierId?: string) => get<SupplierReturn[]>(`/shop/supplier-returns${qs({ supplierId })}`);
export const returnToSupplier = (input: { supplierId: string; purchaseId?: string | null; items: { partId: string; quantity: number; unitCost?: number }[]; reason?: string | null }) =>
  send<SupplierReturn>("POST", "/shop/supplier-returns", input);

export const listSales = (q: { from?: string; to?: string; q?: string; accountId?: string } = {}) => get<Sale[]>(`/shop/sales${qs(q)}`);
export const createSale = (input: SaleInput) => send<Sale>("POST", "/shop/sales", input);
export const returnSale = (
  id: string,
  input: { items: { saleItemId: string; quantity: number; restock: boolean }[]; refundMethod: SaleMethod; reason?: string | null; override?: boolean; waiveFee?: boolean; approvalPin?: string | null }
) => send<Sale>("POST", `/shop/sales/${id}/returns`, input);
export const exchangeSale = (
  id: string,
  input: {
    returnItems: { saleItemId: string; quantity: number; restock: boolean }[];
    items: SaleLineInput[];
    discount?: number;
    payments?: { method: SaleMethod; amount: number; reference?: string | null }[];
    paymentMethod?: SaleMethod;
    tendered?: number | null;
    balanceTo?: PaymentMethod | "ACCOUNT" | "VOUCHER";
    reason?: string | null;
    override?: boolean;
    waiveFee?: boolean;
    approvalPin?: string | null;
  }
) => send<ExchangeResult>("POST", `/shop/sales/${id}/exchange`, input);
export const listCredits = (q: { q?: string; status?: StoreCredit["status"] } = {}) => get<StoreCredit[]>(`/shop/credits${qs(q)}`);
export const findCredit = (code: string) => get<StoreCredit>(`/shop/credits/${encodeURIComponent(code.trim())}`);
export const cancelCredit = (id: string, note: string) => send<StoreCredit>("POST", `/shop/credits/${id}/cancel`, { note });
export const listClaims = (q: { status?: ClaimStatus; supplier?: "PENDING" } = {}) => get<WarrantyClaim[]>(`/shop/warranty/claims${qs(q)}`);
export const openClaim = (input: { saleItemId?: string | null; serialNumber?: string | null; fault: string; customerPhone?: string | null }) => send<WarrantyClaim>("POST", "/shop/warranty/claims", input);
export const resolveClaim = (
  id: string,
  input: { outcome: "REPLACE" | "REFUND" | "REPAIR" | "REJECT"; charge?: number | null; paymentMethod?: SaleMethod | null; serialNumber?: string | null; refundMethod?: SaleMethod | null; locationId?: string | null; note?: string | null; approvalPin?: string | null }
) => send<WarrantyClaim>("POST", `/shop/warranty/claims/${id}/resolve`, input);
export const claimOnSupplier = (id: string, input: { action: "SEND" | "CREDITED" | "REPLACED" | "REJECTED"; supplierId?: string | null; amount?: number | null; locationId?: string | null; note?: string | null }) =>
  send<WarrantyClaim>("POST", `/shop/warranty/claims/${id}/supplier`, input);
export const listReturnRules = () => get<ReturnRule[]>("/shop/return-rules");
export const saveReturnRules = (rules: Omit<ReturnRule, "id">[]) => send<ReturnRule[]>("PUT", "/shop/return-rules", { rules });
export const voidSale = (id: string, input: { reason: string; approvalPin?: string | null }) => send<Sale>("POST", `/shop/sales/${id}/void`, input);
export const lookupWarranty = (q: string) => get<WarrantyHit[]>(`/shop/warranty${qs({ q })}`);
export const listDrafts = (q: { kind?: DraftKind; status?: Draft["status"] } = {}) => get<Draft[]>(`/shop/drafts${qs(q)}`);
export const saveDraft = (input: DraftInput) => send<Draft>("POST", "/shop/drafts", input);
export const cancelDraft = (id: string) => send<Draft>("POST", `/shop/drafts/${id}/cancel`);

export const listAccounts = () => get<Account[]>("/shop/accounts");
export const getAccount = (id: string) => get<AccountDetail>(`/shop/accounts/${id}`);
export const updateAccount = (id: string, input: { name?: string; phone?: string | null; address?: string | null; creditLimit?: number; paymentDays?: number; onHold?: boolean }) =>
  send<AccountDetail>("PATCH", `/shop/accounts/${id}`, input);
export const createCustomerAccount = (input: { name: string; phone?: string | null; address?: string | null; creditLimit?: number; paymentDays?: number }) => send<AccountDetail>("POST", "/shop/accounts", input);
export const recordPayment = (id: string, input: { amount: number; method: PaymentMethod; reference?: string | null; note?: string | null }) => send<AccountDetail>("POST", `/shop/accounts/${id}/payments`, input);
export const recordAdjustment = (id: string, input: { amount: number; note: string }) => send<AccountDetail>("POST", `/shop/accounts/${id}/adjustments`, input);

export const listShopOrders = (q: OrdersQuery = {}) => get<ShopOrder[]>(`/shop/orders${qs(q)}`);
export const quoteShopOrder = (id: string, input: { items: { id: string; unitPrice?: number | null; available: boolean; partId?: string | null }[]; sellerNote?: string | null }) =>
  send<ShopOrder>("POST", `/shop/orders/${id}/quote`, input);
export const declineShopOrder = (id: string, sellerNote?: string | null) => send<ShopOrder>("POST", `/shop/orders/${id}/decline`, { sellerNote });
export const markShopOrderReady = (id: string) => send<ShopOrder>("POST", `/shop/orders/${id}/ready`);
export const completeShopOrder = (id: string, code: string, paymentMethod?: PaymentMethod | null) => send<ShopOrder>("POST", `/shop/orders/${id}/complete`, { code, paymentMethod });

// ─── The garage side ─────────────────────────────────────────────────────

export const listShops = (q: { q?: string; linked?: boolean } = {}) => get<DirectoryShop[]>(`/garage/shops${qs(q)}`);
export const getCatalogue = (shopId: string, q: { q?: string; jobCardId?: string } = {}) =>
  get<{ vehicle: { make: string | null; model: string | null; year: number | null } | null; parts: CataloguePart[] }>(`/garage/shops/${shopId}/catalogue${qs(q)}`);
export const linkShop = (id: string) => send<AccountSummary>("PUT", `/garage/shops/${id}/link`);
export const unlinkShop = (id: string) => send<{ linked: false }>("DELETE", `/garage/shops/${id}/link`);
export const getStatement = (shopId: string) => get<AccountSummary & { overdue: number; entries: AccountEntry[] }>(`/garage/shops/${shopId}/statement`);
export const listPartOrders = (q: OrdersQuery = {}) => get<GarageOrder[]>(`/garage/orders${qs(q)}`);
export const getPickupOptions = (jobCardId?: string) => get<PickupOptions>(`/garage/orders/pickup-options${qs({ jobCardId })}`);
export const createPartOrder = (input: GarageOrderInput) => send<GarageOrder>("POST", "/garage/orders", input);
export const acceptPartOrder = (id: string) => send<GarageOrder>("POST", `/garage/orders/${id}/accept`);
export const cancelPartOrder = (id: string) => send<GarageOrder>("POST", `/garage/orders/${id}/cancel`);
export const changePartOrderPickup = (id: string, input: FulfilmentInput) => send<GarageOrder>("PUT", `/garage/orders/${id}/pickup`, input);

// ─── Collectors ──────────────────────────────────────────────────────────

export const listMyPickups = () => get<Pickup[]>("/pickups");
