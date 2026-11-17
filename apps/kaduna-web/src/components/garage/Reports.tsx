"use client";

/**
 * Business reports over a date range: revenue and profit, how customers pay,
 * where jobs come from, who did the work, what sells, and how inspections
 * convert. Everything is computed by the service (GET /reports) from paid
 * invoices, so it matches the invoices to the cent. Export gives the daily
 * figures as CSV for an accountant.
 */
import { useState } from "react";
import { CalendarRange, ClipboardCheck, Download, Receipt, Timer, TrendingUp, Wallet } from "lucide-react";

import { getReport, type Garage, type PaymentMethod, type Report } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import {
  BarChart,
  Card,
  CardHeader,
  ChartEmpty,
  Donut,
  ErrorNote,
  Field,
  Kpi,
  Legend,
  Loading,
  Progress,
  Segmented,
  btnSecondary,
  inputCls,
  useLoad,
  useMoney,
  useShortMoney,
} from "./ui";

/** Validated categorical order (blue, orange, teal, violet): passes the CVD and contrast checks on white. */
export const METHOD_COLOR: Record<PaymentMethod, string> = { CASH: "#2f6feb", CARD: "#ec5500", BANK_TRANSFER: "#0f9fb0", OTHER: "#8b5cf6" };
const LABOUR = "#ec5500";
const PARTS = "#2f6feb";

type Preset = "7" | "30" | "month" | "lastMonth" | "90" | "custom";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(p: Preset): { from: string; to: string } | null {
  const today = new Date();
  const back = (n: number) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
  if (p === "7") return { from: back(6), to: iso(today) };
  if (p === "30") return { from: back(29), to: iso(today) };
  if (p === "90") return { from: back(89), to: iso(today) };
  if (p === "month") return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
  if (p === "lastMonth") return { from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: iso(new Date(today.getFullYear(), today.getMonth(), 0)) };
  return null;
}

