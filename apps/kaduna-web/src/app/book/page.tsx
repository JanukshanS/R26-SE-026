"use client";

/**
 * A garage's booking page, from the link the garage shares (/book?g=…).
 * Pick a service, a day and a free time, leave a name and phone, done; no
 * account. After booking, the address becomes /book?a=…, the customer's own
 * link to look at or cancel the booking later.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarX2, Car, CheckCircle2, Clock, MapPin, Phone, Wrench } from "lucide-react";

import LanguagePicker from "@/components/LanguagePicker";
import { BrandLogo, brandColor } from "@/components/garage/InvoiceBrand";
import { Card, ErrorNote, Field, Loading, Spinner, btnSecondary, btnSm, inputCls } from "@/components/garage/ui";
import {
  GarageApiError,
  bookOnline,
  cancelPublicBooking,
  getBookingPage,
  getFreeSlots,
  getPublicBooking,
  type BookingPage,
  type DaySlots,
  type PublicBooking,
} from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

const CHUNK = 7;

export default function BookPage() {
  const t = useT();
  const [params, setParams] = useState<{ g: string | null; a: string | null } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setParams({ g: q.get("g"), a: q.get("a") });
  }, []);

  if (!params) return <Shell><Loading /></Shell>;
  if (params.a) return <Manage token={params.a} />;
  if (params.g) return <Book token={params.g} onBooked={(a) => setParams({ g: null, a })} />;
  return <Shell><ErrorNote message={t("book.noLink")} /></Shell>;
}

function Shell({ children, accent }: { children: React.ReactNode; accent?: string }) {
  const t = useT();
  return (
    <div className="min-h-screen bg-canvas text-foreground">
      <div className="h-1.5" style={{ background: accent ?? "var(--color-primary)" }} />
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-10">
        <div className="flex justify-end">
          <LanguagePicker />
        </div>
        {children}
        <p className="pb-4 text-center text-xs text-muted-foreground">
          {t("garage.inv.poweredBy")} <b className="font-display text-primary">Kaduna</b>
        </p>
      </div>
    </div>
  );
}

function GarageHeader({ garage }: { garage: BookingPage["garage"] }) {
  const t = useT();
  return (
    <header className="flex items-center gap-3">
      <BrandLogo brand={garage} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-bold">{garage.name}</p>
        {garage.address && (
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" /> {garage.address}
          </p>
        )}
      </div>
      {garage.phone && (
        <a href={`tel:${garage.phone}`} className={`${btnSecondary} ${btnSm}`}>
          <Phone /> {t("track.call")}
        </a>
      )}
    </header>
  );
}

function Book({ token, onBooked }: { token: string; onBooked: (manageToken: string) => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const [page, setPage] = useState<BookingPage | null>(null);
  const [days, setDays] = useState<DaySlots[]>([]);
  const [loadingDays, setLoadingDays] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  const loadMore = useCallback(
    async (from?: string) => {
      setLoadingDays(true);
      try {
        const next = await getFreeSlots(token, from, CHUNK);
        setDays((prev) => {
          const merged = [...prev.filter((d) => !next.some((n) => n.date === d.date)), ...next].sort((a, b) => a.date.localeCompare(b.date));
          return merged;
        });
        setDate((current) => current ?? next.find((d) => d.slots.some((s) => s.free > 0))?.date ?? null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoadingDays(false);
      }
    },
    [token]
  );

  useEffect(() => {
    getBookingPage(token).then(
      (p) => {
        setPage(p);
        if (p.services.length === 1) setService(p.services[0]!);
        if (p.enabled) loadMore();
      },
      (err) => setError(err instanceof GarageApiError && err.status === 404 ? t("book.notFound") : (err as Error).message)
    );
  }, [token, loadMore, t]);

  const day = days.find((d) => d.date === date) ?? null;
  const lastLoaded = days[days.length - 1]?.date;
  const canLoadMore = page && lastLoaded && days.length < page.daysAhead;
  const chosen = useMemo(() => day?.slots.find((s) => s.startsAt === startsAt) ?? null, [day, startsAt]);
  const accent = page ? brandColor(page.garage) : undefined;

  if (error) return <Shell><ErrorNote message={error} /></Shell>;
  if (!page) return <Shell><Loading /></Shell>;
  if (!page.enabled) {
    return (
      <Shell accent={accent}>
        <GarageHeader garage={page.garage} />
        <Card>
          <h1 className="font-display text-xl font-bold">{t("book.closedTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{page.garage.phone ? t("book.closedCall", { phone: page.garage.phone }) : t("book.closedBody")}</p>
        </Card>
      </Shell>
    );
  }

  async function submit(form: FormData) {
    if (!startsAt) return;
    setBusy(true);
    setBookError(null);
    try {
      const res = await bookOnline(token, {
        startsAt,
        service: service.trim(),
        name: String(form.get("name") ?? "").trim(),
        phone: String(form.get("phone") ?? "").trim(),
        plate: String(form.get("plate") ?? "").trim() || null,
        vehicle: String(form.get("vehicle") ?? "").trim() || null,
        notes: String(form.get("notes") ?? "").trim() || null,
        website: String(form.get("website") ?? ""),
      });
      window.history.replaceState(null, "", `/book?a=${encodeURIComponent(res.token)}`);
      onBooked(res.token);
    } catch (err) {
      setBookError((err as Error).message);
      // Someone may have taken the slot: show the latest availability.
      if (err instanceof GarageApiError && err.status === 409 && date) {
        setStartsAt(null);
        loadMore(date);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell accent={accent}>
      <GarageHeader garage={page.garage} />
      <div>
        <h1 className="font-display text-2xl font-bold">{t("book.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("book.sub", { garage: page.garage.name })}</p>
        {page.note && <p className="mt-3 rounded-xl bg-white px-4 py-3 text-sm">{page.note}</p>}
      </div>

      <Card>
        <Step n={1} title={t("book.stepService")} />
        {page.services.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {page.services.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={service === s}
                onClick={() => setService(s)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${service === s ? "border-transparent text-white" : "border-border bg-white hover:bg-canvas"}`}
                style={service === s ? { background: accent } : undefined}
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <input value={service} onChange={(e) => setService(e.target.value)} maxLength={160} placeholder={t("book.servicePlaceholder")} className={`${inputCls} mt-3`} />
        )}
      </Card>

      <Card>
        <Step n={2} title={t("book.stepTime")} />
        <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((d) => {
            const free = d.slots.filter((s) => s.free > 0).length;
            const on = d.date === date;
            return (
              <button
                key={d.date}
                type="button"
                disabled={free === 0}
                aria-pressed={on}
                onClick={() => {
                  setDate(d.date);
                  setStartsAt(null);
                }}
                className={`flex w-[72px] shrink-0 flex-col items-center rounded-2xl border px-2 py-2.5 text-center transition disabled:opacity-45 ${on ? "border-transparent text-white" : "border-border bg-white hover:bg-canvas"}`}
                style={on ? { background: accent } : undefined}
              >
                <span className="text-[11px] font-semibold uppercase">{formatDate(`${d.date}T00:00:00`, { weekday: "short" })}</span>
                <span className="font-display text-xl font-bold leading-7">{Number(d.date.slice(8))}</span>
                <span className={`text-[10px] ${on ? "opacity-90" : "text-muted-foreground"}`}>{!d.open ? t("book.closed") : free === 0 ? t("book.full") : formatDate(`${d.date}T00:00:00`, { month: "short" })}</span>
              </button>
            );
          })}
          {canLoadMore && (
            <button type="button" disabled={loadingDays} onClick={() => loadMore(nextDay(lastLoaded!))} className="flex w-[72px] shrink-0 items-center justify-center rounded-2xl border border-dashed border-border text-xs font-medium text-muted-foreground">
              {loadingDays ? <Spinner /> : t("book.moreDays")}
            </button>
          )}
        </div>

        {loadingDays && days.length === 0 ? (
          <Loading className="mt-3 p-4!" />
        ) : !days.some((d) => d.slots.some((s) => s.free > 0)) && !canLoadMore ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("book.noSlots")}</p>
        ) : day ? (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {day.slots.map((s) => {
              const on = s.startsAt === startsAt;
              return (
                <button
                  key={s.startsAt}
                  type="button"
                  disabled={s.free <= 0}
                  aria-pressed={on}
                  onClick={() => setStartsAt(s.startsAt)}
                  className={`rounded-xl border py-2.5 text-sm font-semibold tabular-nums transition disabled:cursor-not-allowed disabled:line-through disabled:opacity-40 ${on ? "border-transparent text-white" : "border-border bg-white hover:bg-canvas"}`}
                  style={on ? { background: accent } : undefined}
                >
                  {s.time}
                </button>
              );
            })}
            {day.slots.length === 0 && <p className="col-span-full text-sm text-muted-foreground">{t("book.dayFull")}</p>}
          </div>
        ) : null}
      </Card>

      <Card>
        <Step n={3} title={t("book.stepDetails")} />
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("book.name")}>
              <input name="name" required maxLength={160} autoComplete="name" className={inputCls} />
            </Field>
            <Field label={t("book.phone")}>
              <input name="phone" type="tel" required minLength={7} maxLength={40} autoComplete="tel" placeholder="07X XXX XXXX" className={inputCls} />
            </Field>
            <Field label={t("book.plate")}>
              <input name="plate" maxLength={20} placeholder="CAB-1234" className={`${inputCls} font-mono uppercase`} />
            </Field>
            <Field label={t("book.vehicle")}>
              <input name="vehicle" maxLength={120} placeholder="Toyota Aqua" className={inputCls} />
            </Field>
          </div>
          <Field label={t("book.notes")}>
            <textarea name="notes" rows={2} maxLength={1000} placeholder={t("book.notesPlaceholder")} className={inputCls} />
          </Field>
          {/* Spam trap: people never see or fill this. */}
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />

          {chosen && service && day && (
            <p className="flex items-center gap-2 rounded-xl bg-canvas px-4 py-3 text-sm">
              <CalendarCheck className="size-4 shrink-0" style={{ color: accent }} />
              <span>
                <b>{service}</b> · {formatDate(`${day.date}T00:00:00`, { weekday: "long", day: "numeric", month: "long" })} · {chosen.time}
              </span>
            </p>
          )}
          {bookError && <ErrorNote message={bookError} />}
          <button
            type="submit"
            disabled={busy || !startsAt || !service.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
            style={{ background: accent }}
          >
            {busy ? <Spinner /> : <CalendarCheck className="size-[18px]" />} {!service.trim() ? t("book.pickService") : !startsAt ? t("book.pickTime") : t("book.confirm")}
          </button>
          <p className="text-center text-xs text-muted-foreground">{t("book.privacy", { garage: page.garage.name })}</p>
        </form>
      </Card>
    </Shell>
  );
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function Step({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-2.5 font-display text-lg font-semibold">
      <span className="grid size-7 place-items-center rounded-full bg-foreground text-xs font-bold text-white">{n}</span>
      {title}
    </h2>
  );
}

