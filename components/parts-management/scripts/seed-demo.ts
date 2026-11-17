/**
 * Fills a shop with realistic demo data for trying the system by hand: a Sri
 * Lankan spare parts shop with stock in several locations, suppliers and
 * their bills, credit customers, a few weeks of counter sales, a closed cash
 * drawer, warranty claims, store credit, a quote and a held sale.
 *
 * Everything goes through the same service code the API uses, so stock
 * histories, ledgers and costs add up exactly as if done through the screens.
 *
 *   npx ts-node scripts/seed-demo.ts <owner email | shop id> --yes
 *
 * Local databases only: it refuses unless DATABASE_URL points at localhost
 * (pass --any-host to override). It stops if the shop already has the demo
 * parts, so running it twice does nothing.
 */
import { randomUUID } from 'node:crypto';

import { Prisma, Shop } from '@prisma/client';

import { setGarageClient } from '../src/services/garageClient';
import * as cash from '../src/services/cash';
import { ean13 } from '../src/services/catalogue';
import * as inventory from '../src/services/inventory';
import * as payables from '../src/services/payables';
import * as purchasing from '../src/services/purchasing';
import * as rules from '../src/services/rules';
import * as sales from '../src/services/sales';
import { addDays, localDay } from '../src/services/shared';
import { Actor, ROLE_PERMISSIONS, addStaff } from '../src/services/staff';
import * as trade from '../src/services/trade';
import * as warranty from '../src/services/warranty';
import { prisma } from '../src/utils/prisma';
import * as v from '../src/validation';

// No garage service is needed for any of this.
setGarageClient({
  me: async () => ({ role: null, garage: null, staff: null }),
  staff: async () => [],
  job: async () => null,
  note: async () => {},
  addParts: async () => ({ added: false }),
});

const DEMO_MARK = 'BP-AQUA-F';
const now = new Date();
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(now.getTime() - n * 86_400_000);
  d.setHours(hour, 15, 0, 0);
  return d;
};
const monthsAgo = (n: number) => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - n);
  return d;
};
const code = (seed: number) => ean13(`479${String(4100000000 + seed).slice(-9)}`);

async function backdateSale(id: string, at: Date) {
  await prisma.sale.update({ where: { id }, data: { createdAt: at } });
  await prisma.salePayment.updateMany({ where: { saleId: id }, data: { createdAt: at } });
  await prisma.stockMovement.updateMany({ where: { saleId: id }, data: { createdAt: at } });
  await prisma.accountEntry.updateMany({ where: { saleId: id }, data: { createdAt: at } });
}

