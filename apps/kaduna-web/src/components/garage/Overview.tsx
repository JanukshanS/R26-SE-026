"use client";

import { Banknote, ChevronRight, ClipboardList, PackageCheck, Siren, Truck } from "lucide-react";

import { enumLabel, listAssignedIncidents } from "@/lib/dispatchApi";
import { getDashboard, isFinished, JOB_STATUSES, listInvoices, listJobCards, type Garage, type JobCardSummary } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import type { GarageTab } from "./GarageShell";
import {
  Avatar,
  BarChart,
  Badge,
  Card,
  CardHeader,
  ChartEmpty,
  Empty,
  ErrorNote,
  JOB_PROGRESS,
  JOB_TONE,
  JobStatusBadge,
  Kpi,
  Legend,
  LineChart,
  Loading,
  Progress,
  SourceBadge,
  btnGhost,
  btnSecondary,
  btnSm,
  toneFor,
  useLoad,
  useShortMoney,
  vehicleName,
} from "./ui";

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export default function Overview({
  garage,
  providerId,
  kadunaOffers,
  onOpenJob,
  onGo,
}: {
  garage: Garage;
  providerId: string;
  kadunaOffers: number;
  onOpenJob: (id: string) => void;
  onGo: (tab: GarageTab) => void;
}) {
  const t = useT();
  const { formatDate } = useI18n();
  const short = useShortMoney();
  const board = useLoad(getDashboard, []);
  const jobs = useLoad(async () => (await listJobCards({ limit: 200 })).items, []);
  const paid = useLoad(async () => (await listInvoices("PAID")).items, []);
  const kaduna = useLoad(async () => {
    const [offers, onScene] = await Promise.all([
      listAssignedIncidents(providerId, { status: "PROVIDER_ASSIGNED", limit: 5 }),
      listAssignedIncidents(providerId, { status: "ON_SCENE", limit: 5 }),
    ]);
    return { offers: offers.incidents, onScene: onScene.incidents };
  }, [providerId, kadunaOffers]);

  if (board.error) return <ErrorNote message={board.error} onRetry={board.reload} />;
  if (!board.data) return <Loading />;
  const d = board.data;
  const cur = garage.currency;

  // Revenue for the last 7 days, split into labour and parts from paid invoice lines.
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => new Date(+today - (6 - i) * DAY));
  const labour = days.map(() => 0);
  const parts = days.map(() => 0);
  for (const inv of paid.data ?? []) {
    if (!inv.paidAt) continue;
    const idx = Math.floor((+startOfDay(new Date(inv.paidAt)) - +days[0]!) / DAY);
    if (idx < 0 || idx > 6) continue;
    for (const l of inv.lines) (l.kind === "LABOUR" ? labour : parts)[idx]! += l.lineTotal;
  }

  // Jobs opened per week for the last 8 weeks, by source.
  const weeks = Array.from({ length: 8 }, (_, i) => new Date(+today - (7 - i) * 7 * DAY));
  const walkIn = weeks.map(() => 0);
  const fromKaduna = weeks.map(() => 0);
  for (const j of jobs.data ?? []) {
    const idx = 7 - Math.floor((+today + DAY - +new Date(j.createdAt)) / (7 * DAY));
    if (idx < 0 || idx > 7) continue;
    (j.source === "KADUNA_DISPATCH" ? fromKaduna : walkIn)[idx]! += 1;
  }

  const active = (jobs.data ?? [])
    .filter((j) => !isFinished(j.status))
    .sort((a, b) => +new Date(a.promisedAt ?? a.createdAt) - +new Date(b.promisedAt ?? b.createdAt))
    .slice(0, 5);
  const ready = d.jobsByStatus.READY ?? 0;
  const statusMax = Math.max(1, ...JOB_STATUSES.map((s) => d.jobsByStatus[s] ?? 0));

  return (
    <div className="space-y-6">
      {/* Row 1 */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <CardHeader title={t("garage.dash.today")} sub={`${formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" })} · ${garage.name}`} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi tone="brand" icon={Banknote} value={short(d.revenueThisMonth, cur)} label={t("garage.overview.revenueMonth")} delta={t("garage.dash.unpaid", { amount: short(d.unpaidTotal, cur) })} />
            <Kpi tone="info" icon={ClipboardList} value={d.openJobs} label={t("garage.overview.openJobs")} delta={t("garage.dash.dueToday", { n: d.jobsDueToday })} />
            <Kpi tone="bad" icon={Siren} value={kadunaOffers} label={t("garage.dash.kadunaRequests")} delta={t("garage.dash.onScene", { n: kaduna.data?.onScene.length ?? 0 })} />
            <Kpi tone="ok" icon={PackageCheck} value={ready} label={t("garage.dash.readyPickup")} delta={t("garage.dash.lowStock", { n: d.lowStockParts.length })} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("garage.dash.bySource")} action={<Badge tone="gray" dot={false}>{t("garage.dash.last8Weeks")}</Badge>} />
          {jobs.error ? (
            <ErrorNote message={jobs.error} onRetry={jobs.reload} />
          ) : (
            <>
              <ChartEmpty show={!!jobs.data && walkIn.every((v) => !v) && fromKaduna.every((v) => !v)} message={t("garage.dash.noJobsYet")}>
                <LineChart
                  labels={weeks.map((w) => formatDate(w, { day: "numeric", month: "short" }))}
                  series={[
                    { name: t("garage.source.walkIn"), color: "#ec5500", values: walkIn },
                    { name: "Kaduna", color: "#8b5cf6", values: fromKaduna },
                  ]}
                />
              </ChartEmpty>
              <Legend series={[{ name: t("garage.source.walkIn"), color: "#ec5500" }, { name: "Kaduna", color: "#8b5cf6" }]} />
            </>
          )}
        </Card>
      </div>

      {/* Row 2 */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px_320px]">
        <Card>
          <CardHeader title={t("garage.dash.weeklyRevenue")} sub={t("garage.dash.weeklyRevenueSub", { currency: cur })} />
          {paid.error ? (
            <ErrorNote message={paid.error} onRetry={paid.reload} />
          ) : (
            <>
              <ChartEmpty show={!!paid.data && labour.every((v) => !v) && parts.every((v) => !v)} message={t("garage.dash.noPaidYet")}>
                <BarChart
                  labels={days.map((dd) => formatDate(dd, { weekday: "short" }))}
                  series={[
                    { name: t("garage.kind.LABOUR"), color: "#ec5500", values: labour },
                    { name: t("garage.kind.PART"), color: "#2f6feb", values: parts },
                  ]}
                  format={(n) => short(n, "").trim()}
                />
              </ChartEmpty>
              <Legend series={[{ name: t("garage.kind.LABOUR"), color: "#ec5500" }, { name: t("garage.kind.PART"), color: "#2f6feb" }]} />
            </>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t("garage.overview.byStatus")}
            action={<button type="button" onClick={() => onGo("jobs")} className={`${btnGhost} ${btnSm}`}>{t("garage.overview.seeJobs")}<ChevronRight /></button>}
          />
          <ul className="space-y-3.5">
            {JOB_STATUSES.filter((s) => s !== "CANCELLED").map((s) => (
              <li key={s}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <JobStatusBadge status={s} />
                  <span className="font-semibold tabular-nums">{d.jobsByStatus[s] ?? 0}</span>
                </div>
                <Progress value={((d.jobsByStatus[s] ?? 0) / statusMax) * 100} tone={JOB_TONE[s]} />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title={t("garage.overview.lowStock")}
            action={<button type="button" onClick={() => onGo("inventory")} className={`${btnGhost} ${btnSm}`}>{t("garage.overview.seeInventory")}<ChevronRight /></button>}
          />
          {d.lowStockParts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("garage.overview.lowStockNone")}</p>
          ) : (
            <ul className="space-y-4">
              {d.lowStockParts.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <div className="mb-1.5 flex justify-between gap-2 text-xs font-medium">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 tabular-nums text-bad">
                      {p.stockQty}/{p.reorderLevel}
                    </span>
                  </div>
                  <Progress value={p.reorderLevel ? (p.stockQty / p.reorderLevel) * 100 : 0} tone={p.stockQty <= 0 ? "bad" : "warn"} className="bg-bad-soft" />
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => onGo("inventory")} className={`${btnSecondary} ${btnSm} mt-5 w-full`}>
            <Truck />
            {t("garage.dash.restock")}
          </button>
        </Card>
      </div>

      {/* Row 3 */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title={t("garage.dash.liveBoard")}
            action={<button type="button" onClick={() => onGo("jobs")} className={`${btnGhost} ${btnSm}`}>{t("garage.overview.seeJobs")}<ChevronRight /></button>}
          />
          {jobs.error ? (
            <ErrorNote message={jobs.error} onRetry={jobs.reload} />
          ) : !jobs.data ? (
            <Loading className="p-4!" />
          ) : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("garage.dash.noActive")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2.5 pr-3 font-medium">{t("garage.dash.colJob")}</th>
                    <th className="pb-2.5 pr-3 font-medium">{t("garage.col.vehicle")}</th>
                    <th className="hidden pb-2.5 pr-3 font-medium sm:table-cell">{t("garage.col.customer")}</th>
                    <th className="hidden pb-2.5 pr-3 font-medium md:table-cell">{t("garage.dash.colProgress")}</th>
                    <th className="pb-2.5 font-medium">{t("garage.col.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((j) => (
                    <LiveRow key={j.id} job={j} onOpen={() => onOpenJob(j.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={t("garage.kaduna.title")} action={kadunaOffers > 0 ? <Badge tone="bad">{t("garage.dash.live")}</Badge> : undefined} />
          {kaduna.error ? (
            <ErrorNote message={kaduna.error} onRetry={kaduna.reload} />
          ) : !kaduna.data ? (
            <Loading className="p-4!" />
          ) : kaduna.data.offers.length + kaduna.data.onScene.length === 0 ? (
            <Empty title={t("garage.dash.kadunaQuiet")} body={t("garage.dash.kadunaQuietBody")} />
          ) : (
            <ul className="divide-y divide-border">
              {[...kaduna.data.offers, ...kaduna.data.onScene].slice(0, 4).map((i) => {
                const service = i.triageResponse?.predictedServiceType;
                const vehicle = [i.vehicleMake, i.vehicleModel].filter(Boolean).join(" ");
                return (
                  <li key={i.id} className="flex items-center gap-3 py-3">
                    <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${i.status === "PROVIDER_ASSIGNED" ? "bg-bad-soft text-bad" : "bg-brand-soft text-primary"}`}>
                      <Siren className="size-5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {service ? enumLabel(service) : t("garage.kaduna.defaultService")}
                        {vehicle && ` · ${vehicle}`}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {i.registrationNo ?? t("garage.vehicle.unknown")} · {enumLabel(i.status)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" onClick={() => onGo("kaduna")} className={`${btnSecondary} ${btnSm} mt-4 w-full`}>
            {t("garage.dash.openKaduna")}
            <ChevronRight />
          </button>
        </Card>
      </div>
    </div>
  );
}

function LiveRow({ job: j, onOpen }: { job: JobCardSummary; onOpen: () => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const overdue = j.promisedAt && new Date(j.promisedAt) < new Date();
  return (
    <tr onClick={onOpen} className="cursor-pointer border-t border-border hover:bg-canvas/60">
      <td className="py-3 pr-3 font-mono text-[13px] text-muted-foreground">#{j.number}</td>
      <td className="py-3 pr-3">
        <div className="flex items-center gap-2 font-medium">
          {vehicleName(j.vehicle, t("garage.vehicle.unknown"))}
          {j.source === "KADUNA_DISPATCH" && <SourceBadge source={j.source} />}
        </div>
        <div className="text-xs text-muted-foreground">
          {[j.vehicle?.plate, j.customer?.name].filter(Boolean).join(" · ") || "—"}
          {j.promisedAt && (
            <span className={overdue ? " font-medium text-bad" : ""}> · {formatDate(j.promisedAt, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</span>
          )}
        </div>
      </td>
      <td className="hidden py-3 pr-3 sm:table-cell">{j.customer ? <Avatar name={j.customer.name} tone={toneFor(j.customer.name)} size="sm" /> : "—"}</td>
      <td className="hidden w-[130px] py-3 pr-3 md:table-cell">
        <Progress value={JOB_PROGRESS[j.status]} tone={JOB_TONE[j.status]} />
      </td>
      <td className="py-3">
        <JobStatusBadge status={j.status} />
      </td>
    </tr>
  );
}
