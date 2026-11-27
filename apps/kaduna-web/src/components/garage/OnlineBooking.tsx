"use client";

/**
 * The owner's side of online booking: a card on the Appointments page with the
 * shareable link, and a panel with the rules (opening hours, slot length, bays,
 * notice, how far ahead, services).
 */
import { useState } from "react";
import { BellRing, CalendarClock, Copy, ExternalLink, Globe, MessageCircle, RefreshCw, Settings2 } from "lucide-react";

import {
  WEEKDAYS,
  bookingUrl,
  getBookingSettings,
  listAppointments,
  resetBookingLink,
  saveBookingSettings,
  type BookingConfig,
  type BookingSettings,
  type Garage,
  type Weekday,
} from "@/lib/garageApi";
import { useT } from "@/lib/i18n";

import { Badge, Card, ErrorNote, Field, Panel, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, useAction, useLoad } from "./ui";

const SLOT_CHOICES = [15, 30, 45, 60, 90, 120];
const LEAD_CHOICES = [0, 1, 2, 4, 12, 24, 48];

export default function OnlineBooking({ garage, onJumpTo }: { garage: Garage; onJumpTo?: (when: Date) => void }) {
  const t = useT();
  const config = useLoad(getBookingSettings, []);
  // Online bookings nobody has confirmed yet, wherever they fall in the diary.
  const fresh = useLoad(
    () =>
      listAppointments({ from: new Date().toISOString(), to: new Date(Date.now() + 90 * 86_400_000).toISOString(), status: "BOOKED" }).then((list) =>
        list.filter((a) => a.source === "ONLINE")
      ),
    []
  );
  const toConfirm = fresh.data ?? [];
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const c = config.data;
  const live = Boolean(c?.token && c.settings.enabled);
  const url = c?.token ? bookingUrl(c.token) : "";
  const message = t("garage.book.shareMessage", { garage: garage.name, url });

  if (config.error) return <ErrorNote message={config.error} onRetry={config.reload} />;

  return (
    <>
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${live ? "bg-ok-soft text-ok" : "bg-info-soft text-info"}`}>
          <Globe className="size-5" />
        </span>
        <div className="min-w-[min(100%,16rem)] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{t("garage.book.title")}</p>
            {c && <Badge tone={live ? "ok" : "gray"}>{live ? t("garage.book.on") : t("garage.book.off")}</Badge>}
          </div>
          {toConfirm.length > 0 && (
            <button
              type="button"
              onClick={() => onJumpTo?.(new Date(toConfirm[0]!.startsAt))}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn hover:brightness-95"
            >
              <BellRing className="size-3.5" /> {t("garage.book.toConfirm", { n: toConfirm.length })}
            </button>
          )}
          {live ? (
            <code className="mt-1 block truncate text-xs text-muted-foreground">{url}</code>
          ) : (
            <p className="text-sm text-muted-foreground">{t("garage.book.pitch")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {live && (
            <>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    window.prompt(t("garage.share.copy"), url);
                  }
                }}
                className={`${btnSecondary} ${btnSm}`}
              >
                <Copy /> {copied ? t("garage.share.copied") : t("garage.share.copy")}
              </button>
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className={`${btnSecondary} ${btnSm}`}>
                <MessageCircle /> WhatsApp
              </a>
              <a href={url} target="_blank" rel="noreferrer" className={`${btnSecondary} ${btnSm}`} aria-label={t("garage.share.open")}>
                <ExternalLink />
              </a>
            </>
          )}
          <button type="button" disabled={!c} onClick={() => setEditing(true)} className={`${live ? btnSecondary : btnPrimary} ${btnSm}`}>
            {live ? <Settings2 /> : <CalendarClock />} {live ? t("garage.book.settings") : t("garage.book.setUp")}
          </button>
        </div>
      </Card>

      <Panel open={editing} onClose={() => setEditing(false)} title={t("garage.book.title")} description={t("garage.book.panelSub")}>
        {c && (
          <SettingsForm
            config={c}
            busy={action.busy}
            error={action.error}
            onSave={async (settings) => {
              const next = await action.run("save", () => saveBookingSettings(settings));
              if (next) {
                config.setData(next);
                setEditing(false);
              }
            }}
            onReset={async () => {
              if (!window.confirm(t("garage.book.resetConfirm"))) return;
              const next = await action.run("reset", resetBookingLink);
              if (next) config.setData(next);
            }}
          />
        )}
      </Panel>
    </>
  );
}

function SettingsForm({
  config,
  busy,
  error,
  onSave,
  onReset,
}: {
  config: BookingConfig;
  busy: string | null;
  error: string | null;
  onSave: (s: BookingSettings) => void;
  onReset: () => void;
}) {
  const t = useT();
  const [s, setS] = useState<BookingSettings>(config.settings);
  const [services, setServices] = useState(config.settings.services.join("\n"));
  const set = <K extends keyof BookingSettings>(k: K, v: BookingSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const setDay = (d: Weekday, v: BookingSettings["hours"][Weekday]) => setS((prev) => ({ ...prev, hours: { ...prev.hours, [d]: v } }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...s,
          services: services
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 20),
          note: s.note?.trim() || null,
        });
      }}
    >
      <Card className="p-5">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} className="size-5 accent-primary" />
          <span>
            <span className="block font-semibold">{t("garage.book.enable")}</span>
            <span className="block text-xs text-muted-foreground">{t("garage.book.enableHint")}</span>
          </span>
        </label>
        {s.enabled && (
          <label className="mt-4 flex items-center gap-3 border-t border-border pt-4">
            <input type="checkbox" checked={s.listed ?? true} onChange={(e) => set("listed", e.target.checked)} className="size-5 accent-primary" />
            <span>
              <span className="block font-semibold">{t("garage.book.listed")}</span>
              <span className="block text-xs text-muted-foreground">{t("garage.book.listedHint")}</span>
            </span>
          </label>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="text-sm font-semibold">{t("garage.book.hours")}</h3>
        {WEEKDAYS.map((d) => {
          const h = s.hours[d];
          return (
            <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex w-28 items-center gap-2">
                <input type="checkbox" checked={h !== null} onChange={(e) => setDay(d, e.target.checked ? { open: "08:00", close: "17:00" } : null)} className="size-4 accent-primary" />
                {t(`garage.book.day.${d}`)}
              </label>
              {h ? (
                <>
                  <input type="time" value={h.open} onChange={(e) => setDay(d, { ...h, open: e.target.value })} aria-label={`${t(`garage.book.day.${d}`)} ${t("garage.book.opens")}`} className={`${inputCls} w-auto py-1.5`} />
                  <span className="text-muted-foreground">–</span>
                  <input type="time" value={h.close} onChange={(e) => setDay(d, { ...h, close: e.target.value })} aria-label={`${t(`garage.book.day.${d}`)} ${t("garage.book.closes")}`} className={`${inputCls} w-auto py-1.5`} />
                </>
              ) : (
                <span className="text-muted-foreground">{t("garage.book.closed")}</span>
              )}
            </div>
          );
        })}
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label={t("garage.book.slot")}>
          <select value={s.slotMinutes} onChange={(e) => set("slotMinutes", Number(e.target.value))} className={inputCls}>
            {SLOT_CHOICES.map((m) => (
              <option key={m} value={m}>
                {t("garage.book.minutes", { n: m })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("garage.book.capacity")} hint={t("garage.book.capacityHint")}>
          <input type="number" min={1} max={20} value={s.capacity} onChange={(e) => set("capacity", Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
        </Field>
        <Field label={t("garage.book.lead")}>
          <select value={s.leadHours} onChange={(e) => set("leadHours", Number(e.target.value))} className={inputCls}>
            {LEAD_CHOICES.map((h) => (
              <option key={h} value={h}>
                {h === 0 ? t("garage.book.leadNone") : t("garage.book.hoursN", { n: h })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("garage.book.ahead")}>
          <input type="number" min={1} max={90} value={s.daysAhead} onChange={(e) => set("daysAhead", Math.min(90, Math.max(1, Number(e.target.value) || 1)))} className={inputCls} />
        </Field>
      </Card>

      <Card className="space-y-3 p-5">
        <Field label={t("garage.book.services")} hint={t("garage.book.servicesHint")}>
          <textarea value={services} onChange={(e) => setServices(e.target.value)} rows={5} className={inputCls} />
        </Field>
        <Field label={t("garage.book.note")}>
          <textarea value={s.note ?? ""} onChange={(e) => set("note", e.target.value)} rows={2} maxLength={500} placeholder={t("garage.book.notePlaceholder")} className={inputCls} />
        </Field>
      </Card>

      {error && <ErrorNote message={error} />}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy !== null} className={`${btnPrimary} flex-1`}>
          {busy === "save" && <Spinner />} {t("garage.action.save")}
        </button>
        {config.token && (
          <button type="button" disabled={busy !== null} onClick={onReset} className={btnSecondary}>
            {busy === "reset" ? <Spinner /> : <RefreshCw />} {t("garage.share.reset")}
          </button>
        )}
      </div>
    </form>
  );
}
