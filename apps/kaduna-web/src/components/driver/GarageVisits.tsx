"use client";

/**
 * The member's car at garages. Any garage on Kaduna that opens a job card or a
 * booking for one of their plates shows up here by itself: live status, who's
 * on it, approvals waiting, the invoice, and the full tracking page. They can
 * also book any garage that takes online bookings, for the selected car.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarClock, CalendarPlus, CheckCircle2, ClipboardCheck, ExternalLink, History, MapPin, Phone, Receipt, Search, Warehouse, Wrench } from "lucide-react";

import {
  Badge,
  Card,
  CardHeader,
  Chip,
  Empty,
  ErrorNote,
  Field,
  JobStatusBadge,
  JOB_PROGRESS,
  JOB_TONE,
  Loading,
  Panel,
  Progress,
  Spinner,
  btnPrimary,
  btnSecondary,
  btnSm,
  inputCls,
  useAction,
  useDebounced,
  useLoad,
  useMoney,
} from "@/components/garage/ui";
import { cancelPublicBooking, isFinished } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";
import { bookGarage, compactPlate, getBookableGarage, getBookableSlots, listBookableGarages, type DirectoryGarage, type GarageBooking, type GarageRepair } from "@/lib/ownerApi";
import { vehicleModelLine, vehicleTitle, type Vehicle } from "@/lib/vehicleApi";

import { PlateTag, timeAgo, type DriverData } from "./shared";

/** Visits for the selected car, or for all of them. */
function useScoped(data: DriverData, all: boolean) {
  const v = data.visits.data;
  const plate = compactPlate(data.selected?.plateNumber);
  return useMemo(() => {
    const keep = (p: string | null) => all || compactPlate(p) === plate;
    return {
      active: (v?.repairs ?? []).filter((r) => !isFinished(r.status) && keep(r.plate)),
      history: (v?.repairs ?? []).filter((r) => isFinished(r.status) && keep(r.plate)),
      bookings: (v?.bookings ?? []).filter((b) => keep(b.plate)),
    };
  }, [v, plate, all]);
}

