"use client";

import { useEffect, useState } from "react";
import { Car, ClipboardCheck, Clock, History, LayoutGrid, List, Phone, Plus, Receipt, Search, Siren, Wrench, X } from "lucide-react";

import {
  getJobOwnerLink,
  addJobItem,
  changeJobStatus,
  createCustomer,
  createJobCard,
  createVehicle,
  getJobCard,
  isFinished,
  issueInvoice,
  listJobCards,
  listParts,
  listVehicles,
  NEXT_STATUSES,
  OWNER_ONLY_STATUSES,
  removeJobItem,
  updateJobCard,
  type Garage,
  type ItemKind,
  type JobCard,
  type JobCardSummary,
  type JobStatus,
  type Role,
  type StaffMember,
  type Vehicle,
} from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import {
  Avatar,
  Badge,
  Card,
  Chip,
  Empty,
  ErrorNote,
  Field,
  JOB_PROGRESS,
  JOB_TONE,
  JobStatusBadge,
  Loading,
  Panel,
  Progress,
  Segmented,
  SourceBadge,
  Spinner,
  TONE,
  btnDanger,
  btnPrimary,
  btnSecondary,
  btnSm,
  inputCls,
  num,
  text,
  toneFor,
  useAction,
  useDebounced,
  useLoad,
  useMoney,
  vehicleLabel,
  vehicleName,
} from "./ui";
import InspectionTab from "./Inspection";
import { JobPartOrders } from "@/components/parts/GarageParts";

import { MechanicChip, MechanicSelect, ShareTracking, Timeline, useStaff } from "./JobExtras";

/** "ACTIVE" is every status that still needs work. */
type Filter = JobStatus | "ACTIVE" | "ALL";
const FILTERS: Filter[] = ["ACTIVE", "OPEN", "IN_PROGRESS", "WAITING_PARTS", "READY", "CLOSED", "CANCELLED", "ALL"];
const BOARD: JobStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "READY"];
type Source = "ALL" | "KADUNA_DISPATCH" | "WALK_IN";

