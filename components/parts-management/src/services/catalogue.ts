/**
 * The catalogue in bulk: import from a spreadsheet, export to one, and give
 * parts without a barcode one of the shop's own so they can be labelled and
 * scanned.
 *
 * Import matches rows to parts by SKU. New parts need a name and a retail
 * price; for existing parts an empty cell leaves that field as it is. Stock
 * is only set for new parts (as opening stock); changing the stock of parts
 * already on the shelf is a stocktake's job. A dry run checks every row and
 * reports what would change without saving; the real run saves all or
 * nothing.
 *
 * Fitment ("fits") is written as `Make Model years`, separated by ";":
 *   Toyota Aqua 2012-2017; Honda Fit 2014-; Suzuki Alto
 * Tags are separated by "|"; specs are `Name: value` separated by ";".
 * "location" is the part's default location (made if new); new stock goes
 * there.
 */
import { Prisma, Shop } from '@prisma/client';

import { DomainError } from '../utils/http';
import { Db } from '../utils/prisma';
import { D, takeNumber } from './shared';
import { Actor, audit } from './staff';
import { locationNamed, move, normSpecs, normTags } from './inventory';

// ─── CSV ────────────────────────────────────────────────────────────────────

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

export const COLUMNS = [
  'sku', 'name', 'brand', 'category', 'oem_number', 'part_number', 'cross_refs', 'barcode', 'location', 'unit',
  'cost_price', 'retail_price', 'trade_price', 'tax_rate', 'stock', 'reorder_level', 'reorder_qty', 'supplier',
  'universal', 'listed', 'warranty_months', 'core_charge', 'serialized', 'fits', 'notes', 'description', 'tags', 'specs',
] as const;
type Column = (typeof COLUMNS)[number];

const ALIASES: Record<string, Column> = {
  code: 'sku', item_code: 'sku', description: 'name', item: 'name', oem: 'oem_number', part_no: 'part_number', mpn: 'part_number',
  price: 'retail_price', selling_price: 'retail_price', cost: 'cost_price', qty: 'stock', quantity: 'stock', on_hand: 'stock',
  vat: 'tax_rate', bin: 'location', shelf: 'location', fitment: 'fits', vehicles: 'fits', specifications: 'specs', labels: 'tags',
};
const headerOf = (h: string): Column | null => {
  const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (COLUMNS as readonly string[]).includes(k) ? (k as Column) : ALIASES[k] ?? null;
};

// ─── Fitment text ───────────────────────────────────────────────────────────

type Fit = { make: string; model: string; yearFrom: number | null; yearTo: number | null };

export function parseFits(text: string): Fit[] {
  return text
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      let rest = x;
      let yearFrom: number | null = null;
      let yearTo: number | null = null;
      const range = rest.match(/\s+((?:19|20)\d{2})?\s*-\s*((?:19|20)\d{2})?$/);
      const single = rest.match(/\s+((?:19|20)\d{2})$/);
      if (range && (range[1] || range[2])) {
        yearFrom = range[1] ? Number(range[1]) : null;
        yearTo = range[2] ? Number(range[2]) : null;
        rest = rest.slice(0, range.index).trim();
      } else if (single) {
        yearFrom = yearTo = Number(single[1]);
        rest = rest.slice(0, single.index).trim();
      }
      const [make, ...model] = rest.split(/\s+/);
      if (!make || !model.length) throw new Error(`"${x}" needs a make and a model`);
      if (yearFrom && yearTo && yearFrom > yearTo) throw new Error(`"${x}": the years are the wrong way round`);
      return { make, model: model.join(' '), yearFrom, yearTo };
    });
}

export const fitsText = (fits: { make: string; model: string; yearFrom: number | null; yearTo: number | null }[]) =>
  fits.map((f) => `${f.make} ${f.model}${f.yearFrom || f.yearTo ? ` ${f.yearFrom === f.yearTo ? f.yearFrom : `${f.yearFrom ?? ''}-${f.yearTo ?? ''}`}` : ''}`).join('; ');

// ─── Export ─────────────────────────────────────────────────────────────────

