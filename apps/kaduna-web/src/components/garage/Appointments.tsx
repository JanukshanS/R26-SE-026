"use client";

/**
 * The booking diary. A day or week at a time; booking takes a saved customer
 * or just a name, phone and plate. Checking someone in opens their job card.
 */
import { useMemo, useState } from "react";
import { CalendarCheck, CalendarDays, CalendarX2, ChevronLeft, ChevronRight, Clock, Globe, LogIn, Phone, Plus, UserX } from "lucide-react";

import {
  checkInAppointment,
  createAppointment,
  listAppointments,
  listCustomers,
  setAppointmentStatus,
  updateAppointment,
  type Appointment,
  type AppointmentStatus,
  type Customer,
  type Garage,
  type Role,
} from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import { MechanicChip, MechanicSelect, useStaff } from "./JobExtras";
import OnlineBooking from "./OnlineBooking";
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Field,
  Kpi,
  Loading,
  Panel,
  Segmented,
  Spinner,
  btnDanger,
  btnPrimary,
  btnSecondary,
  btnSm,
  inputCls,
  num,
  text,
  useAction,
  useDebounced,
  useLoad,
  type Tone,
} from "./ui";

const STATUS_TONE: Record<AppointmentStatus, Tone> = { BOOKED: "info", CONFIRMED: "brand", ARRIVED: "ok", CANCELLED: "gray", NO_SHOW: "bad" };
const SERVICES = ["Full service", "Oil change", "Brake check", "AC service", "Wheel alignment", "Diagnosis", "Tyres"];
const DAY_MS = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Weeks start on Monday. */
const startOfWeek = (d: Date) => {
  const day = startOfDay(d);
  return new Date(day.getTime() - ((day.getDay() + 6) % 7) * DAY_MS);
};
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
/** For <input type="datetime-local">, in the browser's own time zone. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function Appointments({ garage, role = "OWNER", onOpenJob }: { garage?: Garage; role?: Role; onOpenJob: (id: string) => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const owner = role === "OWNER";
  const [view, setView] = useState<"day" | "week">("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [booking, setBooking] = useState<Date | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const from = view === "week" ? startOfWeek(anchor) : anchor;
  const days = view === "week" ? 7 : 1;
  const to = new Date(from.getTime() + days * DAY_MS);
  const appts = useLoad(() => listAppointments({ from: from.toISOString(), to: to.toISOString() }), [from.getTime(), days]);
  const list = appts.data ?? [];
  const open = list.find((a) => a.id === openId) ?? null;
  const count = (s: AppointmentStatus) => list.filter((a) => a.status === s).length;

  const step = (dir: number) => setAnchor(new Date(anchor.getTime() + dir * days * DAY_MS));
  const range =
    view === "week"
      ? `${formatDate(from.toISOString(), { day: "numeric", month: "short" })} – ${formatDate(new Date(to.getTime() - DAY_MS).toISOString(), { day: "numeric", month: "short", year: "numeric" })}`
      : formatDate(from.toISOString(), { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-5">
      {owner && garage && (
        <OnlineBooking
          garage={garage}
          onJumpTo={(when) => {
            setView("day");
            setAnchor(startOfDay(when));
          }}
        />
      )}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi tone="info" icon={CalendarDays} value={list.filter((a) => a.status !== "CANCELLED").length} label={view === "week" ? t("garage.appt.thisWeek") : t("garage.appt.thisDay")} />
        <Kpi tone="brand" icon={CalendarCheck} value={count("CONFIRMED")} label={t("garage.appt.status.CONFIRMED")} delta={count("BOOKED") ? t("garage.appt.toConfirm", { n: count("BOOKED") }) : undefined} />
        <Kpi tone="ok" icon={LogIn} value={count("ARRIVED")} label={t("garage.appt.status.ARRIVED")} />
        <Kpi tone="bad" icon={UserX} value={count("NO_SHOW")} label={t("garage.appt.status.NO_SHOW")} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={view} onChange={setView} options={[{ value: "day", label: t("garage.appt.day") }, { value: "week", label: t("garage.appt.week") }]} />
        <div className="inline-flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} aria-label={t("garage.appt.previous")} className={`${btnSecondary} ${btnSm}`}>
            <ChevronLeft />
          </button>
          <button type="button" onClick={() => setAnchor(startOfDay(new Date()))} className={`${btnSecondary} ${btnSm}`}>
            {t("garage.appt.today")}
          </button>
          <button type="button" onClick={() => step(1)} aria-label={t("garage.appt.next")} className={`${btnSecondary} ${btnSm}`}>
            <ChevronRight />
          </button>
        </div>
        <span className="font-display text-base font-semibold">{range}</span>
        <div className="flex-1" />
        {owner && (
          <button type="button" onClick={() => setBooking(new Date(Math.max(Date.now(), from.getTime() + 9 * 3_600_000)))} className={btnPrimary}>
            <Plus /> {t("garage.appt.book")}
          </button>
        )}
      </div>

      {appts.error ? (
        <ErrorNote message={appts.error} onRetry={appts.reload} />
      ) : !appts.data ? (
        <Loading />
      ) : view === "day" ? (
        list.length === 0 ? (
          <Empty title={t("garage.appt.emptyDay")} body={owner ? t("garage.appt.emptyBody") : undefined} />
        ) : (
          <Card className="p-0 sm:p-0">
            <ul>
              {list.map((a) => (
                <li key={a.id} className="border-b border-border last:border-0">
                  <button type="button" onClick={() => setOpenId(a.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-canvas/60">
                    <span className="w-16 shrink-0 font-display text-lg font-semibold tabular-nums">{formatDate(a.startsAt, { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{a.customerName ?? "—"}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {a.service}
                        {a.plate && <> · <span className="font-mono">{a.plate}</span></>}
                      </span>
                    </span>
                    {a.source === "ONLINE" && <OnlineTag />}
                    {a.mechanic && <span className="hidden sm:inline"><MechanicChip name={a.mechanic.name} /></span>}
                    <Badge tone={STATUS_TONE[a.status]}>{t(`garage.appt.status.${a.status}`)}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * DAY_MS)).map((day) => {
            const mine = list.filter((a) => sameDay(new Date(a.startsAt), day));
            const today = sameDay(day, new Date());
            return (
              <section key={day.toISOString()} className={`min-h-40 rounded-2xl p-2.5 ${today ? "bg-brand-soft/70" : "bg-[#efeae2]/70"}`}>
                <button
                  type="button"
                  onClick={() => {
                    setAnchor(day);
                    setView("day");
                  }}
                  className="mb-2 flex w-full items-baseline gap-1.5 px-1 text-left"
                >
                  <span className={`text-xs font-semibold uppercase ${today ? "text-primary" : "text-muted-foreground"}`}>{formatDate(day.toISOString(), { weekday: "short" })}</span>
                  <span className="font-display text-lg font-bold">{day.getDate()}</span>
                </button>
                <div className="space-y-2">
                  {mine.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setOpenId(a.id)}
                      className={`block w-full rounded-xl bg-white p-2.5 text-left shadow-[0_4px_20px_rgba(41,31,24,.05)] transition hover:-translate-y-0.5 ${a.status === "CANCELLED" ? "opacity-50" : ""}`}
                    >
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                        <span className={`size-1.5 rounded-full bg-current ${a.status === "ARRIVED" ? "text-ok" : a.status === "NO_SHOW" ? "text-bad" : a.status === "CONFIRMED" ? "text-primary" : "text-info"}`} />
                        {formatDate(a.startsAt, { hour: "2-digit", minute: "2-digit" })}
                        {a.source === "ONLINE" && <Globe className="ml-auto size-3 text-info" aria-label={t("garage.book.online")} />}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] font-semibold">{a.customerName ?? "—"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{a.service}</span>
                    </button>
                  ))}
                  {owner && (
                    <button
                      type="button"
                      onClick={() => setBooking(new Date(day.getTime() + 9 * 3_600_000))}
                      className="w-full rounded-xl border border-dashed border-[#ddd4c7] py-1.5 text-xs font-medium text-muted-foreground hover:bg-white/60"
                      aria-label={`${t("garage.appt.book")} ${formatDate(day.toISOString(), { weekday: "long", day: "numeric" })}`}
                    >
                      +
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {owner && (
        <BookingForm
          open={booking !== null}
          startsAt={booking}
          onClose={() => setBooking(null)}
          onSaved={() => {
            setBooking(null);
            appts.reload();
          }}
        />
      )}
      <AppointmentPanel
        appointment={open}
        owner={owner}
        onClose={() => setOpenId(null)}
        onChanged={(next) => appts.setData(list.map((a) => (a.id === next.id ? next : a)))}
        onOpenJob={(id) => {
          setOpenId(null);
          appts.reload();
          onOpenJob(id);
        }}
      />
    </div>
  );
}

function AppointmentPanel({
  appointment: a,
  owner,
  onClose,
  onChanged,
  onOpenJob,
}: {
  appointment: Appointment | null;
  owner: boolean;
  onClose: () => void;
  onChanged: (a: Appointment) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const t = useT();
  const { formatDate } = useI18n();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const staff = useStaff(owner && a !== null);
  const done = a ? a.status === "ARRIVED" || a.status === "CANCELLED" || a.status === "NO_SHOW" : true;

  const status = async (s: Exclude<AppointmentStatus, "ARRIVED">) => {
    if (!a) return;
    const next = await action.run(s, () => setAppointmentStatus(a.id, s));
    if (next) onChanged(next);
  };

  return (
    <Panel
      open={a !== null}
      onClose={() => {
        setEditing(false);
        onClose();
      }}
      title={a ? a.customerName ?? t("garage.appt.title") : ""}
      description={
        a ? (
          <>
            <Badge tone={STATUS_TONE[a.status]}>{t(`garage.appt.status.${a.status}`)}</Badge>
            {a.source === "ONLINE" && <OnlineTag />}
            <span className="text-xs text-muted-foreground">{formatDate(a.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </>
        ) : undefined
      }
    >
      {a && (
        <>
          <Card className="space-y-3 p-5 text-sm">
            <Row label={t("garage.appt.service")} value={a.service} />
            <Row label={t("garage.appt.when")} value={`${formatDate(a.startsAt, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · ${a.durationMin} min`} />
            <Row label={t("garage.field.plate")} value={a.plate ? <span className="font-mono">{a.plate}</span> : "—"} />
            <Row
              label={t("garage.field.phone")}
              value={
                a.phone ? (
                  <a href={`tel:${a.phone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                    <Phone className="size-3.5" /> {a.phone}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Row label={t("garage.staff.mechanic")} value={a.mechanic ? <MechanicChip name={a.mechanic.name} /> : t("garage.staff.unassigned")} />
            {a.notes && <Row label={t("garage.appt.notes")} value={<span className="whitespace-pre-line">{a.notes}</span>} />}
          </Card>

          {a.jobCardId ? (
            <Card className="flex items-center gap-3 p-5 text-sm">
              <span className="grid size-10 place-items-center rounded-xl bg-ok-soft text-ok"><LogIn className="size-5" /></span>
              <span className="flex-1">{t("garage.appt.checkedIn", { n: a.jobNumber ?? "" })}</span>
              <button type="button" onClick={() => onOpenJob(a.jobCardId!)} className={`${btnSecondary} ${btnSm}`}>
                {t("garage.appt.openJob")}
              </button>
            </Card>
          ) : (
            owner &&
            !done && (
              <Card className="space-y-3 p-5">
                <button
                  type="button"
                  disabled={action.busy !== null}
                  onClick={async () => {
                    const res = await action.run("checkin", () => checkInAppointment(a.id));
                    if (res) {
                      onChanged(res.appointment);
                      onOpenJob(res.job.id);
                    }
                  }}
                  className={`${btnPrimary} w-full`}
                >
                  {action.busy === "checkin" ? <Spinner /> : <LogIn />} {t("garage.appt.checkIn")}
                </button>
                <p className="text-xs text-muted-foreground">{t("garage.appt.checkInHint")}</p>
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {a.status === "BOOKED" && (
                    <button type="button" disabled={action.busy !== null} onClick={() => status("CONFIRMED")} className={`${btnSecondary} ${btnSm}`}>
                      <CalendarCheck /> {t("garage.appt.confirm")}
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing((e) => !e)} className={`${btnSecondary} ${btnSm}`}>
                    <Clock /> {t("garage.appt.reschedule")}
                  </button>
                  <button type="button" disabled={action.busy !== null} onClick={() => status("NO_SHOW")} className={`${btnSecondary} ${btnSm}`}>
                    <UserX /> {t("garage.appt.noShow")}
                  </button>
                  <button
                    type="button"
                    disabled={action.busy !== null}
                    onClick={() => window.confirm(t("garage.appt.cancelConfirm")) && status("CANCELLED")}
                    className={`${btnDanger} ${btnSm}`}
                  >
                    <CalendarX2 /> {t("garage.appt.cancel")}
                  </button>
                </div>
              </Card>
            )
          )}
          {owner && (a.status === "CANCELLED" || a.status === "NO_SHOW") && (
            <button type="button" disabled={action.busy !== null} onClick={() => status("BOOKED")} className={`${btnSecondary} ${btnSm}`}>
              {t("garage.appt.restore")}
            </button>
          )}

          {editing && !done && (
            <form
              className="space-y-3 rounded-2xl bg-white p-5"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const when = text(form.get("startsAt"));
                const next = await action.run("edit", () =>
                  updateAppointment(a.id, {
                    startsAt: when ? new Date(when).toISOString() : undefined,
                    durationMin: num(form.get("durationMin")) ?? undefined,
                    mechanicId: text(form.get("mechanicId")),
                    service: text(form.get("service")) ?? a.service,
                  })
                );
                if (next) {
                  onChanged(next);
                  setEditing(false);
                }
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("garage.appt.when")}>
                  <input name="startsAt" type="datetime-local" required defaultValue={localInput(new Date(a.startsAt))} className={inputCls} />
                </Field>
                <Field label={t("garage.appt.duration")}>
                  <input name="durationMin" type="number" min={15} max={600} step={15} defaultValue={a.durationMin} className={inputCls} />
                </Field>
              </div>
              <Field label={t("garage.appt.service")}>
                <input name="service" defaultValue={a.service} maxLength={160} className={inputCls} />
              </Field>
              <Field label={t("garage.staff.mechanic")}>
                {/* Remount once staff load, so the current mechanic is preselected. */}
                <MechanicSelect name="mechanicId" staff={staff.data ?? []} defaultValue={a.mechanic?.id ?? ""} key={`${a.mechanic?.id}-${staff.data?.length}`} />
              </Field>
              <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} ${btnSm}`}>
                {action.busy === "edit" && <Spinner />} {t("garage.action.save")}
              </button>
            </form>
          )}
          {action.error && <ErrorNote message={action.error} />}
        </>
      )}
    </Panel>
  );
}

function OnlineTag() {
  const t = useT();
  return (
    <Badge tone="info" dot={false}>
      <Globe className="size-3" /> {t("garage.book.online")}
    </Badge>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 font-medium">{value}</span>
    </div>
  );
}

function BookingForm({ open, startsAt, onClose, onSaved }: { open: boolean; startsAt: Date | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const action = useAction();
  const staff = useStaff(open);
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim(), 300);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const matches = useLoad(() => (open && search.length >= 2 && !customer ? listCustomers(search, 5).then((p) => p.items) : Promise.resolve([] as Customer[])), [open, search, customer]);
  const defaultStart = useMemo(() => (startsAt ? localInput(startsAt) : ""), [startsAt]);

  return (
    <Panel
      open={open}
      onClose={() => {
        setCustomer(null);
        setQ("");
        onClose();
      }}
      title={t("garage.appt.book")}
      description={t("garage.appt.bookBody")}
    >
      <form
        key={defaultStart}
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const when = text(form.get("startsAt"));
          const saved = await action.run("book", () =>
            createAppointment({
              customerId: customer?.id ?? null,
              customerName: customer ? null : text(form.get("customerName")) ?? (q.trim() || null),
              phone: customer ? null : text(form.get("phone")),
              plate: text(form.get("plate")),
              service: text(form.get("service")) ?? "",
              notes: text(form.get("notes")),
              startsAt: when ? new Date(when).toISOString() : new Date().toISOString(),
              durationMin: num(form.get("durationMin")) ?? 60,
              mechanicId: text(form.get("mechanicId")),
            })
          );
          if (saved) {
            setCustomer(null);
            setQ("");
            onSaved();
          }
        }}
      >
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold">{t("garage.section.customer")}</h3>
          {customer ? (
            <div className="flex items-center gap-3 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
              <span className="flex-1 font-medium">
                {customer.name}
                {customer.phone && ` · ${customer.phone}`}
              </span>
              <button type="button" onClick={() => setCustomer(null)} className="text-xs underline">
                {t("garage.appt.change")}
              </button>
            </div>
          ) : (
            <>
              <Field label={t("garage.field.name")} hint={t("garage.appt.customerHint")}>
                <input name="customerName" value={q} onChange={(e) => setQ(e.target.value)} required maxLength={160} autoComplete="off" className={inputCls} />
              </Field>
              {(matches.data ?? []).length > 0 && (
                <ul className="overflow-hidden rounded-xl border border-border">
                  {matches.data!.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => setCustomer(c)} className="block w-full px-3 py-2 text-left text-sm hover:bg-canvas">
                        <span className="font-medium">{c.name}</span>
                        {c.phone && <span className="text-muted-foreground"> · {c.phone}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Field label={t("garage.field.phone")}>
                <input name="phone" type="tel" maxLength={40} className={inputCls} />
              </Field>
            </>
          )}
          <Field label={t("garage.field.plate")}>
            <input name="plate" maxLength={20} placeholder="CAB-1234" className={`${inputCls} font-mono uppercase`} />
          </Field>
        </Card>

        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold">{t("garage.appt.visit")}</h3>
          <Field label={t("garage.appt.service")}>
            <input name="service" required list="garage-services" maxLength={160} className={inputCls} />
            <datalist id="garage-services">
              {SERVICES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("garage.appt.when")}>
              <input name="startsAt" type="datetime-local" required defaultValue={defaultStart} className={inputCls} />
            </Field>
            <Field label={t("garage.appt.duration")}>
              <input name="durationMin" type="number" min={15} max={600} step={15} defaultValue={60} className={inputCls} />
            </Field>
          </div>
          <Field label={t("garage.staff.mechanic")}>
            <MechanicSelect name="mechanicId" staff={staff.data ?? []} />
          </Field>
          <Field label={t("garage.appt.notes")}>
            <textarea name="notes" rows={2} maxLength={2000} className={inputCls} />
          </Field>
        </Card>

        {action.error && <ErrorNote message={action.error} />}
        <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} w-full`}>
          {action.busy && <Spinner />} {t("garage.appt.book")}
        </button>
      </form>
    </Panel>
  );
}
