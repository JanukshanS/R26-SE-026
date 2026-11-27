"use client";

/**
 * A customer's live view of their car at the garage, opened from the link the
 * garage sends (/track?t=…). No sign-in: the token is the key. Shows progress,
 * the inspection report with approve / decline for recommended work, the work
 * and price so far, and the garage's updates. Refreshes every 30 seconds.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Car, Check, CheckCircle2, CircleAlert, Clock, Phone, ThumbsDown, ThumbsUp, Wrench } from "lucide-react";

import LanguagePicker from "@/components/LanguagePicker";
import { BrandLogo, brandColor } from "@/components/garage/InvoiceBrand";
import { Badge, Card, ErrorNote, Loading, Spinner, btnSecondary, btnSm, useMoney, vehicleName, type Tone } from "@/components/garage/ui";
import { decideInspectionItem, getTracking, GarageApiError, type JobStatus, type Tracking } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

/** The customer's four steps; WAITING_PARTS is still "working on it". */
const STEPS = ["checkedIn", "working", "ready", "collected"] as const;
const STEP_OF: Record<JobStatus, number> = { OPEN: 0, IN_PROGRESS: 1, WAITING_PARTS: 1, READY: 2, CLOSED: 3, CANCELLED: -1 };
const RESULT_TONE: Record<"OK" | "ATTENTION" | "URGENT", Tone> = { OK: "ok", ATTENTION: "warn", URGENT: "bad" };

export default function TrackPage() {
  const t = useT();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setToken(new URLSearchParams(window.location.search).get("t")), []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await getTracking(token));
      setError(null);
    } catch (err) {
      setError(err instanceof GarageApiError && err.status === 404 ? t("track.notFound") : (err as Error).message);
    }
  }, [token, t]);

  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (token === undefined) return <Shell><Loading /></Shell>;
  if (!token) return <Shell><ErrorNote message={t("track.noToken")} /></Shell>;
  if (!data) return <Shell>{error ? <ErrorNote message={error} onRetry={load} /> : <Loading />}</Shell>;
  return <TrackView token={token} data={data} onChange={setData} />;
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