function Manage({ token }: { token: string }) {
  const t = useT();
  const { formatDate } = useI18n();
  const [b, setB] = useState<PublicBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPublicBooking(token).then(setB, (err) => setError(err instanceof GarageApiError && err.status === 404 ? t("book.bookingNotFound") : (err as Error).message));
  }, [token, t]);

  if (error && !b) return <Shell><ErrorNote message={error} /></Shell>;
  if (!b) return <Shell><Loading /></Shell>;
  const accent = brandColor(b.garage);
  const cancelled = b.status === "CANCELLED";

  return (
    <Shell accent={accent}>
      <GarageHeader garage={b.garage} />
      <Card className="text-center">
        <span className={`mx-auto grid size-16 place-items-center rounded-full ${cancelled ? "bg-muted text-muted-foreground" : "text-white"}`} style={cancelled ? undefined : { background: accent }}>
          {cancelled ? <CalendarX2 className="size-8" /> : <CheckCircle2 className="size-8" />}
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold">{cancelled ? t("book.cancelledTitle") : t("book.confirmedTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{cancelled ? t("book.cancelledBody") : t("book.confirmedBody", { name: b.name?.split(" ")[0] ?? "" })}</p>

        <div className="mx-auto mt-6 max-w-sm space-y-3 rounded-2xl bg-canvas p-4 text-left text-sm">
          <Line icon={<Wrench className="size-4" />} text={b.service} />
          <Line icon={<Clock className="size-4" />} text={formatDate(b.startsAt, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} />
          {b.plate && <Line icon={<Car className="size-4" />} text={<span className="font-mono">{b.plate}</span>} />}
          {b.garage.address && <Line icon={<MapPin className="size-4" />} text={b.garage.address} />}
        </div>

        {!cancelled && <p className="mt-5 text-xs text-muted-foreground">{t("book.keepLink")}</p>}
        {error && <div className="mt-3 text-left"><ErrorNote message={error} /></div>}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {b.garage.phone && (
            <a href={`tel:${b.garage.phone}`} className={`${btnSecondary} ${btnSm}`}>
              <Phone /> {t("track.call")}
            </a>
          )}
          {b.cancellable && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(t("book.cancelConfirm"))) return;
                setBusy(true);
                setError(null);
                try {
                  setB(await cancelPublicBooking(token));
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className={`${btnSecondary} ${btnSm} text-bad!`}
            >
              {busy ? <Spinner /> : <CalendarX2 />} {t("book.cancel")}
            </button>
          )}
        </div>
      </Card>
    </Shell>
  );
}

function Line({ icon, text }: { icon: React.ReactNode; text: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="font-medium">{text}</span>
    </p>
  );
}