function downloadCsv(report: Report) {
  const rows = [["date", "labour", "parts", "total_paid_incl_tax"], ...report.days.map((d) => [d.date, d.labour, d.parts, d.total])];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `garage-report-${report.from}-to-${report.to}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports({ garage }: { garage: Garage }) {
  const t = useT();
  const money = useMoney();
  const short = useShortMoney();
  const { formatDate, formatNumber } = useI18n();
  const [preset, setPreset] = useState<Preset>("30");
  const [custom, setCustom] = useState(() => rangeFor("30")!);
  const range = rangeFor(preset) ?? custom;
  const report = useLoad(() => getReport(range.from, range.to), [range.from, range.to]);
  const r = report.data;
  const cur = garage.currency;

  // A long range reads better a week per bar.
  const buckets = (() => {
    if (!r) return [];
    if (r.days.length <= 31) return r.days.map((d) => ({ label: formatDate(`${d.date}T00:00:00`, r.days.length <= 7 ? { weekday: "short" } : { day: "numeric" }), labour: d.labour, parts: d.parts }));
    const out: { label: string; labour: number; parts: number }[] = [];
    for (let i = 0; i < r.days.length; i += 7) {
      const week = r.days.slice(i, i + 7);
      out.push({ label: formatDate(`${week[0]!.date}T00:00:00`, { day: "numeric", month: "short" }), labour: week.reduce((s, d) => s + d.labour, 0), parts: week.reduce((s, d) => s + d.parts, 0) });
    }
    return out;
  })();
  const margin = r && r.totals.net > 0 ? Math.round((r.totals.grossProfit / r.totals.net) * 100) : null;
  const decided = r ? r.inspections.approved + r.inspections.declined : 0;
  const approvalRate = r && decided > 0 ? Math.round((r.inspections.approved / decided) * 100) : null;
  const topLabour = Math.max(1, ...(r?.mechanics ?? []).map((m) => m.labour));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          value={preset}
          onChange={setPreset}
          label={t("garage.rep.range")}
          options={[
            { value: "7", label: t("garage.rep.last7") },
            { value: "30", label: t("garage.rep.last30") },
            { value: "month", label: t("garage.rep.thisMonth") },
            { value: "lastMonth", label: t("garage.rep.lastMonth") },
            { value: "90", label: t("garage.rep.last90") },
            { value: "custom", label: <><CalendarRange />{t("garage.rep.custom")}</> },
          ]}
        />
        {preset === "custom" && (
          <div className="flex items-end gap-2">
            <Field label={t("garage.rep.from")}>
              <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} className={`${inputCls} py-2`} />
            </Field>
            <Field label={t("garage.rep.to")}>
              <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} className={`${inputCls} py-2`} />
            </Field>
          </div>
        )}
        <div className="flex-1" />
        <button type="button" disabled={!r} onClick={() => r && downloadCsv(r)} className={btnSecondary}>
          <Download /> {t("garage.rep.export")}
        </button>
      </div>

      {report.error ? (
        <ErrorNote message={report.error} onRetry={report.reload} />
      ) : !r ? (
        <Loading />
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-4 xl:grid-cols-4 ${report.loading ? "opacity-60" : ""}`}>
            <Kpi tone="brand" icon={Wallet} value={short(r.totals.revenue, cur)} label={t("garage.rep.revenue")} delta={t("garage.rep.taxIncluded", { tax: short(r.totals.tax, cur) })} />
            <Kpi tone="ok" icon={TrendingUp} value={short(r.totals.grossProfit, cur)} label={t("garage.rep.grossProfit")} delta={margin != null ? t("garage.rep.margin", { n: margin }) : undefined} />
            <Kpi tone="info" icon={Receipt} value={r.totals.invoices} label={t("garage.rep.invoicesPaid")} delta={r.totals.invoices ? t("garage.rep.avgTicket", { amount: short(r.totals.averageInvoice, cur) }) : undefined} />
            <Kpi
              tone="vio"
              icon={Timer}
              value={r.jobs.closed}
              label={t("garage.rep.jobsClosed")}
              delta={r.jobs.averageTurnaroundHours != null ? t("garage.rep.turnaround", { h: formatNumber(r.jobs.averageTurnaroundHours, { maximumFractionDigits: 1 }) }) : undefined}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title={t("garage.rep.revenueTitle")} sub={t("garage.rep.revenueSub", { labour: money(r.totals.labour, cur), parts: money(r.totals.parts, cur) })} />
              <ChartEmpty show={r.totals.invoices === 0} message={t("garage.rep.noRevenue")}>
                <BarChart
                  labels={buckets.map((b) => b.label)}
                  series={[
                    { name: t("garage.kind.LABOUR"), color: LABOUR, values: buckets.map((b) => b.labour) },
                    { name: t("garage.kind.PART"), color: PARTS, values: buckets.map((b) => b.parts) },
                  ]}
                  format={(n) => short(n, "")}
                  height={220}
                />
              </ChartEmpty>
              <Legend series={[{ name: t("garage.kind.LABOUR"), color: LABOUR }, { name: t("garage.kind.PART"), color: PARTS }]} />
            </Card>

            <Card>
              <CardHeader title={t("garage.inv.howPaid")} sub={t("garage.rep.byMethod")} />
              {r.paymentMethods.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("garage.rep.noRevenue")}</p>
              ) : (
                <div className="flex items-center gap-5">
                  <Donut parts={r.paymentMethods.map((m) => ({ value: m.total, color: METHOD_COLOR[m.method] }))} size={120} />
                  <ul className="min-w-0 flex-1 space-y-2 text-sm">
                    {r.paymentMethods
                      .slice()
                      .sort((a, b) => b.total - a.total)
                      .map((m) => (
                        <li key={m.method} className="flex items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: METHOD_COLOR[m.method] }} />
                          <span className="min-w-0 flex-1 truncate">{t(`garage.method.${m.method}`)}</span>
                          <span className="font-semibold tabular-nums">{Math.round((m.total / Math.max(1, r.totals.revenue)) * 100)}%</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-4 text-sm">
                <div className="rounded-xl bg-canvas px-3 py-2">
                  <p className="text-xs text-muted-foreground">{t("garage.rep.partsCost")}</p>
                  <p className="font-semibold tabular-nums">{short(r.totals.partsCost, cur)}</p>
                </div>
                <div className="rounded-xl bg-canvas px-3 py-2">
                  <p className="text-xs text-muted-foreground">{t("garage.rep.newCustomers")}</p>
                  <p className="font-semibold tabular-nums">{r.customers.new}</p>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title={t("garage.rep.jobsTitle")} sub={t("garage.rep.jobsSub", { n: r.jobs.opened })} />
              <SplitBar label={t("garage.source.walkIn")} n={r.jobs.walkIn} of={r.jobs.opened} tone="info" />
              <SplitBar label="Kaduna" n={r.jobs.kaduna} of={r.jobs.opened} tone="vio" />
              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center text-sm">
                <Mini label={t("garage.rep.bookings")} value={r.appointments.total} />
                <Mini label={t("garage.appt.status.ARRIVED")} value={r.appointments.arrived} />
                <Mini label={t("garage.appt.status.NO_SHOW")} value={r.appointments.noShow} />
              </div>
            </Card>

            <Card>
              <CardHeader title={t("garage.rep.inspTitle")} sub={approvalRate != null ? t("garage.rep.approvalRate", { n: approvalRate }) : t("garage.rep.inspSub")} />
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-ok-soft text-ok"><ClipboardCheck className="size-5" /></span>
                <div>
                  <p className="font-display text-2xl font-bold tabular-nums">{short(r.inspections.approvedValue, cur)}</p>
                  <p className="text-xs text-muted-foreground">{t("garage.rep.approvedWork")}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                <Mini label={t("garage.rep.recommended")} value={r.inspections.recommended} />
                <Mini label={t("garage.insp.approved")} value={r.inspections.approved} />
                <Mini label={t("garage.insp.declined")} value={r.inspections.declined} />
              </div>
              {r.inspections.declinedValue > 0 && <p className="mt-3 text-xs text-muted-foreground">{t("garage.rep.declinedValue", { amount: money(r.inspections.declinedValue, cur) })}</p>}
            </Card>

            <Card>
              <CardHeader title={t("garage.rep.mechTitle")} sub={t("garage.rep.mechSub")} />
              {r.mechanics.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("garage.rep.noJobs")}</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {r.mechanics.map((m) => (
                    <li key={m.mechanicId ?? "none"}>
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{m.name ?? t("garage.staff.unassigned")}</span>
                        <span className="text-xs text-muted-foreground">{t("garage.rep.jobsN", { n: m.jobsClosed })}</span>
                        <span className="w-24 text-right font-semibold tabular-nums">{short(m.labour, cur)}</span>
                      </div>
                      <Progress value={(m.labour / topLabour) * 100} className="mt-1.5" />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <TopTable title={t("garage.rep.topServices")} rows={r.topServices.map((s) => [s.description, String(s.count), money(s.revenue, cur)])} cols={[t("garage.field.description"), t("garage.rep.times"), t("garage.invoice.amount")]} empty={t("garage.rep.noRevenue")} />
            <TopTable title={t("garage.rep.topParts")} rows={r.topParts.map((p) => [p.description, formatNumber(p.quantity), money(p.revenue, cur)])} cols={[t("garage.sup.part"), t("garage.field.qty"), t("garage.invoice.amount")]} empty={t("garage.rep.noRevenue")} />
          </div>
        </>
      )}
    </div>
  );
}

function SplitBar({ label, n, of, tone }: { label: string; n: number; of: number; tone: "info" | "vio" }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">{n}</span>
      </div>
      <Progress value={of ? (n / of) * 100 : 0} tone={tone} className="mt-1.5" />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-canvas px-2 py-2">
      <p className="font-display text-lg font-bold tabular-nums">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function TopTable({ title, cols, rows, empty }: { title: string; cols: string[]; rows: string[][]; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              {cols.map((c, i) => (
                <th key={c} className={`pb-2 font-medium ${i > 0 ? "text-right" : ""}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-t border-border">
                {row.map((cell, i) => (
                  <td key={i} className={`py-2.5 ${i === 0 ? "font-medium" : "whitespace-nowrap text-right tabular-nums"} ${i === 1 ? "text-muted-foreground" : ""}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
