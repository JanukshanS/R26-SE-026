"use client";

import { useState } from "react";
import { AlertTriangle, Ban, Building2, CheckCircle2, Clock, CreditCard, Banknote, Printer, ClipboardList, Wallet } from "lucide-react";

import {
  getInvoice,
  getJobCard,
  listInvoices,
  PAYMENT_METHODS,
  payInvoice,
  voidInvoice,
  type Garage,
  type InvoiceStatus,
  type PaymentMethod,
} from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import {
  Card,
  CardHeader,
  Donut,
  Empty,
  ErrorNote,
  InvoiceStatusBadge,
  Kpi,
  Loading,
  Panel,
  Segmented,
  Spinner,
  btnDanger,
  btnPrimary,
  btnSecondary,
  btnSm,
  useAction,
  useLoad,
  useMoney,
  useShortMoney,
  vehicleName,
} from "./ui";
import { BrandFooter, BrandHeader, brandColor } from "./InvoiceBrand";

const FILTERS: (InvoiceStatus | "ALL")[] = ["UNPAID", "PAID", "VOID", "ALL"];
// Same validated order as the reports (blue, orange, teal, violet); green is kept for "paid" status.
const METHOD_COLOR: Record<PaymentMethod, string> = { CASH: "#2f6feb", CARD: "#ec5500", BANK_TRANSFER: "#0f9fb0", OTHER: "#8b5cf6" };
const METHOD_ICON = { CARD: CreditCard, CASH: Banknote, BANK_TRANSFER: Building2, OTHER: Wallet } as const;