const yn = (b: boolean) => (b ? 'yes' : 'no');

export async function exportCsv(db: Db, shopId: string, withCost: boolean) {
  const parts = await db.part.findMany({ where: { shopId, active: true }, include: { fitments: true, supplier: { select: { name: true } }, defaultLocation: { select: { name: true } } }, orderBy: { name: 'asc' } });
  const cols = COLUMNS.filter((c) => withCost || c !== 'cost_price');
  const rows = parts.map((p) => {
    const v: Record<Column, unknown> = {
      sku: p.sku, name: p.name, brand: p.brand, category: p.category, oem_number: p.oemNumber, part_number: p.partNumber, cross_refs: p.crossRefs.join('|'),
      barcode: p.barcode, location: p.defaultLocation.name, unit: p.unit, cost_price: p.costPrice.toFixed(2), retail_price: p.retailPrice.toFixed(2), trade_price: p.tradePrice?.toFixed(2),
      tax_rate: p.taxRate?.toString(), stock: p.stockQty.toString(), reorder_level: p.reorderLevel.toString(), reorder_qty: p.reorderQty.toString(), supplier: p.supplier?.name,
      universal: yn(p.universal), listed: yn(p.listed), warranty_months: p.warrantyMonths, core_charge: p.coreCharge?.toFixed(2), serialized: yn(p.serialized), fits: fitsText(p.fitments), notes: p.notes,
      description: p.description, tags: p.tags.join('|'), specs: (p.specs as { name: string; value: string }[]).map((x) => `${x.name}: ${x.value}`).join('; '),
    };
    return cols.map((c) => v[c]);
  });
  return { csv: toCsv([cols, ...rows]), rows: parts.length };
}

// ─── Import ─────────────────────────────────────────────────────────────────

const MAX_ROWS = 5000;
type RowError = { row: number; message: string };
type Planned = { row: number; sku: string; action: 'create' | 'update'; data: Record<string, unknown>; fits: Fit[] | null; stock: number | null; supplier: string | null; location: string | null };