function TrackView({ token, data, onChange }: { token: string; data: Tracking; onChange: (d: Tracking) => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { garage: g, job } = data;
  const accent = brandColor(g);
  const step = STEP_OF[job.status];
  const items = data.inspection?.items ?? [];
  const toDecide = items.filter((i) => i.approval !== null);
  const pending = toDecide.filter((i) => i.approval === "PENDING");
  const findings = items.filter((i) => i.result !== "OK");
  const okCount = items.length - findings.length;
  const tax = Math.round(data.subtotal * g.taxRate) / 100;
  const when = (iso: string) => formatDate(iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  async function decide(itemId: string, decision: "APPROVED" | "DECLINED") {
    setBusy(itemId);
    setError(null);
    try {
      onChange(await decideInspectionItem(token, itemId, decision));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell accent={accent}>
      <header className="flex items-center gap-3">
        <BrandLogo brand={g} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-bold">{g.name}</p>
          {g.address && <p className="truncate text-xs text-muted-foreground">{g.address}</p>}
        </div>
        {g.phone && (
          <a href={`tel:${g.phone}`} className={`${btnSecondary} ${btnSm}`}>
            <Phone /> {t("track.call")}
          </a>
        )}
      </header>

      <Card>
        <div className="flex items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl text-white" style={{ background: accent }}>
            <Car className="size-7" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{job.customerName ? t("track.hello", { name: job.customerName }) : t("track.yourCar")}</p>
            <h1 className="font-display text-2xl font-bold leading-tight">{vehicleName(job.vehicle, t("track.yourCar"))}</h1>
            <p className="text-sm text-muted-foreground">
              {job.vehicle?.plate && <span className="font-mono">{job.vehicle.plate} · </span>}
              {t("track.jobNo", { n: job.number })}
            </p>
          </div>
        </div>

        <ol className="mt-6 grid grid-cols-4 gap-2">
          {STEPS.map((s, i) => (
            <li key={s}>
              <div className="h-1.5 rounded-full" style={{ background: i <= step ? (i === step && job.status === "WAITING_PARTS" ? "var(--color-warn)" : accent) : "var(--muted)" }} />
              <p className={`mt-2 text-[11px] font-semibold leading-tight sm:text-xs ${i <= step ? "text-foreground" : "text-muted-foreground"}`}>{t(`track.step.${s}`)}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm font-medium">{t(`track.status.${job.status}`)}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {job.promisedAt && job.status !== "CLOSED" && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> {t("track.promised", { when: when(job.promisedAt) })}
            </span>
          )}
          {job.mechanicName && (
            <span className="inline-flex items-center gap-1">
              <Wrench className="size-3.5" /> {t("track.mechanic", { name: job.mechanicName })}
            </span>
          )}
        </div>
      </Card>

      {toDecide.length > 0 && (
        <Card className={pending.length ? "ring-2 ring-warn/40" : ""}>
          <h2 className="font-display text-lg font-semibold">{pending.length ? t("track.approveTitle", { n: pending.length }) : t("track.decisionsTitle")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("track.approveBody")}</p>
          {error && <div className="mt-3"><ErrorNote message={error} /></div>}
          <ul className="mt-4 space-y-3">
            {toDecide.map((i) => (
              <li key={i.id} className="rounded-2xl border border-border p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{i.name}</p>
                    {i.note && <p className="mt-0.5 text-sm text-muted-foreground">{i.note}</p>}
                  </div>
                  <Badge tone={RESULT_TONE[i.result]}>{t(`garage.insp.result.${i.result}`)}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="mr-auto font-display text-lg font-bold tabular-nums">{i.estimate != null ? money(i.estimate, g.currency) : "—"}</span>
                  {i.inJob ? (
                    <Badge tone="ok">{t("track.inProgress")}</Badge>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => decide(i.id, "DECLINED")}
                        aria-pressed={i.approval === "DECLINED"}
                        className={`${btnSecondary} ${btnSm} ${i.approval === "DECLINED" ? "border-foreground! bg-muted!" : ""}`}
                      >
                        {busy === i.id ? <Spinner /> : <ThumbsDown />} {i.approval === "DECLINED" ? t("track.declined") : t("track.decline")}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => decide(i.id, "APPROVED")}
                        aria-pressed={i.approval === "APPROVED"}
                        className={
                          i.approval === "DECLINED"
                            ? `${btnSecondary} ${btnSm}`
                            : "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60 [&_svg]:size-[18px]"
                        }
                        style={i.approval === "DECLINED" ? undefined : { background: accent }}
                      >
                        {i.approval === "APPROVED" ? <Check /> : <ThumbsUp />} {i.approval === "APPROVED" ? t("track.approved") : t("track.approve")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.inspection && (
        <Card>
          <h2 className="font-display text-lg font-semibold">{t("track.reportTitle")}</h2>
          {data.inspection.summary && <p className="mt-1 whitespace-pre-line text-sm">{data.inspection.summary}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="ok">{t("track.okCount", { n: okCount })}</Badge>
            {findings.filter((i) => i.result === "ATTENTION").length > 0 && <Badge tone="warn">{t("track.attentionCount", { n: findings.filter((i) => i.result === "ATTENTION").length })}</Badge>}
            {findings.filter((i) => i.result === "URGENT").length > 0 && <Badge tone="bad">{t("track.urgentCount", { n: findings.filter((i) => i.result === "URGENT").length })}</Badge>}
          </div>
          <ul className="mt-4 divide-y divide-border text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 py-2.5">
                {i.result === "OK" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
                ) : i.result === "URGENT" ? (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{i.name}</span>
                  <span className="text-muted-foreground"> · {i.category}</span>
                  {i.note && i.approval === null && <span className="block text-xs text-muted-foreground">{i.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(data.items.length > 0 || data.invoice) && (
        <Card>
          <h2 className="font-display text-lg font-semibold">{data.invoice ? t("track.invoiceTitle", { n: data.invoice.number }) : t("track.workTitle")}</h2>
          {!data.invoice && <p className="mt-0.5 text-xs text-muted-foreground">{t("track.workSub")}</p>}
          <ul className="mt-4 space-y-2 text-sm">
            {data.items.map((i, n) => (
              <li key={n} className="flex gap-3">
                <span className="min-w-0 flex-1">
                  {i.description}
                  {i.quantity !== 1 && <span className="text-muted-foreground"> × {i.quantity}</span>}
                </span>
                <span className="tabular-nums">{money(i.lineTotal, g.currency)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm tabular-nums">
            {data.invoice ? (
              <>
                {data.invoice.tax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("garage.invoice.tax")}</span>
                    <span>{money(data.invoice.tax, g.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between font-display text-lg font-bold">
                  <span>{t("garage.invoice.total")}</span>
                  <span>{money(data.invoice.total, g.currency)}</span>
                </div>
                <p className={`text-sm font-medium ${data.invoice.status === "PAID" ? "text-ok" : "text-warn"}`}>
                  {data.invoice.status === "PAID" ? t("track.paid", { when: when(data.invoice.paidAt!) }) : t("track.payOnCollection")}
                </p>
              </>
            ) : (
              <>
                {g.taxRate > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("garage.job.taxEstimate", { rate: g.taxRate })}</span>
                    <span>{money(tax, g.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between font-display text-lg font-bold">
                  <span>{t("track.soFar")}</span>
                  <span>{money(data.subtotal + tax, g.currency)}</span>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      <Card>
        <h2 className="font-display text-lg font-semibold">{t("track.updatesTitle")}</h2>
        {job.complaint && (
          <p className="mt-2 rounded-xl bg-canvas px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t("track.youToldUs")} </span>
            <span className="whitespace-pre-line">{job.complaint}</span>
          </p>
        )}
        <ol className="mt-4 space-y-4">
          {data.updates.map((u) => (
            <li key={u.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: u.status ? accent : "var(--color-muted-foreground)" }} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{u.status ? t(`track.status.${u.status}`) : u.note}</p>
                {u.status && u.note && <p className="text-muted-foreground">{u.note}</p>}
                <p className="text-xs text-muted-foreground">
                  {when(u.createdAt)}
                  {u.author && ` · ${u.author === "You" ? t("track.you") : u.author}`}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </Shell>
  );
}
