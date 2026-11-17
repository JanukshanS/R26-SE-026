"use client";

/** Pieces of the job panel beyond the work itself: the timeline, the customer's tracking link, and choosing a mechanic. */
import { useState } from "react";
import { Copy, ExternalLink, Globe, Lock, MessageCircle, RefreshCw, Send, Smartphone } from "lucide-react";

import { listStaff, postJobUpdate, resetTracking, trackingUrl, type JobCard, type StaffMember } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import { Avatar, Card, ErrorNote, Field, JOB_TONE, Spinner, TONE, btnPrimary, btnSecondary, btnSm, inputCls, toneFor, useAction, useLoad } from "./ui";

/** The garage's mechanics, for pickers. Active ones only. */
export function useStaff(enabled = true) {
  return useLoad(() => (enabled ? listStaff().then((s) => s.filter((m) => m.active)) : Promise.resolve([] as StaffMember[])), [enabled]);
}

export function MechanicSelect({
  name,
  value,
  defaultValue = "",
  onChange,
  staff,
  className = "",
}: {
  name?: string;
  /** Controlled (with onChange), or leave it out and use defaultValue in a form. */
  value?: string;
  defaultValue?: string;
  onChange?: (id: string | null) => void;
  staff: StaffMember[];
  className?: string;
}) {
  const t = useT();
  return (
    <select
      name={name}
      value={value}
      defaultValue={value === undefined ? defaultValue : undefined}
      onChange={onChange ? (e) => onChange(e.target.value || null) : undefined}
      className={`${inputCls} ${className}`}
    >
      <option value="">{t("garage.staff.unassigned")}</option>
      {staff.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

export function Timeline({ job, onChanged }: { job: JobCard; onChanged: (job: JobCard) => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const action = useAction();
  const [note, setNote] = useState("");
  const [isPublic, setPublic] = useState(true);

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!note.trim()) return;
            const next = await action.run("post", () => postJobUpdate(job.id, { note: note.trim(), public: isPublic }));
            if (next) {
              setNote("");
              onChanged(next);
            }
          }}
        >
          <Field label={t("garage.timeline.addNote")}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder={t("garage.timeline.placeholder")} className={inputCls} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} className="size-4 accent-primary" />
              {t("garage.timeline.public")}
            </label>
            <button type="submit" disabled={action.busy !== null || !note.trim()} className={`${btnPrimary} ${btnSm} ml-auto`}>
              {action.busy ? <Spinner /> : <Send />} {t("garage.timeline.post")}
            </button>
          </div>
          {action.error && <ErrorNote message={action.error} />}
        </form>
      </Card>

      <Card className="p-5">
        <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-3.75 before:top-2 before:w-px before:bg-border">
          {job.updates.map((u) => {
            const tone = u.status ? JOB_TONE[u.status] : u.author === "Customer" ? "vio" : "gray";
            return (
              <li key={u.id} className="relative flex gap-3">
                <span className={`relative z-10 mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-white ${TONE[tone].soft}`}>
                  <span className={`size-2.5 rounded-full ${TONE[tone].solid}`} />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold">{u.status ? t("garage.timeline.movedTo", { status: t(`garage.status.${u.status}`) }) : u.author === "Customer" ? t("garage.timeline.customer") : t("garage.timeline.note")}</span>
                    {!u.public && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="size-3" /> {t("garage.timeline.private")}
                      </span>
                    )}
                  </div>
                  {u.note && <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{u.note}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(u.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    {u.author === "Customer" ? t("garage.timeline.byCustomer") : u.author ?? t("garage.timeline.byWorkshop")}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

/** The customer's live link: copy it, or send it on WhatsApp or by text, and reset it to revoke a link. */
export function ShareTracking({ job, garageName, canReset, onChanged }: { job: JobCard; garageName: string; canReset: boolean; onChanged: (job: JobCard) => void }) {
  const t = useT();
  const action = useAction();
  const [copied, setCopied] = useState(false);
  const url = trackingUrl(job.trackingToken);
  const message = t("garage.share.message", { garage: garageName, n: job.number, url });
  const phone = job.customer?.phone?.replace(/[^\d+]/g, "") ?? "";
  // wa.me wants the number in international form without "+": 077… → 9477….
  const waPhone = phone.startsWith("+") ? phone.slice(1) : phone.startsWith("0") ? `94${phone.slice(1)}` : phone;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-soft text-info">
          <Globe className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{t("garage.share.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("garage.share.body")}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-canvas px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
        <a href={url} target="_blank" rel="noreferrer" aria-label={t("garage.share.open")} className="text-muted-foreground hover:text-foreground">
          <ExternalLink className="size-4" />
        </a>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
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
        <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className={`${btnSecondary} ${btnSm}`}>
          <MessageCircle /> WhatsApp
        </a>
        <a href={`sms:${phone}?&body=${encodeURIComponent(message)}`} className={`${btnSecondary} ${btnSm}`}>
          <Smartphone /> {t("garage.share.sms")}
        </a>
        {canReset && (
          <button
            type="button"
            disabled={action.busy !== null}
            onClick={async () => {
              if (!window.confirm(t("garage.share.resetConfirm"))) return;
              const next = await action.run("reset", () => resetTracking(job.id));
              if (next) onChanged(next);
            }}
            className={`${btnSecondary} ${btnSm} ml-auto`}
          >
            {action.busy ? <Spinner /> : <RefreshCw />} {t("garage.share.reset")}
          </button>
        )}
      </div>
      {action.error && <div className="mt-2"><ErrorNote message={action.error} /></div>}
    </Card>
  );
}

export function MechanicChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Avatar name={name} tone={toneFor(name)} size="sm" />
      {name}
    </span>
  );
}