export default function GarageVisits({ data, bookOpen, onBookOpen }: { data: DriverData; bookOpen: boolean; onBookOpen: (open: boolean) => void }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const { active, history, bookings } = useScoped(data, all);
  const many = (data.vehicles.data?.length ?? 0) > 1;

  // A failed background refresh keeps the last good view.
  if (data.visits.error && !data.visits.data) return <ErrorNote message={data.visits.error} onRetry={data.visits.reload} />;
  if (!data.visits.data || !data.vehicles.data) return <Loading />;
  if (data.vehicles.data.length === 0) return <Empty title={t("me.vehicles.emptyTitle")} body={t("me.garage.noVehicles")} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {many && (
          <>
            <Chip on={!all} onClick={() => setAll(false)}>{data.selected ? vehicleTitle(data.selected) : t("me.garage.thisCar")}</Chip>
            <Chip on={all} onClick={() => setAll(true)}>{t("me.garage.allCars")}</Chip>
          </>
        )}
        <button type="button" onClick={() => onBookOpen(true)} className={`${btnPrimary} ${btnSm} ml-auto md:hidden`}>
          <CalendarPlus /> {t("me.garage.book")}
        </button>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{t("me.garage.atGarage")}</h2>
        {active.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-ok-soft text-ok"><CheckCircle2 className="size-6" /></span>
            <p className="font-medium">{t("me.garage.noneActive")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("me.garage.noneActiveBody")}</p>
          </Card>
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {active.map((r) => (
              <RepairCard key={r.id} repair={r} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">{t("me.garage.upcoming")}</h2>
          <button type="button" onClick={() => onBookOpen(true)} className={`${btnSecondary} ${btnSm} hidden md:inline-flex`}>
            <CalendarPlus /> {t("me.garage.book")}
          </button>
        </div>
        {bookings.length === 0 ? (
          <Empty title={t("me.garage.noBookings")} body={t("me.garage.noBookingsBody")} action={<button type="button" onClick={() => onBookOpen(true)} className={btnPrimary}><CalendarPlus /> {t("me.garage.book")}</button>} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {bookings.map((b) => (
              <BookingCard key={b.id} booking={b} onChanged={data.visits.reload} />
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">{t("me.garage.history")}</h2>
          <Card className="p-0!">
            <ul className="divide-y divide-border">
              {history.map((r) => (
                <HistoryRow key={r.id} repair={r} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      <BookGaragePanel data={data} open={bookOpen} onClose={() => onBookOpen(false)} onBooked={() => { onBookOpen(false); data.visits.reload(); }} />
    </div>
  );
}

const trackHref = (r: GarageRepair) => `/track?t=${encodeURIComponent(r.trackingToken)}`;

export function RepairCard({ repair: r, compact = false }: { repair: GarageRepair; compact?: boolean }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  return (
    <Card as="article" className={`flex flex-col gap-4 ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-vio-soft text-vio"><Warehouse className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold">{r.garage.name}</p>
          <p className="text-xs text-muted-foreground">
            {t("garage.job.title", { n: r.jobNumber })}
            {r.plate && ` · ${r.plate}`}
            {r.mechanicName && ` · ${t("me.garage.mechanic", { name: r.mechanicName })}`}
          </p>
        </div>
        <JobStatusBadge status={r.status} />
      </div>
      <Progress value={JOB_PROGRESS[r.status]} tone={JOB_TONE[r.status]} />
      {r.complaint && <p className="text-sm text-muted-foreground">{r.complaint}</p>}
      {r.lastUpdate?.note && (
        <p className="rounded-xl bg-canvas px-3 py-2 text-sm">
          {r.lastUpdate.note} <span className="text-xs text-muted-foreground">· {timeAgo(r.lastUpdate.createdAt, t)}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {r.promisedAt && (
          <span className="flex items-center gap-1.5"><CalendarClock className="size-4 text-muted-foreground" /> {t("me.repair.promised", { date: formatDate(r.promisedAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}</span>
        )}
        {r.invoice && (
          <span className="flex items-center gap-1.5"><Receipt className="size-4 text-muted-foreground" /> {money(r.invoice.total)} · {r.invoice.status === "PAID" ? t("me.garage.paid") : t("me.garage.toPay")}</span>
        )}
      </div>
      {r.approvalsWaiting > 0 && (
        <Link href={trackHref(r)} className="flex items-center gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <ClipboardCheck className="size-5 shrink-0" />
          <span className="flex-1 font-medium">{t("me.garage.approvals", { count: r.approvalsWaiting })}</span>
          <ArrowRight className="size-4" />
        </Link>
      )}
      {r.status === "READY" && <p className="flex items-center gap-2 rounded-xl bg-ok-soft px-3 py-2 text-sm font-medium text-ok"><CheckCircle2 className="size-4" /> {t("me.garage.ready")}</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        <Link href={trackHref(r)} className={`${btnPrimary} ${btnSm}`}>
          {t("me.garage.follow")} <ExternalLink />
        </Link>
        {r.garage.phone && <a href={`tel:${r.garage.phone}`} className={`${btnSecondary} ${btnSm}`}><Phone /> {t("me.garage.call")}</a>}
      </div>
    </Card>
  );
}

function BookingCard({ booking: b, onChanged }: { booking: GarageBooking; onChanged: () => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const action = useAction();
  return (
    <Card as="article" className="flex flex-col gap-3 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-info-soft text-info"><CalendarClock className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold">{formatDate(b.startsAt, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
          <p className="truncate text-sm text-muted-foreground">{b.service} · {b.garage.name}</p>
        </div>
        <Badge tone={b.status === "CONFIRMED" ? "ok" : "info"}>{t(`garage.appt.status.${b.status}`)}</Badge>
      </div>
      {b.garage.address && <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="size-4 shrink-0" /> {b.garage.address}</p>}
      {action.error && <ErrorNote message={action.error} />}
      <div className="mt-auto flex flex-wrap gap-2">
        {b.garage.phone && <a href={`tel:${b.garage.phone}`} className={`${btnSecondary} ${btnSm}`}><Phone /> {t("me.garage.call")}</a>}
        {b.cancellable && b.manageToken && (
          <button
            type="button"
            disabled={action.busy !== null}
            onClick={async () => {
              if (!window.confirm(t("me.garage.cancelConfirm"))) return;
              if (await action.run("cancel", () => cancelPublicBooking(b.manageToken!))) onChanged();
            }}
            className={`${btnSecondary} ${btnSm}`}
          >
            {action.busy === "cancel" && <Spinner />} {t("me.garage.cancel")}
          </button>
        )}
      </div>
    </Card>
  );
}

function HistoryRow({ repair: r }: { repair: GarageRepair }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  return (
    <li>
      <Link href={trackHref(r)} className="flex items-center gap-3 px-5 py-3 transition hover:bg-canvas">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><History className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{r.garage.name} · {t("garage.job.title", { n: r.jobNumber })}</span>
          <span className="block truncate text-xs text-muted-foreground">{[r.complaint, r.plate].filter(Boolean).join(" · ") || "—"}</span>
        </span>
        <span className="shrink-0 text-right text-xs text-muted-foreground">
          {r.closedAt && <span className="block">{formatDate(r.closedAt, { day: "numeric", month: "short", year: "numeric" })}</span>}
          {r.invoice && <span className="block font-medium text-foreground">{money(r.invoice.total)}</span>}
        </span>
      </Link>
    </li>
  );
}

// ─── Booking a garage ────────────────────────────────────────────────────

function BookGaragePanel({ data, open, onClose, onBooked }: { data: DriverData; open: boolean; onClose: () => void; onBooked: () => void }) {
  const t = useT();
  const [garage, setGarage] = useState<DirectoryGarage | null>(null);
  useEffect(() => {
    if (!open) setGarage(null);
  }, [open]);
  return (
    <Panel
      wide
      open={open}
      onClose={onClose}
      title={garage ? garage.name : t("me.garage.book")}
      description={data.selected ? <PlateTag plate={data.selected.plateNumber} /> : undefined}
    >
      {!garage ? <PickGarage onPick={setGarage} /> : <BookSlot garage={garage} vehicle={data.selected} data={data} onBack={() => setGarage(null)} onBooked={onBooked} />}
    </Panel>
  );
}

function PickGarage({ onPick }: { onPick: (g: DirectoryGarage) => void }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const list = useLoad(() => listBookableGarages(q || undefined), [q]);
  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("me.garage.search")} className={`${inputCls} pl-9`} autoFocus />
      </div>
      {list.error ? (
        <ErrorNote message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <Empty title={q ? t("me.garage.noMatch") : t("me.garage.noGarages")} body={t("me.garage.noGaragesBody")} />
      ) : (
        <div className="space-y-3">
          {list.data.map((g) => (
            <button key={g.id} type="button" onClick={() => onPick(g)} className="flex w-full items-start gap-3 rounded-2xl border border-border bg-white p-4 text-left transition hover:border-primary/40 hover:bg-canvas">
              {g.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.logoUrl} alt="" className="size-11 shrink-0 rounded-2xl object-contain" />
              ) : (
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary"><Wrench className="size-5" /></span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-display font-semibold">{g.name}</span>
                {g.address && <span className="block truncate text-sm text-muted-foreground">{g.address}</span>}
                {g.services.length > 0 && <span className="mt-1 block truncate text-xs text-muted-foreground">{g.services.slice(0, 5).join(" · ")}</span>}
              </span>
              <ArrowRight className="mt-3 size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function BookSlot({ garage, vehicle, data, onBack, onBooked }: { garage: DirectoryGarage; vehicle: Vehicle | null; data: DriverData; onBack: () => void; onBooked: () => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const action = useAction();
  const page = useLoad(() => getBookableGarage(garage.id), [garage.id]);
  const slots = useLoad(() => getBookableSlots(garage.id, undefined, 14), [garage.id]);
  const [day, setDay] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [service, setService] = useState("");
  const [notes, setNotes] = useState("");
  const profile = data.profile.data;
  const [name, setName] = useState(profile?.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");

  const days = (slots.data ?? []).filter((d) => d.open && d.slots.some((s) => s.free > 0));
  useEffect(() => {
    if (!day && days[0]) setDay(days[0].date);
  }, [days, day]);
  useEffect(() => {
    if (page.data?.services.length && !service) setService(page.data.services[0]);
  }, [page.data, service]);

  if (!vehicle) return <Empty title={t("me.vehicles.emptyTitle")} body={t("me.garage.noVehicles")} />;
  if (page.error) return <ErrorNote message={page.error} onRetry={page.reload} />;
  if (!page.data || !slots.data) return <Loading />;

  const today = days.find((d) => d.date === day);
  const fixed = page.data.services.length > 0;

  async function submit() {
    const done = await action.run("book", () =>
      bookGarage(garage.id, {
        startsAt: startsAt!,
        service: service.trim(),
        plate: vehicle!.plateNumber,
        vehicle: vehicleModelLine(vehicle!),
        name: name.trim(),
        phone: phone.trim(),
        notes: notes.trim() || null,
      })
    );
    if (done) onBooked();
  }

  return (
    <>
      <button type="button" onClick={onBack} className="text-sm font-medium text-primary hover:underline">← {t("me.garage.otherGarage")}</button>
      {(garage.address || page.data.note) && (
        <Card className="space-y-1 p-4 text-sm">
          {garage.address && <p className="flex items-center gap-1.5"><MapPin className="size-4 text-muted-foreground" /> {garage.address}</p>}
          {page.data.note && <p className="text-muted-foreground">{page.data.note}</p>}
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <Field label={t("me.garage.service")}>
          {fixed ? (
            <div className="flex flex-wrap gap-2">
              {page.data.services.map((s) => (
                <Chip key={s} on={service === s} onClick={() => setService(s)}>{s}</Chip>
              ))}
            </div>
          ) : (
            <input value={service} onChange={(e) => setService(e.target.value)} maxLength={160} placeholder={t("me.garage.servicePlaceholder")} className={inputCls} />
          )}
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("me.garage.day")}</p>
          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("me.garage.noSlots")}</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => { setDay(d.date); setStartsAt(null); }}
                  aria-pressed={day === d.date}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-center text-sm transition ${day === d.date ? "border-primary bg-brand-soft text-primary" : "border-border bg-white hover:bg-canvas"}`}
                >
                  <span className="block text-xs">{formatDate(`${d.date}T12:00:00Z`, { weekday: "short" })}</span>
                  <span className="block font-semibold">{formatDate(`${d.date}T12:00:00Z`, { day: "numeric", month: "short" })}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {today && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("me.garage.time")}</p>
            <div className="flex flex-wrap gap-2">
              {today.slots.filter((s) => s.free > 0).map((s) => (
                <Chip key={s.startsAt} on={startsAt === s.startsAt} onClick={() => setStartsAt(s.startsAt)}>{s.time}</Chip>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-3 rounded-xl bg-canvas px-3 py-2 text-sm">
          <PlateTag plate={vehicle.plateNumber} />
          <span className="truncate">{vehicleTitle(vehicle)}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("me.garage.yourName")}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} className={inputCls} />
          </Field>
          <Field label={t("garage.field.phone")}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" className={inputCls} />
          </Field>
        </div>
        <Field label={t("me.garage.notes")}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder={t("me.garage.notesPlaceholder")} className={inputCls} />
        </Field>
      </Card>

      {action.error && <ErrorNote message={action.error} />}
      <button
        type="button"
        disabled={action.busy !== null || !startsAt || !service.trim() || !name.trim() || phone.trim().length < 7}
        onClick={submit}
        className={`${btnPrimary} w-full`}
      >
        {action.busy === "book" ? <Spinner /> : <CalendarPlus />} {startsAt ? t("me.garage.confirm", { when: formatDate(startsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }) : t("me.garage.pickTime")}
      </button>
    </>
  );
}