export default function Jobs({
  garage,
  role = "OWNER",
  openJobId,
  onOpenJob,
  onOpenInvoice,
}: {
  garage: Garage;
  role?: Role;
  openJobId: string | null;
  onOpenJob: (id: string | null) => void;
  onOpenInvoice?: (id: string) => void;
}) {
  const owner = role === "OWNER";
  const t = useT();
  const { formatDate } = useI18n();
  const [view, setView] = useState<"board" | "list">("board");
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const [source, setSource] = useState<Source>("ALL");
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  const [creating, setCreating] = useState(false);
  // Mechanics start on their own jobs.
  const [mine, setMine] = useState(!owner);
  const effective: Filter = view === "board" ? "ACTIVE" : filter;

  const jobs = useLoad(
    async () =>
      (
        await listJobCards({
          status: effective === "ACTIVE" || effective === "ALL" ? undefined : effective,
          active: effective === "ACTIVE" || undefined,
          q: search || undefined,
          mine: (!owner && mine) || undefined,
          limit: 200,
        })
      ).items,
    [effective, search, mine, owner]
  );
  const shown = (jobs.data ?? []).filter((j) => source === "ALL" || j.source === source);
  const count = (s: Source) => (jobs.data ?? []).filter((j) => s === "ALL" || j.source === s).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "board", label: <><LayoutGrid />{t("garage.jobs.board")}</> },
            { value: "list", label: <><List />{t("garage.jobs.list")}</> },
          ]}
        />
        {!owner && (
          <Chip on={mine} onClick={() => setMine((m) => !m)}>
            <Wrench className="size-3.5" />
            {t("garage.mech.mine")}
          </Chip>
        )}
        <Chip on={source === "ALL"} onClick={() => setSource("ALL")}>{t("garage.jobs.filterAll")} · {count("ALL")}</Chip>
        <Chip on={source === "KADUNA_DISPATCH"} onClick={() => setSource("KADUNA_DISPATCH")}>
          <span className="size-2 rounded-full bg-vio" />Kaduna · {count("KADUNA_DISPATCH")}
        </Chip>
        <Chip on={source === "WALK_IN"} onClick={() => setSource("WALK_IN")}>{t("garage.source.walkIn")} · {count("WALK_IN")}</Chip>
        {view === "list" && (
          <select aria-label={t("garage.jobs.filter")} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className={`${inputCls} w-auto py-2`}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === "ACTIVE" ? t("garage.jobs.filterActive") : f === "ALL" ? t("garage.jobs.filterAll") : t(`garage.status.${f}`)}
              </option>
            ))}
          </select>
        )}
        <div className="flex-1" />
        <label className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">{t("garage.action.search")}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("garage.jobs.searchPlaceholder")} className={`${inputCls} py-2 pl-10`} />
        </label>
        {owner && (
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            <Plus /> {t("garage.jobs.new")}
          </button>
        )}
      </div>

      {jobs.error ? (
        <ErrorNote message={jobs.error} onRetry={jobs.reload} />
      ) : !jobs.data ? (
        <Loading />
      ) : shown.length === 0 && view === "list" ? (
        <Empty title={search ? t("garage.jobs.noMatch") : t("garage.jobs.emptyTitle")} body={search ? undefined : t("garage.jobs.emptyBody")} />
      ) : view === "board" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {BOARD.map((status) => {
            const col = shown.filter((j) => j.status === status);
            return (
              <section key={status} className="rounded-2xl bg-[#efeae2]/70 p-3">
                <div className="flex items-center gap-2 px-1 pb-3">
                  <span className={`size-2.5 rounded-full ${TONE[JOB_TONE[status]].solid}`} />
                  <h3 className="text-sm font-semibold">{t(`garage.status.${status}`)}</h3>
                  <span className="text-xs font-medium text-muted-foreground">{col.length}</span>
                </div>
                <div className="space-y-3">
                  {col.map((j) => (
                    <BoardCard key={j.id} job={j} onOpen={() => onOpenJob(j.id)} />
                  ))}
                  {col.length === 0 && <p className="rounded-xl border border-dashed border-[#ddd4c7] px-3 py-6 text-center text-xs text-muted-foreground">{t("garage.jobs.columnEmpty")}</p>}
                  {status === "OPEN" && owner && (
                    <button type="button" onClick={() => setCreating(true)} className="w-full rounded-xl border border-dashed border-[#ddd4c7] py-2.5 text-[13px] font-medium text-muted-foreground hover:bg-white/60">
                      + {t("garage.jobs.new")}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Card className="p-0 sm:p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 pb-3 pt-5 font-medium">#</th>
                  <th className="px-3 pb-3 pt-5 font-medium">{t("garage.col.vehicle")}</th>
                  <th className="px-3 pb-3 pt-5 font-medium">{t("garage.col.customer")}</th>
                  <th className="hidden px-3 pb-3 pt-5 font-medium lg:table-cell">{t("garage.staff.mechanic")}</th>
                  <th className="hidden px-3 pb-3 pt-5 font-medium md:table-cell">{t("garage.col.complaint")}</th>
                  <th className="px-3 pb-3 pt-5 font-medium">{t("garage.col.status")}</th>
                  <th className="hidden px-5 pb-3 pt-5 font-medium sm:table-cell">{t("garage.col.opened")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((j) => (
                  <tr key={j.id} onClick={() => onOpenJob(j.id)} className="cursor-pointer border-t border-border hover:bg-canvas/60">
                    <td className="px-5 py-3.5 font-mono text-[13px] text-muted-foreground">
                      <button type="button" className="hover:underline" onClick={() => onOpenJob(j.id)}>#{j.number}</button>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-2 font-medium">{vehicleName(j.vehicle, t("garage.vehicle.unknown"))}{j.source === "KADUNA_DISPATCH" && <SourceBadge source={j.source} />}</div>
                      <div className="font-mono text-xs text-muted-foreground">{j.vehicle?.plate ?? ""}</div>
                    </td>
                    <td className="px-3 py-3.5">{j.customer?.name ?? "—"}</td>
                    <td className="hidden px-3 py-3.5 lg:table-cell">{j.mechanic ? <MechanicChip name={j.mechanic.name} /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="hidden max-w-xs truncate px-3 py-3.5 text-muted-foreground md:table-cell">{j.complaint ?? "—"}</td>
                    <td className="px-3 py-3.5"><JobStatusBadge status={j.status} /></td>
                    <td className="hidden px-5 py-3.5 text-muted-foreground sm:table-cell">{formatDate(j.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {owner && (
      <NewJob
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(job) => {
          setCreating(false);
          jobs.reload();
          onOpenJob(job.id);
        }}
      />
      )}
      <JobPanel garage={garage} role={role} jobId={openJobId} onClose={() => onOpenJob(null)} onChanged={jobs.reload} onOpenInvoice={onOpenInvoice} />
    </div>
  );
}

function BoardCard({ job: j, onOpen }: { job: JobCardSummary; onOpen: () => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const overdue = j.promisedAt && new Date(j.promisedAt) < new Date();
  return (
    <button type="button" onClick={onOpen} className={`block w-full rounded-xl bg-white p-4 text-left shadow-[0_4px_20px_rgba(41,31,24,.05)] transition hover:-translate-y-0.5 hover:shadow-md ${overdue ? "ring-1 ring-bad/40" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">#{j.number}</span>
        <SourceBadge source={j.source} />
      </div>
      <p className="mt-2 text-[15px] font-semibold">{vehicleName(j.vehicle, t("garage.vehicle.unknown"))}</p>
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{j.vehicle?.plate ?? "—"}</span>
        {j.customer && ` · ${j.customer.name}`}
      </p>
      {j.complaint && <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{j.complaint}</p>}
      <Progress value={JOB_PROGRESS[j.status]} tone={JOB_TONE[j.status]} className="mt-3" />
      <div className="mt-3 flex items-center justify-between">
        {j.mechanic ? <MechanicChip name={j.mechanic.name} /> : j.customer ? <Avatar name={j.customer.name} tone={toneFor(j.customer.name)} size="sm" /> : <span />}
        <span className={`flex items-center gap-1 text-xs font-medium ${overdue ? "text-bad" : "text-muted-foreground"}`}>
          <Clock className="size-3.5" />
          {j.promisedAt
            ? overdue
              ? t("garage.jobs.overdue")
              : formatDate(j.promisedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            : formatDate(j.createdAt, { day: "numeric", month: "short" })}
        </span>
      </div>
    </button>
  );
}

/** Walk-in intake. A plate the garage has seen before fills in the vehicle and its owner. */
function NewJob({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (job: JobCard) => void }) {
  const t = useT();
  const action = useAction();
  const { setError } = action;
  const [plate, setPlate] = useState("");
  const debouncedPlate = useDebounced(plate.trim(), 400);
  const [known, setKnown] = useState<Vehicle | null>(null);
  const staff = useStaff(open);

  useEffect(() => {
    if (!open) {
      setPlate("");
      setKnown(null);
      setError(null);
    }
  }, [open, setError]);

  useEffect(() => {
    let live = true;
    const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (key(debouncedPlate).length < 3) {
      setKnown(null);
      return;
    }
    listVehicles({ q: debouncedPlate, limit: 5 }).then(
      (page) => live && setKnown(page.items.find((v) => v.plate && key(v.plate) === key(debouncedPlate)) ?? null),
      () => live && setKnown(null)
    );
    return () => {
      live = false;
    };
  }, [debouncedPlate]);

  async function submit(form: FormData) {
    const job = await action.run("create", async () => {
      let vehicleId = known?.id ?? null;
      let customerId = known?.customerId ?? null;
      const customerName = text(form.get("customerName"));
      if (!customerId && customerName) {
        customerId = (await createCustomer({ name: customerName, phone: text(form.get("customerPhone")) })).id;
      }
      if (!vehicleId && (text(form.get("plate")) || text(form.get("make")) || text(form.get("model")))) {
        vehicleId = (
          await createVehicle({
            plate: text(form.get("plate")),
            make: text(form.get("make")),
            model: text(form.get("model")),
            year: num(form.get("year")),
            customerId,
          })
        ).id;
      }
      const promised = text(form.get("promisedAt"));
      return createJobCard({
        vehicleId,
        customerId,
        complaint: text(form.get("complaint")),
        odometerIn: num(form.get("odometerIn")),
        mechanicId: text(form.get("mechanicId")),
        promisedAt: promised ? new Date(promised).toISOString() : null,
      });
    });
    if (job) onCreated(job);
  }

  return (
    <Panel open={open} onClose={onClose} title={t("garage.jobs.new")} description={t("garage.jobs.newBody")}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
      >
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold">{t("garage.section.vehicle")}</h3>
          <Field label={t("garage.field.plate")}>
            <input name="plate" value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} placeholder="CAB-1234" className={`${inputCls} font-mono uppercase`} />
          </Field>
          {known ? (
            <p className="rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">{t("garage.jobs.knownVehicle", { vehicle: vehicleLabel(known, known.plate ?? "") })}</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("garage.field.make")}>
                <input name="make" maxLength={60} placeholder="Toyota" className={inputCls} />
              </Field>
              <Field label={t("garage.field.model")}>
                <input name="model" maxLength={60} placeholder="Aqua" className={inputCls} />
              </Field>
              <Field label={t("garage.field.year")}>
                <input name="year" type="number" min={1950} max={2100} className={inputCls} />
              </Field>
            </div>
          )}
        </Card>

        {!known?.customerId && (
          <Card className="space-y-3 p-5">
            <h3 className="text-sm font-semibold">{t("garage.section.customer")}</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("garage.field.name")}>
                <input name="customerName" maxLength={160} className={inputCls} />
              </Field>
              <Field label={t("garage.field.phone")}>
                <input name="customerPhone" type="tel" maxLength={40} className={inputCls} />
              </Field>
            </div>
          </Card>
        )}

        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold">{t("garage.section.job")}</h3>
          <Field label={t("garage.field.complaint")}>
            <textarea name="complaint" rows={3} maxLength={4000} placeholder={t("garage.field.complaintPlaceholder")} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("garage.field.odometer")}>
              <input name="odometerIn" type="number" min={0} className={inputCls} />
            </Field>
            <Field label={t("garage.staff.mechanic")}>
              <MechanicSelect name="mechanicId" staff={staff.data ?? []} />
            </Field>
          </div>
          <Field label={t("garage.field.promisedAt")}>
            <input name="promisedAt" type="datetime-local" className={inputCls} />
          </Field>
        </Card>

        {action.error && <ErrorNote message={action.error} />}
        <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} w-full`}>
          {action.busy && <Spinner />} {t("garage.jobs.open")}
        </button>
      </form>
    </Panel>
  );
}

const FLOW: JobStatus[] = ["OPEN", "IN_PROGRESS", "READY", "CLOSED"];
type PanelTab = "work" | "inspection" | "timeline";

function JobPanel({
  garage,
  role,
  jobId,
  onClose,
  onChanged,
  onOpenInvoice,
}: {
  garage: Garage;
  role: Role;
  jobId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenInvoice?: (id: string) => void;
}) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const owner = role === "OWNER";
  const job = useLoad(() => (jobId ? getJobCard(jobId) : Promise.resolve(null)), [jobId]);
  const staff = useStaff(owner && jobId !== null);
  const action = useAction();
  const [tab, setTab] = useState<PanelTab>("work");
  const j = job.data && job.data.id === jobId ? job.data : null;

  useEffect(() => setTab("work"), [jobId]);

  function changed(next: JobCard) {
    job.setData(next);
    onChanged();
  }
  async function apply(key: string, fn: () => Promise<JobCard>): Promise<boolean> {
    const next = await action.run(key, fn);
    if (!next) return false;
    changed(next);
    return true;
  }

  const locked = !j || isFinished(j.status) || j.invoice !== null;
  // WAITING_PARTS sits inside "in progress" on the stepper.
  const stepIdx = j ? (j.status === "WAITING_PARTS" ? 1 : FLOW.indexOf(j.status)) : -1;
  const tax = j ? Math.round(j.subtotal * garage.taxRate) / 100 : 0;
  const moves = j ? NEXT_STATUSES[j.status].filter((s) => owner || !OWNER_ONLY_STATUSES.includes(s)) : [];

  return (
    <Panel
      wide
      open={jobId !== null}
      onClose={onClose}
      title={j ? `${t("garage.job.title", { n: j.number })} · ${vehicleName(j.vehicle, t("garage.vehicle.unknown"))}` : t("garage.loading")}
      description={
        j ? (
          <>
            <JobStatusBadge status={j.status} />
            <SourceBadge source={j.source} />
            <span className="text-xs text-muted-foreground">
              {t("garage.col.opened")} {formatDate(j.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {j.promisedAt && ` · ${t("garage.field.promisedAt")} ${formatDate(j.promisedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
            </span>
          </>
        ) : undefined
      }
    >
      {job.error ? (
        <ErrorNote message={job.error} onRetry={job.reload} />
      ) : !j ? (
        <Loading />
      ) : (
        <>
          {/* Status stepper + moves */}
          <Card className="p-5">
            {j.status === "CANCELLED" ? (
              <Badge tone="bad">{t("garage.status.CANCELLED")}</Badge>
            ) : (
              <ol className="grid grid-cols-4 gap-2">
                {FLOW.map((s, n) => (
                  <li key={s}>
                    <div className={`h-1.5 rounded-full ${n < stepIdx || j.status === "CLOSED" ? "bg-ok" : n === stepIdx ? (j.status === "WAITING_PARTS" ? "bg-warn" : "bg-primary") : "bg-muted"}`} />
                    <p className={`mt-2 text-xs font-semibold ${n <= stepIdx ? "text-foreground" : "text-muted-foreground"}`}>
                      {n === 1 && j.status === "WAITING_PARTS" ? t("garage.status.WAITING_PARTS") : t(`garage.status.${s}`)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {moves.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                {moves.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={action.busy !== null}
                    onClick={() => {
                      if (s === "CANCELLED" && !window.confirm(t("garage.job.confirmCancel"))) return;
                      apply(s, () => changeJobStatus(j.id, s));
                    }}
                    className={`${s === "CANCELLED" ? btnDanger : s === "READY" || s === "CLOSED" ? btnPrimary : btnSecondary} ${btnSm}`}
                  >
                    {action.busy === s && <Spinner />} {t(j.status === "READY" && s === "IN_PROGRESS" ? "garage.move.reopen" : `garage.move.${s}`)}
                  </button>
                ))}
              </div>
            )}
            {!owner && j.status === "READY" && <p className="mt-3 text-xs text-muted-foreground">{t("garage.mech.ownerHandsOver")}</p>}
          </Card>

          {action.error && <ErrorNote message={action.error} />}

          <Segmented
            value={tab}
            onChange={setTab}
            label={t("garage.job.sections")}
            options={[
              { value: "work", label: <><Wrench />{t("garage.job.tabWork")}</> },
              {
                value: "inspection",
                label: (
                  <>
                    <ClipboardCheck />
                    {t("garage.job.tabInspection")}
                    {j.inspection && j.inspection.pendingApproval > 0 && <span className="rounded-full bg-warn px-1.5 text-[11px] leading-[18px] text-white">{j.inspection.pendingApproval}</span>}
                  </>
                ),
              },
              { value: "timeline", label: <><History />{t("garage.job.tabTimeline")}</> },
            ]}
          />

          {tab === "inspection" ? (
            <InspectionTab garage={garage} job={j} locked={isFinished(j.status)} onJobChanged={changed} />
          ) : tab === "timeline" ? (
            <>
              {j.status !== "CANCELLED" && <ShareTracking job={j} garageName={garage.name} canReset={owner} onChanged={changed} />}
              <Timeline job={j} onChanged={changed} />
            </>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary"><Car className="size-6" strokeWidth={1.75} /></span>
                    <div className="min-w-0">
                      <p className="truncate font-display font-semibold">{vehicleName(j.vehicle, t("garage.vehicle.unknown"))}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        <span className="font-mono">{j.vehicle?.plate ?? "—"}</span>
                        {j.odometerIn != null && ` · ${j.odometerIn.toLocaleString()} km`}
                      </p>
                      {j.vehicle?.plate && <KadunaOwner jobId={j.id} />}
                    </div>
                  </div>
                </Card>
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <Avatar name={j.customer?.name} tone={toneFor(j.customer?.name)} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display font-semibold">{j.customer?.name ?? "—"}</p>
                      <p className="truncate text-sm text-muted-foreground">{j.customer?.phone ?? t("garage.job.noPhone")}</p>
                    </div>
                    {j.customer?.phone && (
                      <a href={`tel:${j.customer.phone}`} className={`${btnSecondary} ${btnSm}`} aria-label={t("garage.field.phone")}>
                        <Phone />
                      </a>
                    )}
                  </div>
                </Card>
              </div>

              {j.source === "KADUNA_DISPATCH" && (
                <div className="flex items-center gap-3 rounded-2xl bg-vio-soft px-4 py-3 text-[13px] text-vio">
                  <Siren className="size-5 shrink-0" strokeWidth={1.75} />
                  {t("garage.job.fromKaduna")}
                </div>
              )}

              <Card className="space-y-4 p-5">
                {j.complaint && (
                  <div className="text-sm">
                    <p className="text-xs font-medium text-muted-foreground">{t("garage.field.complaint")}</p>
                    <p className="mt-1 whitespace-pre-line">{j.complaint}</p>
                  </div>
                )}
                <Mechanic job={j} owner={owner} staff={staff.data ?? []} busy={action.busy === "mechanic"} onAssign={(mechanicId) => apply("mechanic", () => updateJobCard(j.id, { mechanicId }))} />
                <Diagnosis key={j.id} job={j} locked={isFinished(j.status)} onSave={(diagnosis) => apply("diagnosis", () => updateJobCard(j.id, { diagnosis }))} busy={action.busy === "diagnosis"} />
              </Card>

              <Card className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="font-display text-lg font-semibold">{t("garage.job.lines")}</h3>
                    <p className="text-xs text-muted-foreground">{t("garage.job.linesSub")}</p>
                  </div>
                </div>
                {j.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("garage.job.noLines")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="pb-2 pr-2 font-medium">{t("garage.field.description")}</th>
                          <th className="pb-2 pr-2 font-medium">{t("garage.jobs.type")}</th>
                          <th className="pb-2 pr-2 text-right font-medium">{t("garage.field.qty")}</th>
                          <th className="pb-2 text-right font-medium">{t("garage.invoice.amount")}</th>
                          {!locked && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {j.items.map((item) => (
                          <tr key={item.id} className="border-t border-border">
                            <td className="py-3 pr-2 font-medium">{item.description}</td>
                            <td className="py-3 pr-2">
                              <Badge tone={item.kind === "LABOUR" ? "brand" : "info"} dot={false}>{t(`garage.kind.${item.kind}`)}</Badge>
                            </td>
                            <td className="whitespace-nowrap py-3 pr-2 text-right tabular-nums text-muted-foreground">
                              {item.quantity} × {money(item.unitPrice, garage.currency)}
                            </td>
                            <td className="whitespace-nowrap py-3 text-right font-medium tabular-nums">{money(item.lineTotal, garage.currency)}</td>
                            {!locked && (
                              <td className="w-8 py-3 pl-2 text-right">
                                <button
                                  type="button"
                                  aria-label={t("garage.action.remove")}
                                  disabled={action.busy !== null}
                                  onClick={() => apply(`rm-${item.id}`, () => removeJobItem(j.id, item.id))}
                                  className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-bad-soft hover:text-bad"
                                >
                                  {action.busy === `rm-${item.id}` ? <Spinner /> : <X className="size-4" />}
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="ml-auto mt-3 w-full max-w-[280px] space-y-1.5 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t("garage.invoice.subtotal")}</span>
                        <span className="tabular-nums">{money(j.subtotal, garage.currency)}</span>
                      </div>
                      {garage.taxRate > 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>{t("garage.job.taxEstimate", { rate: garage.taxRate })}</span>
                          <span className="tabular-nums">{money(tax, garage.currency)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-border pt-2 font-display text-lg font-bold">
                        <span>{t("garage.invoice.total")}</span>
                        <span className="tabular-nums">{money(j.subtotal + tax, garage.currency)}</span>
                      </div>
                    </div>
                  </div>
                )}
                {!locked && <AddLine garage={garage} busy={action.busy === "add"} onAdd={(input) => apply("add", () => addJobItem(j.id, input))} />}
                {j.invoice && !isFinished(j.status) && <p className="mt-2 text-xs text-muted-foreground">{t("garage.job.lockedByInvoice")}</p>}
              </Card>

              <JobPartOrders garage={garage} job={{ id: j.id, number: j.number, vehicle: j.vehicle }} owner={owner} locked={locked} />

              {owner && (
                <Card className="p-5">
                  {j.invoice ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="grid size-10 place-items-center rounded-xl bg-ok-soft text-ok"><Receipt className="size-5" /></span>
                      <span>{t("garage.job.invoiced", { n: j.invoice.number, total: money(j.invoice.total, garage.currency) })}</span>
                      {onOpenInvoice && (
                        <button type="button" onClick={() => onOpenInvoice(j.invoice!.id)} className={`${btnSecondary} ${btnSm} ml-auto`}>
                          {t("garage.job.viewInvoice")}
                        </button>
                      )}
                    </div>
                  ) : j.status === "READY" || j.status === "CLOSED" ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-muted-foreground">{j.items.length ? t("garage.job.readyToInvoice") : t("garage.job.noLinesToInvoice")}</span>
                      <button
                        type="button"
                        disabled={action.busy !== null || j.items.length === 0}
                        onClick={async () => {
                          const invoice = await action.run("invoice", () => issueInvoice(j.id));
                          if (invoice) {
                            job.reload();
                            onChanged();
                            onOpenInvoice?.(invoice.id);
                          }
                        }}
                        className={`${btnPrimary} ml-auto`}
                      >
                        {action.busy === "invoice" ? <Spinner /> : <Receipt />} {t("garage.job.createInvoice")}
                      </button>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground"><Receipt className="size-4" />{t("garage.job.invoiceWhenReady")}</p>
                  )}
                </Card>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
}

/** Who's doing the work. The owner assigns; a legacy free-text name still shows for older jobs. */
function Mechanic({ job, owner, staff, busy, onAssign }: { job: JobCard; owner: boolean; staff: StaffMember[]; busy: boolean; onAssign: (id: string | null) => void }) {
  const t = useT();
  const name = job.mechanic?.name ?? job.assignedTo;
  if (!owner || isFinished(job.status)) {
    return name ? (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("garage.staff.mechanic")}:</span>
        <MechanicChip name={name} />
      </div>
    ) : null;
  }
  // Keep the current mechanic selectable even if they were switched off since.
  const current = job.mechanic;
  const options: StaffMember[] =
    current && !staff.some((m) => m.id === current.id)
      ? [...staff, { ...current, phone: null, active: false, joined: false, joinedAt: null, inviteCode: null, createdAt: "" }]
      : staff;
  return (
    <Field label={t("garage.staff.mechanic")} hint={!current && job.assignedTo ? t("garage.staff.legacyAssigned", { name: job.assignedTo }) : undefined}>
      <div className="flex items-center gap-2">
        <MechanicSelect value={current?.id ?? ""} onChange={onAssign} staff={options} className="max-w-xs" />
        {busy && <Spinner />}
      </div>
    </Field>
  );
}

function Diagnosis({ job, locked, busy, onSave }: { job: JobCard; locked: boolean; busy: boolean; onSave: (v: string | null) => void }) {
  const t = useT();
  const [value, setValue] = useState(job.diagnosis ?? "");
  const dirty = value.trim() !== (job.diagnosis ?? "");
  if (locked) {
    return job.diagnosis ? (
      <div className="text-sm">
        <p className="text-xs font-medium text-muted-foreground">{t("garage.field.diagnosis")}</p>
        <p className="mt-1 whitespace-pre-line">{job.diagnosis}</p>
      </div>
    ) : null;
  }
  return (
    <div className="space-y-2">
      <Field label={t("garage.field.diagnosis")}>
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={4000} placeholder={t("garage.field.diagnosisPlaceholder")} className={inputCls} />
      </Field>
      {dirty && (
        <button type="button" disabled={busy} onClick={() => onSave(value.trim() || null)} className={`${btnSecondary} ${btnSm}`}>
          {busy && <Spinner />} {t("garage.action.save")}
        </button>
      )}
    </div>
  );
}

function AddLine({
  garage,
  busy,
  onAdd,
}: {
  garage: Garage;
  busy: boolean;
  onAdd: (input: { kind: ItemKind; description?: string | null; quantity?: number; unitPrice?: number | null; partId?: string | null }) => Promise<boolean>;
}) {
  const t = useT();
  const money = useMoney();
  const [kind, setKind] = useState<ItemKind>("LABOUR");
  const parts = useLoad(() => (kind === "PART" ? listParts({ limit: 200 }) : Promise.resolve(null)), [kind]);
  const [partId, setPartId] = useState("");
  const part = parts.data?.items.find((p) => p.id === partId);

  return (
    <form
      className="mt-5 space-y-3 rounded-2xl bg-canvas p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const el = e.currentTarget;
        const form = new FormData(el);
        // Keep what was typed if the server refuses it (e.g. not enough stock).
        const added = await onAdd({
          kind,
          partId: kind === "PART" && partId ? partId : null,
          description: text(form.get("description")),
          quantity: num(form.get("quantity")) ?? 1,
          unitPrice: num(form.get("unitPrice")),
        });
        if (added) {
          el.reset();
          setPartId("");
        }
      }}
    >
      <Segmented
        value={kind}
        onChange={setKind}
        label={t("garage.job.addLine")}
        options={(["LABOUR", "PART"] as ItemKind[]).map((k) => ({ value: k, label: t(`garage.kind.${k}`) }))}
      />

      {kind === "PART" && (
        <Field label={t("garage.job.fromInventory")}>
          <select value={partId} onChange={(e) => setPartId(e.target.value)} className={inputCls}>
            <option value="">{t("garage.job.notFromInventory")}</option>
            {parts.data?.items
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id} disabled={p.stockQty <= 0}>
                  {p.name} ({p.sku}) · {t("garage.job.inStock", { qty: p.stockQty })}
                </option>
              ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-6 gap-2">
        <Field label={t("garage.field.description")} className="col-span-6 sm:col-span-3">
          <input
            name="description"
            maxLength={240}
            required={!(kind === "PART" && partId)}
            placeholder={part ? part.name : kind === "LABOUR" ? t("garage.job.labourPlaceholder") : t("garage.job.partPlaceholder")}
            className={inputCls}
          />
        </Field>
        <Field label={kind === "LABOUR" ? t("garage.field.hours") : t("garage.field.qty")} className="col-span-2 sm:col-span-1">
          <input name="quantity" type="number" min={0.01} step="0.01" defaultValue={1} className={inputCls} />
        </Field>
        <Field label={t("garage.field.unitPrice")} className="col-span-4 sm:col-span-2">
          <input
            name="unitPrice"
            type="number"
            min={0}
            step="0.01"
            placeholder={part ? String(part.unitPrice) : kind === "LABOUR" ? String(garage.labourRate) : ""}
            required={kind === "PART" && !partId}
            className={inputCls}
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        {kind === "LABOUR"
          ? t("garage.job.labourHint", { rate: money(garage.labourRate, garage.currency) })
          : partId
            ? t("garage.job.partStockHint")
            : t("garage.job.partFreeHint")}
      </p>
      <button type="submit" disabled={busy} className={`${btnSecondary} ${btnSm}`}>
        {busy ? <Spinner /> : <Plus />} {t("garage.job.addLine")}
      </button>
    </form>
  );
}

/**
 * The owner registered this plate in Kaduna, so they follow this job in their
 * dashboard on their own. Shown only when that can be checked (Supabase
 * plate_is_registered installed); silent otherwise.
 */
function KadunaOwner({ jobId }: { jobId: string }) {
  const t = useT();
  const owner = useLoad(() => getJobOwnerLink(jobId).then((o) => o.registered, () => null), [jobId]);
  if (owner.data !== true) return null;
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok">
      {t("garage.job.ownerFollows")}
    </span>
  );
}