async function main() {
  const args = process.argv.slice(2);
  const who = args.find((a) => !a.startsWith('--'));
  if (!who || !args.includes('--yes')) {
    console.log('Usage: npx ts-node scripts/seed-demo.ts <owner email | shop id> --yes');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !args.includes('--any-host')) {
    console.error('DATABASE_URL is not a local database: refusing (pass --any-host if you really mean it).');
    process.exit(1);
  }

  let shop: Shop | null = await prisma.shop.findUnique({ where: { id: who } }).catch(() => null);
  shop ??= await prisma.shop.findFirst({ where: { email: { equals: who, mode: 'insensitive' } } });
  if (!shop) throw new Error(`No shop with id or email ${who}`);
  if (await prisma.part.findFirst({ where: { shopId: shop.id, sku: DEMO_MARK } })) {
    console.log(`${shop.name} already has the demo data. Nothing to do.`);
    return;
  }
  const actor: Actor = { userId: shop.ownerUserId, name: shop.ownerName ?? 'Owner', role: 'OWNER', staffId: null, permissions: ROLE_PERMISSIONS.OWNER };
  // The demo sales go in as cash without anyone's drawer, except yesterday's.
  shop = await prisma.shop.update({ where: { id: shop.id }, data: { requireCashSession: false } });
  const S = shop;
  console.log(`Seeding ${S.name} (${S.id}) as ${actor.name}…`);

  // ─── Suppliers ────────────────────────────────────────────────────────────
  const sup = async (name: string, contactName: string, phone: string, paymentDays: number, address: string) =>
    purchasing.createSupplier(prisma, S.id, v.supplierInput.parse({ name, contactName, phone, paymentDays, address }));
  const lad = await sup('Lanka Auto Distributors', 'Mr. Perera', '0112 694 521', 30, '120 Panchikawatte Rd, Colombo 10');
  const jpi = await sup('Japan Parts Importers', 'Ms. Fernando', '0114 327 880', 45, '45 Baseline Rd, Colombo 9');
  const bat = await sup('Battery World (Pvt) Ltd', 'Mr. Silva', '0112 581 344', 30, '18 Kandy Rd, Kiribathgoda');
  const lub = await sup('Lubricants Lanka', 'Mr. Jayasinghe', '0112 450 777', 21, '7 Sapugaskanda Rd, Kelaniya');

  // ─── Parts ────────────────────────────────────────────────────────────────
  const part = async (data: Record<string, unknown>) => inventory.createPart(prisma, S.id, v.partInput.parse(data), actor.name);
  const aquaPrius = [{ make: 'Toyota', model: 'Aqua', yearFrom: 2012, yearTo: 2021 }, { make: 'Toyota', model: 'Prius C', yearFrom: 2012, yearTo: 2019 }];
  const hybrids = [...aquaPrius, { make: 'Toyota', model: 'Axio', note: 'hybrid' }, { make: 'Toyota', model: 'Prius', yearFrom: 2010, yearTo: 2015 }];

  const pads = await part({
    sku: 'BP-AQUA-F', name: 'Front brake pads', description: 'Front disc pads, ceramic, with wear indicator', brand: 'Bosch', category: 'Brakes',
    oemNumber: '04465-52260', partNumber: '0986AB2531', crossRefs: ['04465-52180', 'D1184'], barcode: code(1), location: 'A1-01',
    costPrice: 4200, retailPrice: 6500, tradePrice: 5800, reorderLevel: 4, reorderQty: 10, supplierId: lad.id, openingStock: 12,
    tags: ['brakes', 'fast-moving'], specs: [{ name: 'Thickness', value: '17.5 mm' }, { name: 'Wear sensor', value: 'Yes' }], fitments: aquaPrius,
  });
  const akebono = await part({
    sku: 'BP-AQUA-F-AKB', name: 'Front brake pads (Akebono)', description: 'OE-grade front pads, low dust', brand: 'Akebono', category: 'Brakes',
    oemNumber: '04465-52260', partNumber: 'AN-728WK', barcode: code(2), location: 'A1-02', costPrice: 5200, retailPrice: 7800, tradePrice: 7000,
    reorderLevel: 2, reorderQty: 6, supplierId: lad.id, openingStock: 6, tags: ['brakes'], fitments: aquaPrius,
  });
  await part({
    sku: 'BS-AXIO-R', name: 'Rear brake shoes', brand: 'Nisshinbo', category: 'Brakes', oemNumber: '04495-12220', barcode: code(3), location: 'A1-03',
    costPrice: 3100, retailPrice: 4800, tradePrice: 4300, reorderLevel: 3, reorderQty: 8, supplierId: lad.id, openingStock: 8,
    fitments: [{ make: 'Toyota', model: 'Axio', yearFrom: 2012, yearTo: 2019 }, { make: 'Toyota', model: 'Fielder', yearFrom: 2012, yearTo: 2019 }],
  });
  const oilFilter = await part({
    sku: 'OF-TOY-YZZE1', name: 'Oil filter', brand: 'Denso', category: 'Filters', oemNumber: '90915-YZZE1', crossRefs: ['90915-10001', 'C-110'], barcode: code(4),
    location: 'B1-01', costPrice: 650, retailPrice: 1100, tradePrice: 950, reorderLevel: 10, reorderQty: 30, supplierId: lad.id, openingStock: 40,
    tags: ['filters', 'fast-moving'], fitments: [{ make: 'Toyota', model: 'Aqua' }, { make: 'Toyota', model: 'Axio' }, { make: 'Toyota', model: 'Vitz' }, { make: 'Toyota', model: 'Premio' }, { make: 'Toyota', model: 'Allion' }, { make: 'Toyota', model: 'Prius' }],
  });
  const airFilter = await part({
    sku: 'AF-AQUA', name: 'Air filter', brand: 'Toyota Genuine', category: 'Filters', oemNumber: '17801-21050', barcode: code(5), location: 'B1-02',
    costPrice: 1400, retailPrice: 2400, tradePrice: 2100, reorderLevel: 4, reorderQty: 10, supplierId: lad.id, openingStock: 15, fitments: hybrids,
  });
  await part({
    sku: 'CF-AQUA', name: 'Cabin air filter', brand: 'Denso', category: 'Filters', oemNumber: '87139-52040', barcode: code(6), location: 'B1-03',
    costPrice: 900, retailPrice: 1800, reorderLevel: 4, reorderQty: 10, supplierId: lad.id, openingStock: 10, fitments: aquaPrius,
  });
  const plugs = await part({
    sku: 'SP-IRID-11', name: 'Spark plug, iridium', brand: 'Denso', category: 'Engine', oemNumber: '90919-01253', partNumber: 'SK16HR11', crossRefs: ['ILKAR7B11'],
    barcode: code(7), location: 'C1-01', costPrice: 1800, retailPrice: 2900, tradePrice: 2600, reorderLevel: 8, reorderQty: 24, supplierId: lad.id, openingStock: 32,
    tags: ['engine'], specs: [{ name: 'Gap', value: '1.1 mm' }, { name: 'Thread', value: 'M12 × 1.25' }], fitments: hybrids,
  });
  const oil = await part({
    sku: 'OIL-0W20-L', name: 'Engine oil 0W-20 (loose)', description: 'Fully synthetic, from the drum', brand: 'Toyota Genuine', category: 'Engine oil', unit: 'L',
    location: 'Oil bay', costPrice: 3200, retailPrice: 4500, tradePrice: 4200, reorderLevel: 40, reorderQty: 208, universal: true, supplierId: lub.id,
    fractional: true, quickQtys: [0.5, 1, 3.5, 4], purchaseUnit: 'drum', purchaseFactor: 208, openingStock: 160,
    tags: ['oil'], specs: [{ name: 'Viscosity', value: '0W-20' }, { name: 'Standard', value: 'API SP' }],
  });
  const oilBottle = await part({
    sku: 'OIL-0W20-4L', name: 'Engine oil 0W-20, 4 L bottle', brand: 'Toyota Genuine', category: 'Engine oil', barcode: code(8), location: 'Oil bay',
    costPrice: 12400, retailPrice: 17500, tradePrice: 16500, reorderLevel: 4, reorderQty: 12, universal: true, supplierId: lub.id, openingStock: 10,
    breaksIntoId: oil.id, breaksIntoQty: 4, tags: ['oil'],
  });
  const coolant = await part({
    sku: 'COOL-LLC-L', name: 'Coolant, long life (loose)', brand: 'Toyota Genuine', category: 'Coolant', unit: 'L', location: 'Oil bay', costPrice: 900, retailPrice: 1500,
    universal: true, supplierId: lub.id, fractional: true, quickQtys: [0.5, 1, 2], purchaseUnit: 'can (20 L)', purchaseFactor: 20, openingStock: 40,
  });
  await part({
    sku: 'BF-DOT4-500', name: 'Brake fluid DOT 4, 500 ml', brand: 'Bosch', category: 'Brakes', barcode: code(9), location: 'C2-02', costPrice: 1100, retailPrice: 1750,
    universal: true, supplierId: lub.id, openingStock: 18,
  });
  const bat55 = await part({
    sku: 'BAT-55B24L', name: 'Battery 55B24L', brand: 'Amaron', category: 'Batteries', barcode: code(10), location: 'Battery rack', costPrice: 21000, retailPrice: 27500,
    tradePrice: 26000, reorderLevel: 2, reorderQty: 4, supplierId: bat.id, warrantyMonths: 18, warrantyFreeMonths: 9, coreCharge: 2500, serialized: true, openingStock: 5,
    specs: [{ name: 'Voltage', value: '12 V' }, { name: 'Capacity', value: '45 Ah' }, { name: 'CCA', value: '430' }],
    fitments: [{ make: 'Toyota', model: 'Axio' }, { make: 'Toyota', model: 'Premio' }, { make: 'Toyota', model: 'Allion' }, { make: 'Honda', model: 'Vezel' }],
  });
  const bat46 = await part({
    sku: 'BAT-46B24L', name: 'Battery 46B24L', brand: 'Exide', category: 'Batteries', barcode: code(11), location: 'Battery rack', costPrice: 17500, retailPrice: 23000,
    reorderLevel: 2, reorderQty: 4, supplierId: bat.id, warrantyMonths: 12, warrantyFreeMonths: 6, coreCharge: 2500, serialized: true, openingStock: 4,
    fitments: [{ make: 'Toyota', model: 'Vitz' }, { make: 'Honda', model: 'Fit' }, { make: 'Suzuki', model: 'Wagon R' }],
  });
  const bulb = await part({
    sku: 'BULB-H4', name: 'Headlight bulb H4 12V 60/55W', brand: 'Philips', category: 'Electrical', barcode: code(12), location: 'D1-01', costPrice: 650, retailPrice: 1200,
    universal: true, supplierId: lad.id, purchaseUnit: 'box', purchaseFactor: 10, openingStock: 30,
  });
  await part({
    sku: 'WIPER-26', name: 'Wiper blade 26"', brand: 'Bosch Aerotwin', category: 'Wipers', barcode: code(13), location: 'D2-01', costPrice: 1700, retailPrice: 2900,
    universal: true, supplierId: lad.id, openingStock: 12, specs: [{ name: 'Length', value: '650 mm' }],
  });
  const wiper14 = await part({
    sku: 'WIPER-14', name: 'Wiper blade 14"', brand: 'Bosch Aerotwin', category: 'Wipers', barcode: code(14), location: 'D2-01', costPrice: 1100, retailPrice: 1900,
    universal: true, supplierId: lad.id, openingStock: 12, specs: [{ name: 'Length', value: '350 mm' }],
  });
  const shock = await part({
    sku: 'SHK-AXIO-F', name: 'Front shock absorber', brand: 'KYB', category: 'Suspension', oemNumber: '48510-12C40', barcode: code(15), location: 'Back store',
    costPrice: 11500, retailPrice: 16500, tradePrice: 15500, reorderLevel: 2, reorderQty: 4, supplierId: jpi.id, warrantyMonths: 6, openingStock: 4,
    fitments: [{ make: 'Toyota', model: 'Axio', yearFrom: 2012, yearTo: 2019 }, { make: 'Toyota', model: 'Fielder', yearFrom: 2012, yearTo: 2019 }],
  });
  const belt = await part({
    sku: 'BELT-4PK', name: 'Fan belt 4PK875', brand: 'Gates', category: 'Belts', barcode: code(16), location: 'C3-01', costPrice: 1300, retailPrice: 2200, supplierId: lad.id,
    openingStock: 8, fitments: [{ make: 'Suzuki', model: 'Wagon R' }, { make: 'Suzuki', model: 'Alto' }],
  });
  const washer = await part({
    sku: 'SUMP-WASH-12', name: 'Sump plug washer 12 mm', brand: 'Toyota Genuine', category: 'Engine', oemNumber: '90430-12031', location: 'B1-04', costPrice: 40, retailPrice: 120,
    universal: true, supplierId: lad.id, purchaseUnit: 'pack', purchaseFactor: 50, openingStock: 200,
  });
  await part({
    sku: 'WB-WAGONR-F', name: 'Front wheel bearing', brand: 'NSK', category: 'Suspension', barcode: code(17), location: 'Back store', costPrice: 3800, retailPrice: 6200,
    reorderLevel: 4, reorderQty: 6, supplierId: jpi.id, openingStock: 3, fitments: [{ make: 'Suzuki', model: 'Wagon R', yearFrom: 2014, yearTo: 2022 }],
  });
  const cv = await part({
    sku: 'CVJ-FIT-GP5', name: 'Outer CV joint', brand: 'GKN', category: 'Drivetrain', barcode: code(18), location: 'Back store', costPrice: 9500, retailPrice: 14500,
    reorderLevel: 3, reorderQty: 4, supplierId: jpi.id, warrantyMonths: 6, openingStock: 2, fitments: [{ make: 'Honda', model: 'Fit', note: 'GP5 hybrid' }],
  });
  const kit = await part({
    sku: 'KIT-OIL-AQUA', name: 'Oil change kit (Aqua)', description: '3.5 L 0W-20, oil filter and sump washer', category: 'Kits', costPrice: 0, retailPrice: 18500,
    fitments: aquaPrius, openingStock: 0,
  });
  await inventory.setKit(prisma, S.id, kit.id, { components: [{ partId: oil.id, quantity: 3.5 }, { partId: oilFilter.id, quantity: 1 }, { partId: washer.id, quantity: 1 }] });
  await inventory.addSubstitute(prisma, S.id, pads.id, akebono.id, 'Same fitment, OE-grade Akebono');
  // Some of the pads are kept in the back store too.
  const back = await inventory.locationNamed(prisma, S.id, 'Back store');
  await inventory.transfer(prisma, S.id, pads.id, { fromLocationId: pads.defaultLocationId, toLocationId: back.id, quantity: 4 }, actor.name);
  // A few bottles opened into the loose oil.
  await inventory.breakBulk(prisma, S.id, oilBottle.id, { quantity: 2 }, actor.name);
  console.log('  parts, locations, a kit, substitutes');

  // ─── Return rules ────────────────────────────────────────────────────────
  await rules.setRules(prisma, S.id, v.returnRulesInput.parse({
    rules: [
      { days: 14, note: 'With the receipt' },
      { category: 'Electrical', returnable: false, note: 'Not once fitted' },
      { category: 'Engine oil', days: 7, feePct: 10, note: 'Unopened only' },
    ],
  }));

  // ─── Buying: received, on order, draft; bills and payments ────────────────
  const received = await purchasing.createPurchase(prisma, S.id, v.purchaseInput.parse({
    supplierId: lad.id, note: 'Monthly order',
    items: [{ partId: pads.id, quantity: 10, unitCost: 4200 }, { partId: oilFilter.id, quantity: 20, unitCost: 650 }, { partId: plugs.id, quantity: 16, unitCost: 1750 }],
  }));
  await purchasing.placePurchase(prisma, S.id, received.id);
  await purchasing.receive(prisma, S.id, actor, received.id, v.receiveInput.parse({
    items: received.items.map((i) => ({ itemId: i.id, quantity: Number(i.quantity) })), extraCosts: 3500,
    bill: { reference: 'LAD/INV/55821', billDate: addDays(localDay(now), -20) },
  }));
  await prisma.purchaseOrder.update({ where: { id: received.id }, data: { createdAt: daysAgo(24), orderedAt: daysAgo(23), receivedAt: daysAgo(20) } });
  await prisma.stockMovement.updateMany({ where: { purchaseId: received.id }, data: { createdAt: daysAgo(20) } });

  const onOrder = await purchasing.createPurchase(prisma, S.id, v.purchaseInput.parse({
    supplierId: bat.id, expectedAt: daysAgo(-3).toISOString(),
    items: [{ partId: bat55.id, quantity: 4, unitCost: 21000 }, { partId: bat46.id, quantity: 4, unitCost: 17500 }],
  }));
  await purchasing.placePurchase(prisma, S.id, onOrder.id);
  const drum = await purchasing.createPurchase(prisma, S.id, v.purchaseInput.parse({ supplierId: lub.id, items: [{ partId: oil.id, quantity: 1, unitCost: 665600 }] }));
  await purchasing.placePurchase(prisma, S.id, drum.id);
  await purchasing.createPurchase(prisma, S.id, v.purchaseInput.parse({ supplierId: jpi.id, note: 'Check price before sending', items: [{ partId: cv.id, quantity: 3, unitCost: 9500 }, { partId: shock.id, quantity: 2, unitCost: 11500 }] }));

  // An older bill from Japan Parts Importers, half paid: now overdue.
  await payables.addBill(prisma, S.id, actor, jpi.id, v.billInput.parse({ reference: 'JPI-2291', amount: 86500, billDate: addDays(localDay(now), -70), note: 'Suspension parts' }));
  await payables.paySupplier(prisma, S.id, actor, jpi.id, v.supplierPaymentInput.parse({ amount: 40000, method: 'BANK_TRANSFER', reference: 'BOC-TT-77412' }), null);
  await payables.addBill(prisma, S.id, actor, bat.id, v.billInput.parse({ reference: 'BW/1189', amount: 42000, billDate: addDays(localDay(now), -12) }));
  console.log('  purchase orders, supplier bills and payments');

  // ─── Credit customers ─────────────────────────────────────────────────────
  const fleet = await trade.createCustomer(prisma, S.id, actor, v.customerAccountInput.parse({ name: 'Ceylon Fleet Services', phone: '0112 345 678', address: '22 Union Place, Colombo 2', creditLimit: 200000, paymentDays: 30 }));
  const tuk = await trade.createCustomer(prisma, S.id, actor, v.customerAccountInput.parse({ name: 'Kandy Three-Wheel Service', phone: '0812 233 410', address: '5 Peradeniya Rd, Kandy', creditLimit: 50000, paymentDays: 14 }));

  // ─── Counter sales over the last weeks ───────────────────────────────────
  const sell = async (at: Date, data: Record<string, unknown>) => {
    const s = await sales.createSale(prisma, S, actor, v.saleInput.parse(data));
    await backdateSale(s.id, at);
    return s;
  };
  await sell(daysAgo(40), { items: [{ partId: belt.id, quantity: 4 }, { partId: bulb.id, quantity: 4 }], paymentMethod: 'ACCOUNT', accountId: tuk.id, note: 'Three-wheelers, monthly' });
  await trade.recordPayment(prisma, S.id, actor, tuk.id, v.paymentInput.parse({ amount: 5000, method: 'CASH', reference: null, note: 'Part payment' }), null);
  await sell(daysAgo(12), { items: [{ partId: pads.id, quantity: 1 }, { partId: washer.id, quantity: 1 }], paymentMethod: 'CASH', tendered: 7000, customerName: 'Nuwan', plate: 'CAB-4521' });
  await sell(daysAgo(10, 15), { items: [{ partId: plugs.id, quantity: 4, discount: 400 }], paymentMethod: 'CARD', customerName: 'Tharindu', plate: 'KP-7712' });
  await sell(daysAgo(9), { items: [{ partId: kit.id, quantity: 2 }, { partId: (await prisma.part.findFirstOrThrow({ where: { shopId: S.id, sku: 'WIPER-26' } })).id, quantity: 2 }], paymentMethod: 'ACCOUNT', accountId: fleet.id, plate: 'CAR-1102' });
  await sell(daysAgo(7, 11), { items: [{ partId: oil.id, quantity: 3.5 }, { partId: oilFilter.id, quantity: 1 }], paymentMethod: 'CASH', tendered: 17000, customerName: 'Shanika', plate: 'CBK-3390' });
  await sell(daysAgo(6, 16), {
    items: [{ partId: bat55.id, quantity: 1, serialNumbers: ['AMR55-24117'], coreReturned: true }], customerName: 'Ruwan Jayasekara', customerPhone: '0772 145 889', plate: 'CBA-7714',
    payments: [{ method: 'CASH', amount: 15000 }, { method: 'CARD', amount: 12500, reference: 'SLIP-4471' }],
  });
  const forCredit = await sell(daysAgo(4, 12), { items: [{ partId: coolant.id, quantity: 2 }, { partId: wiper14.id, quantity: 2 }], paymentMethod: 'CASH', customerName: 'Malsha', customerPhone: '0714 552 093' });
  await sales.createReturn(prisma, S, actor, forCredit.id, v.returnInput.parse({ items: [{ saleItemId: forCredit.items.find((i) => i.partId === wiper14.id)!.id, quantity: 2, restock: true }], refundMethod: 'VOUCHER', reason: 'Wrong size: needed 16"' }));
  const voided = await sell(daysAgo(3, 9), { items: [{ partId: airFilter.id, quantity: 1 }], paymentMethod: 'CASH' });
  await sales.voidSale(prisma, S, actor, voided.id, v.voidInput.parse({ reason: 'Rang up the wrong filter' }));
  await sell(daysAgo(2, 14), { items: [{ partId: shock.id, quantity: 2 }], paymentMethod: 'BANK_TRANSFER', customerName: 'Dinesh', plate: 'CAD-2290' });
  await trade.recordPayment(prisma, S.id, actor, fleet.id, v.paymentInput.parse({ amount: 20000, method: 'BANK_TRANSFER', reference: 'HNB-118822', note: null }), null);
  console.log('  counter sales, an exchange-ready return to store credit, a void');

  // ─── Yesterday's cash drawer: counted 100 short ──────────────────────────
  const drawer = await cash.openSession(prisma, S, actor, { openingFloat: 5000, note: null });
  const y1 = await sales.createSale(prisma, S, actor, v.saleInput.parse({ items: [{ partId: oilFilter.id, quantity: 2 }, { partId: oil.id, quantity: 4 }], paymentMethod: 'CASH', tendered: 20500 }));
  const y2 = await sales.createSale(prisma, S, actor, v.saleInput.parse({ items: [{ partId: bulb.id, quantity: 2 }], paymentMethod: 'CASH' }));
  const y3 = await sales.createSale(prisma, S, actor, v.saleInput.parse({ items: [{ partId: pads.id, quantity: 1 }], paymentMethod: 'CARD', customerName: 'Kasun' }));
  await cash.addMovement(prisma, S, actor, drawer.id, { kind: 'PAY_OUT', amount: 600, reason: 'Tea and short eats' });
  const expected = (await cash.summary(prisma, await cash.getSession(prisma, S.id, drawer.id))).expected;
  await cash.closeSession(prisma, S, actor, drawer.id, { countedCash: expected.minus(100).toNumber(), note: 'Probably wrong change' });
  for (const [s, h] of [[y1, 9], [y2, 13], [y3, 16]] as const) await backdateSale(s.id, daysAgo(1, h));
  await prisma.cashSession.update({ where: { id: drawer.id }, data: { openedAt: daysAgo(1, 8), closedAt: daysAgo(1, 19) } });
  await prisma.cashMovement.updateMany({ where: { sessionId: drawer.id }, data: { createdAt: daysAgo(1, 12) } });
  console.log("  yesterday's cash drawer");

  // ─── Warranty: one open claim, one replaced and with the supplier ─────────
  const oldBattery = await sales.createSale(prisma, S, actor, v.saleInput.parse({ items: [{ partId: bat55.id, quantity: 1, serialNumbers: ['AMR55-23051'], coreReturned: true }], paymentMethod: 'CASH', customerName: 'Nimal Perera', customerPhone: '0771 234 567', plate: 'CAA-5521' }));
  const soldAt = monthsAgo(11);
  await backdateSale(oldBattery.id, soldAt);
  const until = new Date(soldAt);
  until.setMonth(until.getMonth() + 18);
  await prisma.saleItem.updateMany({ where: { saleId: oldBattery.id }, data: { warrantyUntil: until } });
  await warranty.openClaim(prisma, S, actor, v.claimInput.parse({ serialNumber: 'AMR55-23051', fault: "Won't hold charge overnight; tested 9.8 V after charging" }));

  const exide = await sales.createSale(prisma, S, actor, v.saleInput.parse({ items: [{ partId: bat46.id, quantity: 1, serialNumbers: ['EXD46-88213'], coreReturned: true }], paymentMethod: 'CARD', customerName: 'Sajith', customerPhone: '0719 887 210', plate: 'WP-KM-3381' }));
  const exideAt = monthsAgo(3);
  await backdateSale(exide.id, exideAt);
  const exUntil = new Date(exideAt);
  exUntil.setMonth(exUntil.getMonth() + 12);
  await prisma.saleItem.updateMany({ where: { saleId: exide.id }, data: { warrantyUntil: exUntil } });
  const c2 = await warranty.openClaim(prisma, S, actor, v.claimInput.parse({ serialNumber: 'EXD46-88213', fault: 'Dead cell' }));
  await warranty.resolveClaim(prisma, S, actor, c2.id, v.resolveClaimInput.parse({ outcome: 'REPLACE', serialNumber: 'EXD46-90311', note: 'Free replacement, within 6 months' }));
  await warranty.supplierClaim(prisma, S, actor, c2.id, v.supplierClaimInput.parse({ action: 'SEND', note: 'Sent with the driver' }));
  console.log('  warranty claims');

  // ─── A quotation and a held sale ─────────────────────────────────────────
  await sales.saveDraft(prisma, S, actor, v.draftInput.parse({
    kind: 'QUOTE', customerName: 'Ruwan (Premio)', customerPhone: '0773 551 200', plate: 'CAF-8812', validDays: 10,
    items: [{ partId: shock.id, quantity: 2 }, { description: 'Fitting labour', quantity: 1, unitPrice: 3500 }],
  }));
  await sales.saveDraft(prisma, S, actor, v.draftInput.parse({ kind: 'HELD', customerName: 'Customer gone to the ATM', items: [{ partId: (await prisma.part.findFirstOrThrow({ where: { shopId: S.id, sku: 'WIPER-26' } })).id, quantity: 2 }] }));

  // ─── Staff to look at (fake emails: they can't sign in) ──────────────────
  for (const [name, role] of [['Dilini Fernando', 'MANAGER'], ['Saman Kumara', 'CASHIER'], ['Kasun Silva', 'STOREKEEPER']] as const) {
    await addStaff(prisma, S, actor, { email: `${name.split(' ')[0].toLowerCase()}.${randomUUID().slice(0, 4)}@demo.kaduna.lk`, name, phone: null, role });
  }

  const credit = await prisma.storeCredit.findFirst({ where: { shopId: S.id, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
  const count = await prisma.part.count({ where: { shopId: S.id } });
  console.log(`\nDone: ${count} parts in ${S.name}.`);
  console.log(`  Store credit to try at the counter: ${credit?.code} (${credit?.balance.toFixed(2)})`);
  console.log('  Serials to look up: AMR55-23051 (open claim), EXD46-88213 (replaced), AMR55-24117 (sold last week)');
}

main()
  .catch((e) => {
    console.error(e instanceof Prisma.PrismaClientKnownRequestError ? `${e.code}: ${e.message}` : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