/* Printing shows only the invoice: everything else is hidden, and the sheet's
   own chrome (overlay, scroll, close button) is flattened onto the page. */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .garage-print, .garage-print * { visibility: visible !important; }
  .garage-print { position: fixed; inset: 0; padding: 24px; background: white; color: black; box-shadow: none !important; }
  .no-print { display: none !important; }
}`;

export default function Invoices({
  garage,
  openInvoiceId,
  onOpenInvoice,
  onOpenJob,
}: {
  garage: Garage;
  openInvoiceId: string | null;
  onOpenInvoice: (id: string | null) => void;
  onOpenJob: (id: string) => void;
}) {
  const t = useT();
  const money = useMoney();
  const short = useShortMoney();
  const { formatDate } = useI18n();
  const [filter, setFilter] = useState<InvoiceStatus | "ALL">("UNPAID");
  const list = useLoad(() => listInvoices(filter === "ALL" ? undefined : filter), [filter]);
  const stats = useLoad(async () => (await listInvoices()).items, [list.data]);

  const cur = garage.currency;
  const now = new Date();
  const all = stats.data ?? [];
  const paidMonth = all.filter((i) => i.status === "PAID" && i.paidAt && new Date(i.paidAt).getMonth() === now.getMonth() && new Date(i.paidAt).getFullYear() === now.getFullYear());
  const unpaid = all.filter((i) => i.status === "UNPAID");
  const overdue = unpaid.filter((i) => +now - +new Date(i.issuedAt) > 14 * 86_400_000);
  const byMethod = PAYMENT_METHODS.map((m) => ({ m, value: all.filter((i) => i.status === "PAID" && i.paymentMethod === m).reduce((s, i) => s + i.total, 0) }));
  const methodTotal = byMethod.reduce((s, x) => s + x.value, 0);
  const sum = (xs: typeof all) => xs.reduce((s, i) => s + i.total, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi tone="ok" icon={CheckCircle2} value={short(sum(paidMonth), cur)} label={t("garage.inv.paidMonth")} delta={t("garage.inv.count", { n: paidMonth.length })} />
          <Kpi tone="warn" icon={Clock} value={short(sum(unpaid), cur)} label={t("garage.inv.outstanding")} delta={t("garage.inv.count", { n: unpaid.length })} />
          <Kpi tone="bad" icon={AlertTriangle} value={short(sum(overdue), cur)} label={t("garage.inv.overdue")} delta={t("garage.inv.count", { n: overdue.length })} />
        </div>
        <Card>
          <CardHeader title={t("garage.inv.howPaid")} />
          <div className="flex items-center gap-5">
            <Donut parts={byMethod.map((x) => ({ value: x.value, color: METHOD_COLOR[x.m] }))} size={104} />
            <ul className="flex-1 space-y-1.5 text-[13px]">
              {byMethod.map((x) => (
                <li key={x.m} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-[3px]" style={{ background: METHOD_COLOR[x.m] }} />
                  {t(`garage.method.${x.m}`)}
                  <span className="ml-auto font-medium tabular-nums">{methodTotal ? Math.round((x.value / methodTotal) * 100) : 0}%</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f, label: f === "ALL" ? t("garage.jobs.filterAll") : `${t(`garage.invoiceStatus.${f}`)}${f === "UNPAID" && unpaid.length ? ` · ${unpaid.length}` : ""}` }))}
          />
          <div className="flex-1" />
          <a href="#settings" className={`${btnSecondary} ${btnSm}`}>{t("garage.inv.branding")}</a>
        </div>

        {list.error ? (
          <ErrorNote message={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Loading className="p-4!" />
        ) : list.data.items.length === 0 ? (
          <Empty title={t("garage.invoices.empty")} body={t("garage.invoices.emptyBody")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-3 pr-3 font-medium">{t("garage.invoices.number")}</th>
                  <th className="pb-3 pr-3 font-medium">{t("garage.invoices.job")}</th>
                  <th className="hidden pb-3 pr-3 font-medium sm:table-cell">{t("garage.invoices.issued")}</th>
                  <th className="hidden pb-3 pr-3 font-medium md:table-cell">{t("garage.invoice.method")}</th>
                  <th className="pb-3 pr-3 text-right font-medium">{t("garage.invoice.total")}</th>
                  <th className="pb-3 font-medium">{t("garage.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((inv) => {
                  const late = inv.status === "UNPAID" && +now - +new Date(inv.issuedAt) > 14 * 86_400_000;
                  return (
                    <tr key={inv.id} onClick={() => onOpenInvoice(inv.id)} className="cursor-pointer border-t border-border hover:bg-canvas/60">
                      <td className="py-3.5 pr-3 font-mono text-[13px] font-medium">
                        <button type="button" className="hover:underline" onClick={() => onOpenInvoice(inv.id)}>INV-{inv.number}</button>
                      </td>
                      <td className="py-3.5 pr-3 tabular-nums text-muted-foreground">#{inv.jobNumber}</td>
                      <td className="hidden py-3.5 pr-3 text-muted-foreground sm:table-cell">{formatDate(inv.issuedAt)}</td>
                      <td className="hidden py-3.5 pr-3 text-muted-foreground md:table-cell">{inv.paymentMethod ? t(`garage.method.${inv.paymentMethod}`) : "—"}</td>
                      <td className="py-3.5 pr-3 text-right font-semibold tabular-nums">{money(inv.total, cur)}</td>
                      <td className="py-3.5">
                        {late ? <span className="inline-flex items-center gap-1.5 rounded-full bg-bad-soft px-2.5 py-1 text-xs font-medium text-bad"><span className="size-1.5 rounded-full bg-current" />{t("garage.inv.overdueBadge")}</span> : <InvoiceStatusBadge status={inv.status} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InvoicePanel garage={garage} id={openInvoiceId} onClose={() => onOpenInvoice(null)} onChanged={list.reload} onOpenJob={onOpenJob} />
    </div>
  );
}

function InvoicePanel({
  garage,
  id,
  onClose,
  onChanged,
  onOpenJob,
}: {
  garage: Garage;
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenJob: (id: string) => void;
}) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const data = useLoad(async () => {
    if (!id) return null;
    const invoice = await getInvoice(id);
    return { invoice, job: await getJobCard(invoice.jobCardId) };
  }, [id]);
  const d = data.data && data.data.invoice.id === id ? data.data : null;

  async function act(key: string, fn: () => Promise<unknown>) {
    if (await action.run(key, fn)) {
      data.reload();
      onChanged();
    }
  }

  return (
    <Panel wide open={id !== null} onClose={onClose} title={d ? `INV-${d.invoice.number}` : t("garage.loading")} description={d ? <InvoiceStatusBadge status={d.invoice.status} /> : undefined}>
      <style>{PRINT_CSS}</style>
      {data.error ? (
        <ErrorNote message={data.error} onRetry={data.reload} />
      ) : !d ? (
        <Loading />
      ) : (
        <>
          {d.invoice.status === "UNPAID" && (
            <Card className="no-print p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t("garage.inv.amountDue")}</p>
                  <p className="font-display text-3xl font-bold tabular-nums">{money(d.invoice.total, garage.currency)}</p>
                </div>
                <button type="button" disabled={action.busy !== null} onClick={() => act("pay", () => payInvoice(d.invoice.id, method))} className={btnPrimary}>
                  {action.busy === "pay" ? <Spinner /> : <CheckCircle2 />} {t("garage.invoice.markPaid")}
                </button>
              </div>
              <p className="mb-2 mt-4 text-xs font-medium text-muted-foreground">{t("garage.invoice.method")}</p>
              <div role="radiogroup" aria-label={t("garage.invoice.method")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PAYMENT_METHODS.map((m) => {
                  const Icon = METHOD_ICON[m];
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={method === m}
                      onClick={() => setMethod(m)}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-medium ${method === m ? "border-primary bg-brand-soft text-primary" : "border-border bg-white text-muted-foreground"}`}
                    >
                      <Icon className="size-4" />
                      {t(`garage.method.${m}`)}
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          <article className="garage-print overflow-hidden rounded-[20px] bg-white text-sm shadow-[0_4px_20px_rgba(41,31,24,.04)]">
            <div className="h-2" style={{ background: brandColor(garage) }} />
            <div className="space-y-6 p-6 sm:p-8">
              <BrandHeader brand={garage}>
                  <p className="font-display text-2xl font-bold uppercase" style={{ color: brandColor(garage) }}>{t("garage.invoice.heading")}</p>
                  <p className="font-mono tabular-nums">INV-{d.invoice.number}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(d.invoice.issuedAt)}</p>
                  {d.invoice.status !== "UNPAID" && <p className="mt-1 text-xs font-semibold uppercase">{t(`garage.invoiceStatus.${d.invoice.status}`)}</p>}
              </BrandHeader>

              <div className="grid gap-4 rounded-2xl bg-canvas p-4 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("garage.invoice.billTo")}</p>
                  <p className="mt-1 font-semibold">{d.job.customer?.name ?? "—"}</p>
                  {d.job.customer?.phone && <p className="text-xs text-muted-foreground">{d.job.customer.phone}</p>}
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("garage.col.vehicle")}</p>
                  <p className="mt-1 font-semibold">{vehicleName(d.job.vehicle, "—")}</p>
                  <p className="font-mono text-xs text-muted-foreground">{d.job.vehicle?.plate ?? ""}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("garage.inv.jobRef")}</p>
                  <p className="mt-1 font-semibold">{t("garage.job.title", { n: d.job.number })}</p>
                  {d.job.source === "KADUNA_DISPATCH" && <p className="text-xs text-muted-foreground">Kaduna</p>}
                </div>
              </div>

              <table className="w-full">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">{t("garage.field.description")}</th>
                    <th className="pb-2 text-right font-medium">{t("garage.field.qty")}</th>
                    <th className="whitespace-nowrap pb-2 pl-3 text-right font-medium">{t("garage.field.unitPrice")}</th>
                    <th className="pb-2 pl-3 text-right font-medium">{t("garage.invoice.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.invoice.lines.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-2.5 pr-2">
                        <p className="font-medium">{l.description}</p>
                        <p className="text-xs text-muted-foreground">{t(`garage.kind.${l.kind}`)}</p>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pl-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="whitespace-nowrap py-2.5 pl-3 text-right tabular-nums">{money(l.unitPrice, garage.currency)}</td>
                      <td className="whitespace-nowrap py-2.5 pl-3 text-right tabular-nums">{money(l.lineTotal, garage.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="ml-auto w-full max-w-[300px] space-y-2 tabular-nums">
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("garage.invoice.subtotal")}</span>
                  <span>{money(d.invoice.subtotal, garage.currency)}</span>
                </div>
                {d.invoice.tax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("garage.invoice.tax")}</span>
                    <span>{money(d.invoice.tax, garage.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t-2 border-foreground pt-2.5 font-display text-xl font-bold">
                  <span>{t("garage.invoice.total")}</span>
                  <span>{money(d.invoice.total, garage.currency)}</span>
                </div>
              </div>

              {d.invoice.paidAt && d.invoice.paymentMethod && (
                <p className="rounded-xl bg-ok-soft px-4 py-2.5 text-ok">
                  {t("garage.invoice.paidOn", { date: formatDate(d.invoice.paidAt), method: t(`garage.method.${d.invoice.paymentMethod}`) })}
                </p>
              )}
              <BrandFooter brand={garage} />
            </div>
          </article>

          {action.error && <ErrorNote message={action.error} />}

          <div className="no-print flex flex-wrap gap-2">
            <button type="button" onClick={() => window.print()} className={`${btnSecondary} ${btnSm}`}>
              <Printer /> {t("garage.invoice.print")}
            </button>
            <button type="button" onClick={() => onOpenJob(d.job.id)} className={`${btnSecondary} ${btnSm}`}>
              <ClipboardList /> {t("garage.invoice.openJob")}
            </button>
            {d.invoice.status === "UNPAID" && (
              <button
                type="button"
                disabled={action.busy !== null}
                onClick={() => {
                  if (window.confirm(t("garage.invoice.confirmVoid"))) act("void", () => voidInvoice(d.invoice.id));
                }}
                className={`${btnDanger} ${btnSm} ml-auto`}
              >
                {action.busy === "void" ? <Spinner /> : <Ban />} {t("garage.invoice.void")}
              </button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
