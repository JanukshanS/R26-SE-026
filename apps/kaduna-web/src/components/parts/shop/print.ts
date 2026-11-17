/**
 * Printing for the counter and the back office, each in its own window that
 * prints straight away: receipts and VAT tax invoices (sized for the shop's
 * printer: 58 mm or 80 mm thermal roll, or A4), quotations, the cash drawer's
 * end-of-day (Z) report, statements, and barcode shelf labels (Code 128).
 */
import type { Translate } from "@/lib/i18n";
import type { CashSession, Draft, Part, Sale, Shop, StoreCredit } from "@/lib/partsApi";

const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const f2 = (n: number) => n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso: string) => new Date(iso).toLocaleString("en-LK", { dateStyle: "medium", timeStyle: "short" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-LK", { dateStyle: "medium" });

type Width = Shop["receiptWidth"];

const PAGE: Record<Width, string> = {
  "58mm": "@page{size:58mm auto;margin:0}body{width:50mm;padding:3mm 4mm;font-size:11px}",
  "80mm": "@page{size:80mm auto;margin:0}body{width:72mm;padding:4mm;font-size:12px}",
  A4: "@page{size:A4;margin:14mm}body{max-width:182mm;font-size:13px}",
};

function open(title: string, body: string, width: Width) {
  const w = window.open("", "_blank", width === "A4" ? "width=900,height=1000" : "width=420,height=720");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>*{box-sizing:border-box}body{font-family:ui-monospace,Menlo,Consolas,monospace;line-height:1.4;margin:0 auto;color:#111}
h1{font-size:1.35em;margin:0}h2{font-size:1.1em;margin:.6em 0 .2em}p{margin:1px 0}table{width:100%;border-collapse:collapse;margin:8px 0}
td,th{padding:3px 0;vertical-align:top;text-align:left}th{font-size:.85em;color:#555;border-bottom:1px solid #999}.r{text-align:right}.c{text-align:center}
.t td{border-top:1px dashed #999;padding-top:6px}.big td{font-weight:700;font-size:1.15em}small,.m{color:#555;font-size:.85em}hr{border:0;border-top:1px dashed #999;margin:6px 0}
.box{border:1px solid #111;padding:4px 6px;margin:6px 0}.badge{display:inline-block;border:1.5px solid #111;padding:1px 6px;font-weight:700;letter-spacing:.06em}
${PAGE[width]}</style></head><body>${body}<script>window.onload=()=>{window.print();}</script></body></html>`);
  w.document.close();
}

function shopHead(shop: Shop, t: Translate) {
  return `<h1>${esc(shop.name)}</h1>${shop.address ? `<p>${esc(shop.address)}${shop.city ? `, ${esc(shop.city)}` : ""}</p>` : ""}${shop.phone ? `<p>${esc(shop.phone)}</p>` : ""}${
    shop.vatNumber ? `<p>${esc(t("shop.print.vatNo"))}: ${esc(shop.vatNumber)}</p>` : shop.registrationNo ? `<p>${esc(shop.registrationNo)}</p>` : ""
  }`;
}

// ─── Receipts and tax invoices ──────────────────────────────────────────────

export function printSale(shop: Shop, sale: Sale, t: Translate) {
  const cur = shop.currency;
  const rows = sale.items
    .map((i) => {
      const extra = [
        `${i.quantity} × ${f2(i.unitPrice)}${i.discount ? ` − ${f2(i.discount)}` : ""}`,
        sale.taxInvoice && i.taxRate ? `${t("shop.print.vat")} ${i.taxRate}%` : null,
        i.serialNumber ? `${t("shop.print.serial")} ${esc(i.serialNumber)}` : null,
        i.warrantyUntil ? `${t("shop.print.warrantyTo", { date: day(i.warrantyUntil) })}` : null,
      ].filter(Boolean);
      return `<tr><td>${esc(i.description)}<br><small>${extra.join(" · ")}</small></td><td class="r">${f2(i.lineTotal)}</td></tr>`;
    })
    .join("");
  const vatRows = sale.taxInvoice
    ? Object.entries(
        sale.items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.taxRate]: (m[i.taxRate] ?? 0) + i.tax }), {})
      )
        .filter(([, v]) => v > 0)
        .map(([rate, v]) => `<tr><td>${esc(t("shop.print.vat"))} ${rate}%</td><td class="r">${f2(v)}</td></tr>`)
        .join("")
    : sale.tax
      ? `<tr><td>${esc(t("shop.sale.tax"))}</td><td class="r">${f2(sale.tax)}</td></tr>`
      : "";
  const pays = sale.payments
    .map((p) => `<tr><td>${esc(t(`shop.method.${p.method}`))}${p.reference ? ` <small>${esc(p.reference)}</small>` : ""}</td><td class="r">${f2(p.amount)}</td></tr>`)
    .join("");
  const buyer = sale.taxInvoice
    ? `<div class="box"><p><b>${esc(t("shop.print.buyer"))}</b></p><p>${esc(sale.customerName)}</p>${sale.customerAddress ? `<p>${esc(sale.customerAddress)}</p>` : ""}${
        sale.customerVatNo ? `<p>${esc(t("shop.print.vatNo"))}: ${esc(sale.customerVatNo)}</p>` : ""
      }</div>`
    : `${sale.customerName ? `<p>${esc(sale.customerName)}</p>` : ""}${sale.account ? `<p>${esc(t("shop.print.onAccount", { name: sale.account.name }))}</p>` : ""}`;

  open(
    `${sale.taxInvoice ? t("shop.print.taxInvoice") : t("shop.sale.receipt")} #${sale.number}`,
    `${shopHead(shop, t)}<hr>
${sale.taxInvoice ? `<p class="c"><span class="badge">${esc(t("shop.print.taxInvoice").toUpperCase())}</span></p>` : ""}
${sale.voided ? `<p class="c"><span class="badge">${esc(t("shop.print.voided").toUpperCase())}</span></p>` : ""}
<p>${esc(sale.taxInvoice ? t("shop.print.invoiceNo") : t("shop.sale.receipt"))} #${sale.number}</p><p>${when(sale.createdAt)}</p>
${sale.cashierName ? `<p class="m">${esc(t("shop.print.servedBy", { name: sale.cashierName }))}</p>` : ""}${sale.plate ? `<p>${esc(sale.plate)}</p>` : ""}${buyer}
<table>${rows}
<tr class="t"><td>${esc(t("garage.invoice.subtotal"))}</td><td class="r">${f2(sale.subtotal)}</td></tr>
${sale.discount ? `<tr><td>${esc(t("shop.sale.discount"))}</td><td class="r">−${f2(sale.discount)}</td></tr>` : ""}
${vatRows}
<tr class="big"><td>${esc(t("garage.invoice.total"))}</td><td class="r">${cur} ${f2(sale.total)}</td></tr>
${pays}
${sale.tendered != null ? `<tr><td>${esc(t("shop.sale.tendered"))}</td><td class="r">${f2(sale.tendered)}</td></tr><tr><td>${esc(t("shop.sale.change"))}</td><td class="r">${f2(sale.change ?? 0)}</td></tr>` : ""}
</table>${sale.refunded ? `<p class="m">${esc(t("shop.sale.refunded"))}: ${f2(sale.refunded)}</p>` : ""}${shop.receiptFooter ? `<hr><p>${esc(shop.receiptFooter)}</p>` : ""}`,
    shop.receiptWidth
  );
}

export function printQuote(shop: Shop, q: Draft, t: Translate) {
  const rows = q.lines
    .map((l) => `<tr><td>${esc(l.description)}<br><small>${l.quantity} × ${f2(l.unitPrice)}${l.discount ? ` − ${f2(l.discount)}` : ""}</small></td><td class="r">${f2(l.unitPrice * l.quantity - l.discount)}</td></tr>`)
    .join("");
  open(
    `${t("shop.quote.title")} #${q.number}`,
    `${shopHead(shop, t)}<hr><p class="c"><span class="badge">${esc(t("shop.quote.title").toUpperCase())} #${q.number}</span></p>
<p>${day(q.createdAt)}${q.validUntil ? ` · ${esc(t("shop.quote.validUntil", { date: day(q.validUntil) }))}` : ""}</p>
${q.customerName ? `<p>${esc(q.customerName)}${q.customerPhone ? ` · ${esc(q.customerPhone)}` : ""}</p>` : ""}${q.plate ? `<p>${esc(q.plate)}</p>` : ""}
<table>${rows}
<tr class="t"><td>${esc(t("garage.invoice.subtotal"))}</td><td class="r">${f2(q.subtotal)}</td></tr>
${q.discount ? `<tr><td>${esc(t("shop.sale.discount"))}</td><td class="r">−${f2(q.discount)}</td></tr>` : ""}
${q.tax ? `<tr><td>${esc(t("shop.sale.tax"))}</td><td class="r">${f2(q.tax)}</td></tr>` : ""}
<tr class="big"><td>${esc(t("garage.invoice.total"))}</td><td class="r">${shop.currency} ${f2(q.total)}</td></tr></table>
${q.note ? `<p>${esc(q.note)}</p>` : ""}<p class="m">${esc(t("shop.quote.footer"))}</p>`,
    shop.receiptWidth
  );
}

/** A store credit slip: the code the customer brings back, and what it's worth. */
export function printCredit(shop: Shop, c: StoreCredit, t: Translate) {
  open(
    `${t("shop.credit.title")} ${c.code}`,
    `${shopHead(shop, t)}<hr><p class="c"><span class="badge">${esc(t("shop.credit.title").toUpperCase())}</span></p>
<p class="c" style="font-size:1.6em;font-weight:700;letter-spacing:.08em;margin:8px 0">${esc(c.code)}</p>
<div style="margin:6px auto;max-width:60mm">${code128Svg(c.code)}</div>
<table><tr class="big"><td>${esc(t("shop.credit.balance"))}</td><td class="r">${shop.currency} ${f2(c.balance)}</td></tr>
${c.customerName ? `<tr><td>${esc(t("shop.sale.customerName"))}</td><td class="r">${esc(c.customerName)}</td></tr>` : ""}
<tr><td>${esc(t("shop.print.date"))}</td><td class="r">${day(c.createdAt)}</td></tr></table>
${c.note ? `<p class="m">${esc(c.note)}</p>` : ""}<hr><p class="m">${esc(t("shop.credit.slipFooter"))}</p>`,
    shop.receiptWidth
  );
}

// ─── Cash drawer: Z report ──────────────────────────────────────────────────

export function printZReport(shop: Shop, s: CashSession, t: Translate) {
  const sum = s.summary;
  const line = (label: string, v: number, sign = "") => `<tr><td>${esc(label)}</td><td class="r">${sign}${f2(v)}</td></tr>`;
  open(
    `${t("shop.cash.zTitle")} #${s.number}`,
    `${shopHead(shop, t)}<hr><p class="c"><span class="badge">${esc(t("shop.cash.zTitle").toUpperCase())} #${s.number}</span></p>
<p>${esc(s.userName)}</p><p>${when(s.openedAt)}${s.closedAt ? ` → ${when(s.closedAt)}` : ""}</p>
${sum ? `<h2>${esc(t("shop.cash.cash"))}</h2><table>
${line(t("shop.cash.float"), sum.openingFloat)}${line(t("shop.cash.cashSales"), sum.cashSales, "+")}${sum.cashRefunds ? line(t("shop.cash.cashRefunds"), sum.cashRefunds, "−") : ""}
${sum.accountPayments ? line(t("shop.cash.accountPayments"), sum.accountPayments, "+") : ""}${sum.handovers ? line(t("shop.cash.handovers"), sum.handovers, "+") : ""}
${sum.supplierPayments ? line(t("shop.cash.supplierPayments"), sum.supplierPayments, "−") : ""}${sum.payIns ? line(t("shop.cash.payIns"), sum.payIns, "+") : ""}${sum.payOuts ? line(t("shop.cash.payOuts"), sum.payOuts, "−") : ""}
<tr class="t big"><td>${esc(t("shop.cash.expected"))}</td><td class="r">${f2(s.expectedCash ?? 0)}</td></tr>
${s.countedCash != null ? `${line(t("shop.cash.counted"), s.countedCash)}<tr class="big"><td>${esc(s.difference && s.difference < 0 ? t("shop.cash.short") : t("shop.cash.over"))}</td><td class="r">${f2(s.difference ?? 0)}</td></tr>` : ""}
</table><h2>${esc(t("shop.cash.byMethod"))}</h2><table>${sum.byMethod.map((m) => line(t(`shop.method.${m.method}`), m.total)).join("")}</table>
<table>${line(t("shop.cash.salesCount"), sum.sales).replace(".00", "")}${line(t("shop.cash.voidCount"), sum.voided).replace(".00", "")}${line(t("shop.cash.returnCount"), sum.returns).replace(".00", "")}${line(t("shop.cash.discounts"), sum.discounts)}</table>` : ""}
${s.movements.length ? `<h2>${esc(t("shop.cash.movements"))}</h2><table>${s.movements.map((m) => `<tr><td>${esc(m.reason)}<br><small>${esc(m.byName)} · ${when(m.createdAt)}</small></td><td class="r">${m.kind === "PAY_OUT" ? "−" : "+"}${f2(m.amount)}</td></tr>`).join("")}</table>` : ""}
${s.note ? `<p class="m">${esc(s.note)}</p>` : ""}<hr><p class="m">${esc(t("shop.cash.signature"))} ____________________</p>`,
    shop.receiptWidth
  );
}

// ─── Statements ─────────────────────────────────────────────────────────────

/** An account or supplier statement on A4: who, the running balance and what's late. */
export function printStatement(
  shop: Shop,
  t: Translate,
  doc: {
    title: string;
    party: { name: string; phone?: string | null; address?: string | null };
    rows: { date: string; what: string; amount: number; balance: number }[];
    balance: number;
    ageing?: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number } | null;
  }
) {
  const a = doc.ageing;
  open(
    doc.title,
    `${shopHead(shop, t)}<h2>${esc(doc.title)}</h2><p>${esc(t("shop.print.statementDate", { date: day(new Date().toISOString()) }))}</p>
<div class="box"><p><b>${esc(doc.party.name)}</b></p>${doc.party.address ? `<p>${esc(doc.party.address)}</p>` : ""}${doc.party.phone ? `<p>${esc(doc.party.phone)}</p>` : ""}</div>
<table><tr><th>${esc(t("shop.print.date"))}</th><th>${esc(t("shop.print.details"))}</th><th class="r">${esc(t("shop.print.amount"))}</th><th class="r">${esc(t("shop.print.balance"))}</th></tr>
${[...doc.rows].reverse().map((r) => `<tr><td>${day(r.date)}</td><td>${esc(r.what)}</td><td class="r">${f2(r.amount)}</td><td class="r">${f2(r.balance)}</td></tr>`).join("")}
<tr class="t big"><td></td><td>${esc(t("shop.print.balanceDue"))}</td><td></td><td class="r">${shop.currency} ${f2(doc.balance)}</td></tr></table>
${a ? `<table><tr><th class="r">${esc(t("shop.age.current"))}</th><th class="r">1–30</th><th class="r">31–60</th><th class="r">61–90</th><th class="r">90+</th></tr><tr><td class="r">${f2(a.current)}</td><td class="r">${f2(a.d1_30)}</td><td class="r">${f2(a.d31_60)}</td><td class="r">${f2(a.d61_90)}</td><td class="r">${f2(a.d90plus)}</td></tr></table>` : ""}`,
    "A4"
  );
}

// ─── Barcode labels (Code 128) ──────────────────────────────────────────────

const CODE128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

/** A Code 128 (set B) barcode as inline SVG; any scanner reads it back as the same text. */
export function code128Svg(value: string, height = 40) {
  const codes = [...value].map((c) => Math.min(95, Math.max(0, c.charCodeAt(0) - 32)));
  const check = (104 + codes.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  const seq = [104, ...codes, check, 106];
  const quiet = 10;
  let x = quiet;
  let bars = "";
  for (const v of seq) {
    [...CODE128[v]].forEach((w, i) => {
      const width = Number(w);
      if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${width}" height="${height}"/>`;
      x += width;
    });
  }
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" style="width:100%;height:${height / 4}mm" shape-rendering="crispEdges">${bars}</svg>`;
}

/** Shelf labels, 50 × 30 mm each, on A4: name, SKU, price and barcode. */
export function printLabels(shop: Shop, parts: (Pick<Part, "name" | "sku" | "barcode" | "retailPrice" | "location"> & { copies: number })[], t: Translate) {
  const one = (p: (typeof parts)[number]) =>
    `<div class="lab"><b>${esc(p.name)}</b><span class="m">${esc(p.sku)}${p.location ? ` · ${esc(p.location)}` : ""}</span><span class="price">${shop.currency} ${f2(p.retailPrice)}</span>${
      p.barcode ? `${code128Svg(p.barcode)}<span class="code">${esc(p.barcode)}</span>` : `<span class="m">${esc(t("shop.labels.noBarcode"))}</span>`
    }</div>`;
  const all = parts.flatMap((p) => Array.from({ length: Math.max(1, p.copies) }, () => one(p))).join("");
  open(
    t("shop.labels.title"),
    `<style>body{font-family:system-ui,sans-serif}.sheet{display:grid;grid-template-columns:repeat(auto-fill,50mm);gap:2mm}.lab{width:50mm;height:30mm;border:1px dashed #bbb;padding:1.5mm 2mm;overflow:hidden;display:flex;flex-direction:column;gap:.3mm;font-size:8px;break-inside:avoid}
.lab b{font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.price{font-size:11px;font-weight:700}.code{font-family:ui-monospace,monospace;font-size:7px;text-align:center;letter-spacing:.08em}</style><div class="sheet">${all}</div>`,
    "A4"
  );
}