function readRow(get: (c: Column) => string | null, isNew: boolean): { data: Record<string, unknown>; fits: Fit[] | null; stock: number | null; supplier: string | null; location: string | null } {
  const data: Record<string, unknown> = {};
  const numOf = (c: Column, opts: { int?: boolean; max?: number } = {}) => {
    const v = get(c);
    if (v == null) return undefined;
    const n = Number(v.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0 || (opts.int && !Number.isInteger(n)) || n > (opts.max ?? 99_999_999)) throw new Error(`${c} "${v}" isn't a valid number`);
    return n;
  };
  const boolOf = (c: Column) => {
    const v = get(c)?.toLowerCase();
    if (v == null) return undefined;
    if (['yes', 'y', 'true', '1'].includes(v)) return true;
    if (['no', 'n', 'false', '0'].includes(v)) return false;
    throw new Error(`${c} "${v}" should be yes or no`);
  };
  const textOf = (c: Column, max: number) => {
    const v = get(c);
    if (v != null && v.length > max) throw new Error(`${c} is longer than ${max} characters`);
    return v ?? undefined;
  };

  const name = textOf('name', 160);
  if (isNew && !name) throw new Error('A new part needs a name');
  if (name) data.name = name;
  for (const [c, f, max] of [['brand', 'brand', 80], ['category', 'category', 80], ['oem_number', 'oemNumber', 80], ['part_number', 'partNumber', 80], ['barcode', 'barcode', 80], ['unit', 'unit', 20], ['notes', 'notes', 1000], ['description', 'description', 1000]] as const) {
    const v = textOf(c, max);
    if (v !== undefined) data[f] = v;
  }
  const tagText = get('tags');
  if (tagText != null) data.tags = normTags(tagText.split(/[|,]/));
  const specText = get('specs');
  if (specText != null) {
    const specs = specText.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
      const at = x.indexOf(':');
      if (at < 1) throw new Error(`specs "${x}" should be written as Name: value`);
      return { name: x.slice(0, at).trim().slice(0, 60), value: x.slice(at + 1).trim().slice(0, 120) };
    });
    Object.assign(data, normSpecs(specs));
  }
  const refs = get('cross_refs');
  if (refs != null) data.crossRefs = [...new Set(refs.split(/[|;]/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const retail = numOf('retail_price');
  if (isNew && retail === undefined) throw new Error('A new part needs a retail_price');
  for (const [c, f] of [['retail_price', 'retailPrice'], ['cost_price', 'costPrice'], ['trade_price', 'tradePrice'], ['core_charge', 'coreCharge'], ['reorder_level', 'reorderLevel'], ['reorder_qty', 'reorderQty']] as const) {
    const v = numOf(c);
    if (v !== undefined) data[f] = D(v);
  }
  const tax = numOf('tax_rate', { max: 100 });
  if (tax !== undefined) data.taxRate = D(tax);
  const warranty = numOf('warranty_months', { int: true, max: 120 });
  if (warranty !== undefined) data.warrantyMonths = warranty || null;
  for (const [c, f] of [['universal', 'universal'], ['listed', 'listed'], ['serialized', 'serialized']] as const) {
    const v = boolOf(c);
    if (v !== undefined) data[f] = v;
  }
  const fitsRaw = get('fits');
  const stock = numOf('stock', { max: 99_999 }) ?? null;
  const location = textOf('location', 60) ?? null;
  return { data, fits: fitsRaw == null ? null : parseFits(fitsRaw), stock, supplier: get('supplier'), location };
}

export async function importCsv(db: Prisma.TransactionClient, shop: Shop, actor: Actor, csv: string, dryRun: boolean) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new DomainError(422, 'The file needs a header row and at least one part');
  const header = rows[0].map(headerOf);
  if (!header.includes('sku')) throw new DomainError(422, 'The header row needs a "sku" column');
  if (rows.length - 1 > MAX_ROWS) throw new DomainError(422, `At most ${MAX_ROWS} parts per file: split it`);
  const ignored = rows[0].filter((_, k) => header[k] === null);

  const skus = rows.slice(1).map((r) => (r[header.indexOf('sku')] ?? '').trim()).filter(Boolean);
  const existing = new Map((await db.part.findMany({ where: { shopId: shop.id, sku: { in: skus } }, select: { id: true, sku: true } })).map((p) => [p.sku, p.id]));
  const errors: RowError[] = [];
  const planned: Planned[] = [];
  const seen = new Set<string>();

  rows.slice(1).forEach((r, k) => {
    const rowNo = k + 2;
    const get = (c: Column) => {
      const i = header.indexOf(c);
      const v = i < 0 ? '' : (r[i] ?? '').trim();
      return v === '' ? null : v;
    };
    const sku = get('sku');
    if (!sku) return errors.push({ row: rowNo, message: 'No sku' });
    if (sku.length > 60) return errors.push({ row: rowNo, message: 'sku is longer than 60 characters' });
    if (seen.has(sku)) return errors.push({ row: rowNo, message: `sku ${sku} is in the file twice` });
    seen.add(sku);
    try {
      const isNew = !existing.has(sku);
      const read = readRow(get, isNew);
      planned.push({ row: rowNo, sku, action: isNew ? 'create' : 'update', ...read });
    } catch (e) {
      errors.push({ row: rowNo, message: (e as Error).message });
    }
  });

  // Barcodes must be unique in the shop.
  const codes = planned.map((p) => p.data.barcode as string | undefined).filter((x): x is string => Boolean(x));
  const taken = new Map((await db.part.findMany({ where: { shopId: shop.id, barcode: { in: codes } }, select: { sku: true, barcode: true } })).map((p) => [p.barcode!, p.sku]));
  const inFile = new Map<string, string>();
  for (const p of planned) {
    const code = p.data.barcode as string | undefined;
    if (!code) continue;
    const owner = taken.get(code);
    if ((owner && owner !== p.sku) || (inFile.has(code) && inFile.get(code) !== p.sku)) errors.push({ row: p.row, message: `Barcode ${code} is already on ${owner ?? inFile.get(code)}` });
    inFile.set(code, p.sku);
  }

  const result = {
    rows: rows.length - 1,
    create: planned.filter((p) => p.action === 'create').length,
    update: planned.filter((p) => p.action === 'update').length,
    errors: errors.sort((a, b) => a.row - b.row),
    ignoredColumns: ignored,
    preview: planned.slice(0, 20).map((p) => ({ row: p.row, sku: p.sku, name: (p.data.name as string | undefined) ?? null, action: p.action })),
    applied: false,
  };
  if (dryRun || errors.length) return result;

  const suppliers = new Map((await db.supplier.findMany({ where: { shopId: shop.id } })).map((s) => [s.name.toLowerCase(), s.id]));
  const supplierId = async (name: string | null) => {
    if (!name) return undefined;
    const known = suppliers.get(name.toLowerCase());
    if (known) return known;
    const s = await db.supplier.create({ data: { shopId: shop.id, name } });
    suppliers.set(name.toLowerCase(), s.id);
    return s.id;
  };

  for (const p of planned) {
    const sid = await supplierId(p.supplier);
    const fitments = p.fits?.map((f) => ({ ...f, note: null }));
    const loc = p.location || p.action === 'create' ? await locationNamed(db, shop.id, p.location ?? '') : null;
    if (p.action === 'create') {
      const part = await db.part.create({
        data: {
          shopId: shop.id,
          sku: p.sku,
          ...(p.data as { name: string; retailPrice: Prisma.Decimal }),
          defaultLocationId: loc!.id,
          stock: { create: { locationId: loc!.id, qty: 0 } },
          ...(sid ? { supplierId: sid } : {}),
          ...(fitments ? { fitments: { create: fitments } } : {}),
        },
      });
      if (p.stock) await move(db, part, D(p.stock), 'OPENING', { unitCost: part.costPrice, note: 'Imported', byName: actor.name });
    } else {
      const id = existing.get(p.sku)!;
      if (loc) await db.partStock.upsert({ where: { partId_locationId: { partId: id, locationId: loc.id } }, create: { partId: id, locationId: loc.id, qty: 0 }, update: {} });
      await db.part.update({ where: { id }, data: { ...p.data, ...(loc ? { defaultLocationId: loc.id } : {}), ...(sid ? { supplierId: sid } : {}) } });
      if (fitments) {
        await db.partFitment.deleteMany({ where: { partId: id } });
        await db.partFitment.createMany({ data: fitments.map((f) => ({ ...f, partId: id })) });
      }
    }
  }
  await audit(db, shop.id, actor, 'catalogue.import', `Imported a spreadsheet: ${result.create} new parts, ${result.update} updated`);
  return { ...result, applied: true };
}

// ─── Barcodes ───────────────────────────────────────────────────────────────

/** EAN-13 check digit for 12 digits. */
export function ean13(twelve: string) {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return twelve + ((10 - (sum % 10)) % 10);
}

/**
 * Gives parts without a barcode one of the shop's own: EAN-13 starting with
 * 20 (the range set aside for in-store codes), so any scanner reads it.
 */
export async function assignBarcodes(db: Prisma.TransactionClient, shop: Shop, actor: Actor, partIds: string[] | undefined) {
  const parts = await db.part.findMany({ where: { shopId: shop.id, active: true, barcode: null, ...(partIds ? { id: { in: partIds } } : {}) }, select: { id: true }, orderBy: { name: 'asc' }, take: 2000 });
  for (const p of parts) {
    for (;;) {
      const code = ean13(`20${String(await takeNumber(db, shop.id, 'barcode')).padStart(10, '0')}`);
      const clash = await db.part.findFirst({ where: { shopId: shop.id, barcode: code }, select: { id: true } });
      if (clash) continue;
      await db.part.update({ where: { id: p.id }, data: { barcode: code } });
      break;
    }
  }
  if (parts.length) await audit(db, shop.id, actor, 'catalogue.barcodes', `Gave ${parts.length} parts a shop barcode`);
  return parts.length;
}
