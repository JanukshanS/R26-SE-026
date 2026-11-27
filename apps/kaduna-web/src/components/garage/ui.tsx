"use client";

/**
 * Building blocks for the garage workspace (/provider/garage). The look follows
 * the "Kaduna Garage" revamp in Figma: white rounded cards on a warm canvas,
 * pastel KPI tiles, dot badges, orange primary actions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useI18n, useT } from "@/lib/i18n";
import type { InvoiceStatus, JobStatus } from "@/lib/garageApi";

// ─── Buttons & inputs ────────────────────────────────────────────────────

const btnBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-[18px]";
export const btnPrimary = `${btnBase} bg-primary text-primary-foreground shadow-[0_8px_18px_-6px_rgba(236,85,0,.45)] hover:brightness-95`;
export const btnSecondary = `${btnBase} border border-border bg-white text-foreground hover:bg-canvas`;
export const btnSoft = `${btnBase} bg-brand-soft text-primary hover:brightness-[.98]`;
export const btnGhost = `${btnBase} text-muted-foreground hover:bg-canvas hover:text-foreground`;
export const btnDanger = `${btnBase} border border-bad/30 bg-white text-bad hover:bg-bad-soft`;
export const btnSm = "px-3! py-1.5! text-[13px]! rounded-lg!";
export const inputCls =
  "w-full rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25";

export function Spinner() {
  return <span aria-hidden className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]" />;
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

// ─── Surfaces ────────────────────────────────────────────────────────────

export function Card({ children, className = "", as: Tag = "section" }: { children: React.ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={`rounded-[20px] bg-white p-6 shadow-[0_4px_20px_rgba(41,31,24,.04)] ${className}`}>{children}</Tag>;
}

export function CardHeader({ title, sub, action }: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-lg font-semibold leading-6">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="rounded-2xl border border-bad/20 bg-bad-soft px-4 py-3 text-sm text-bad">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={`${btnDanger} ${btnSm} mt-2`}>
          {t("garage.action.retry")}
        </button>
      )}
    </div>
  );
}

export function Loading({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <div className={`rounded-[20px] bg-white p-8 text-center text-sm text-muted-foreground ${className}`}>
      <Spinner /> {t("garage.loading")}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border-2 border-dashed border-border bg-white/60 p-8 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─── Tones, badges, progress ─────────────────────────────────────────────

export type Tone = "brand" | "ok" | "info" | "vio" | "warn" | "bad" | "gray";

export const TONE: Record<Tone, { soft: string; solid: string; text: string; hex: string }> = {
  brand: { soft: "bg-brand-soft text-primary", solid: "bg-primary", text: "text-primary", hex: "#ec5500" },
  ok: { soft: "bg-ok-soft text-ok", solid: "bg-ok", text: "text-ok", hex: "#16a36a" },
  info: { soft: "bg-info-soft text-info", solid: "bg-info", text: "text-info", hex: "#2f6feb" },
  vio: { soft: "bg-vio-soft text-vio", solid: "bg-vio", text: "text-vio", hex: "#8b5cf6" },
  warn: { soft: "bg-warn-soft text-warn", solid: "bg-warn", text: "text-warn", hex: "#e89b00" },
  bad: { soft: "bg-bad-soft text-bad", solid: "bg-bad", text: "text-bad", hex: "#e5484d" },
  gray: { soft: "bg-muted text-muted-foreground", solid: "bg-muted-foreground", text: "text-muted-foreground", hex: "#a0938a" },
};

export function Badge({ tone, children, dot = true }: { tone: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium leading-none ${TONE[tone].soft}`}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const JOB_TONE: Record<JobStatus, Tone> = {
  OPEN: "info",
  IN_PROGRESS: "brand",
  WAITING_PARTS: "warn",
  READY: "ok",
  CLOSED: "gray",
  CANCELLED: "bad",
};

/** Rough share of the workflow a status represents, for progress bars. */
export const JOB_PROGRESS: Record<JobStatus, number> = {
  OPEN: 15,
  IN_PROGRESS: 55,
  WAITING_PARTS: 45,
  READY: 100,
  CLOSED: 100,
  CANCELLED: 0,
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const t = useT();
  return <Badge tone={JOB_TONE[status]}>{t(`garage.status.${status}`)}</Badge>;
}

const INVOICE_TONE: Record<InvoiceStatus, Tone> = { UNPAID: "warn", PAID: "ok", VOID: "gray" };

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const t = useT();
  return <Badge tone={INVOICE_TONE[status]}>{t(`garage.invoiceStatus.${status}`)}</Badge>;
}

export function SourceBadge({ source }: { source: "WALK_IN" | "KADUNA_DISPATCH" }) {
  const t = useT();
  return source === "KADUNA_DISPATCH" ? (
    <Badge tone="vio" dot={false}>Kaduna</Badge>
  ) : (
    <Badge tone="gray" dot={false}>{t("garage.source.walkIn")}</Badge>
  );
}

export function Progress({ value, tone = "brand", className = "" }: { value: number; tone?: Tone; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-muted ${className}`} role="presentation">
      <div className={`h-full rounded-full ${TONE[tone].solid}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name, tone = "brand", size = "md" }: { name: string | null | undefined; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const initials =
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "–";
  const dims = size === "sm" ? "size-7 text-[10px]" : size === "lg" ? "size-14 text-base" : "size-9 text-xs";
  return <span className={`grid shrink-0 place-items-center rounded-full font-semibold ${dims} ${TONE[tone].soft}`}>{initials}</span>;
}

const AVATAR_TONES: Tone[] = ["brand", "info", "vio", "ok", "warn"];
/** Stable colour per name, so a person keeps the same avatar everywhere. */
export function toneFor(name: string | null | undefined): Tone {
  let h = 0;
  for (const ch of name ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

// ─── KPI tiles ───────────────────────────────────────────────────────────

export function Kpi({ tone, icon: Icon, value, label, delta }: { tone: Tone; icon: LucideIcon; value: React.ReactNode; label: string; delta?: React.ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-2xl p-5 ${TONE[tone].soft.split(" ")[0]}`}>
      <span className={`mb-2.5 grid size-10 place-items-center rounded-full text-white ${TONE[tone].solid}`}>
        <Icon className="size-5" strokeWidth={1.9} />
      </span>
      <span className="truncate font-display text-2xl font-bold leading-8 tabular-nums text-foreground">{value}</span>
      <span className="text-sm font-medium leading-5 text-muted-foreground">{label}</span>
      {delta && <span className={`text-xs font-medium leading-4 ${TONE[tone].text}`}>{delta}</span>}
    </div>
  );
}

/** Kept for any older caller; new screens use <Kpi>. */
export function Stat({ label, value, tone = "" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_4px_20px_rgba(41,31,24,.04)]">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

// ─── Segmented control / chips ───────────────────────────────────────────

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex shrink-0 gap-1 rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3.5 py-1.5 text-[13px] font-medium transition [&_svg]:size-4 ${
            value === o.value ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${
        on ? "border-primary bg-brand-soft text-primary" : "border-border bg-white text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Charts (small, dependency-free SVG) ─────────────────────────────────

export type Series = { name: string; color: string; values: number[] };

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Overlay for a chart with nothing to plot yet. */
export function ChartEmpty({ show, message, children }: { show: boolean; message: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className={show ? "opacity-40" : ""}>{children}</div>
      {show && (
        <p className="absolute inset-0 grid place-items-center text-center text-sm text-muted-foreground">
          <span className="rounded-full bg-white px-3 py-1 shadow-sm">{message}</span>
        </p>
      )}
    </div>
  );
}

export function Legend({ series }: { series: { name: string; color: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium text-muted-foreground">
      {series.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

export function BarChart({ labels, series, format = (n) => String(n), height = 190, width = 420 }: { labels: string[]; series: Series[]; format?: (n: number) => string; height?: number; width?: number }) {
  const W = width, H = height, left = 44, bottom = 22, top = 8;
  const ph = H - bottom - top;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const groupW = (W - left) / Math.max(1, labels.length);
  const barW = Math.min(14, (groupW - 10) / series.length);
  // Keep x labels readable: about one per 26 px, always including the last.
  const every = Math.max(1, Math.ceil(labels.length / Math.floor((W - left) / 26)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {[0, 0.5, 1].map((f) => {
        const y = top + ph - ph * f;
        return (
          <g key={f}>
            <line x1={left} x2={W} y1={y} y2={y} stroke="var(--border)" strokeDasharray="4 4" />
            <text x={0} y={y + 4} fontSize={10} fill="var(--muted-foreground)">{format(max * f)}</text>
          </g>
        );
      })}
      {labels.map((lab, i) => {
        const gx = left + i * groupW + (groupW - barW * series.length - 3 * (series.length - 1)) / 2;
        return (
          <g key={lab + i}>
            {series.map((s, j) => {
              const h = (ph * (s.values[i] ?? 0)) / max;
              return <rect key={s.name} x={gx + j * (barW + 3)} y={top + ph - h} width={barW} height={Math.max(h, 0)} rx={4} fill={s.color}><title>{`${s.name}: ${format(s.values[i] ?? 0)}`}</title></rect>;
            })}
            {(i % every === 0 || i === labels.length - 1) && (
              <text x={left + i * groupW + groupW / 2} y={H - 4} fontSize={10} textAnchor="middle" fill="var(--muted-foreground)">{lab}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function smoothPath(pts: [number, number][]) {
  if (pts.length === 0) return "";
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2;
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export function LineChart({ labels, series, height = 180 }: { labels: string[]; series: Series[]; height?: number }) {
  const W = 400, H = height, left = 30, bottom = 22, top = 8;
  const ph = H - bottom - top, pw = W - left - 10;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i: number) => left + (pw * i) / Math.max(1, labels.length - 1);
  const y = (v: number) => top + ph - (ph * v) / max;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={left} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeDasharray="4 4" />
          <text x={0} y={y(max * f) + 4} fontSize={10} fill="var(--muted-foreground)">{Math.round(max * f)}</text>
        </g>
      ))}
      {labels.map((lab, i) =>
        i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1 ? (
          <text key={lab + i} x={x(i)} y={H - 4} fontSize={10} textAnchor="middle" fill="var(--muted-foreground)">{lab}</text>
        ) : null
      )}
      {series.map((s) => (
        <path key={s.name} d={smoothPath(s.values.map((v, i) => [x(i), y(v)]))} fill="none" stroke={s.color} strokeWidth={3} strokeLinecap="round" />
      ))}
    </svg>
  );
}

export function Donut({ parts, size = 110 }: { parts: { value: number; color: string }[]; size?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  let offset = 0;
  return (
    <svg viewBox="0 0 42 42" style={{ width: size, height: size }} className="-rotate-90 shrink-0" role="img">
      <circle cx={21} cy={21} r={15.9} fill="none" stroke="var(--muted)" strokeWidth={6} />
      {total > 0 &&
        parts.map((p, i) => {
          const pct = (p.value / total) * 100;
          const el = <circle key={i} cx={21} cy={21} r={15.9} fill="none" stroke={p.color} strokeWidth={6} strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-offset} />;
          offset += pct;
          return el;
        })}
    </svg>
  );
}

// ─── Money, panels, data hooks ───────────────────────────────────────────

/** Money with cents: invoices must add up exactly, unlike the rounded site-wide formatter. */
export function useMoney() {
  const { formatNumber } = useI18n();
  return useCallback(
    (n: number, currency = "LKR") => `${currency} ${formatNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [formatNumber]
  );
}

/** Compact money for tiles and chart axes: LKR 84.2k, LKR 1.9M. */
export function useShortMoney() {
  const { formatNumber } = useI18n();
  return useCallback(
    (n: number, currency = "LKR") => {
      const abs = Math.abs(n);
      const [v, s] = abs >= 1e6 ? [n / 1e6, "M"] : abs >= 1e3 ? [n / 1e3, "k"] : [n, ""];
      return `${currency} ${formatNumber(v, { maximumFractionDigits: s ? 1 : 0 })}${s}`;
    },
    [formatNumber]
  );
}

/** A right-hand panel for a record or a form. */
export function Panel({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className={`w-full gap-0 overflow-y-auto bg-canvas data-[side=right]:w-full ${wide ? "data-[side=right]:sm:max-w-3xl" : "data-[side=right]:sm:max-w-xl"}`}
      >
        <SheetHeader className="border-b border-border bg-white px-6 py-5 pr-14">
          <SheetTitle className="font-display text-xl font-bold">{title}</SheetTitle>
          {description && <SheetDescription asChild><div className="flex flex-wrap items-center gap-2">{description}</div></SheetDescription>}
        </SheetHeader>
        <div className="space-y-5 p-5 sm:p-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** Loads on mount and whenever `deps` change; `reload` refetches; stale responses are dropped. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    load().then(
      (value) => {
        if (mine !== seq.current) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (err: Error) => {
        if (mine !== seq.current) return;
        setError(err.message);
        setLoading(false);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/**
 * useLoad that keeps itself fresh. Every `every(data)` ms (null: don't) it
 * refetches quietly: no spinner, a failed refresh keeps what's on screen, and
 * unchanged data keeps the same object, so forms showing it aren't reset. It
 * pauses while the tab is hidden and refreshes as soon as it's back.
 */
export function useLiveLoad<T>(load: () => Promise<T>, deps: unknown[], every: (data: T | null) => number | null) {
  const base = useLoad(load, deps);
  const { data, setData } = base;
  const loadRef = useRef(load);
  loadRef.current = load;
  // A refresh started before the inputs changed must not overwrite the new result.
  const gen = useRef(0);
  useEffect(() => {
    gen.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const ms = every(data);

  useEffect(() => {
    if (!ms) return;
    let dead = false;
    let inFlight = false;
    const tick = () => {
      if (dead || inFlight || document.hidden) return;
      inFlight = true;
      const mine = gen.current;
      loadRef.current().then(
        (next) => {
          if (dead || mine !== gen.current) return;
          setData((prev) => (prev !== null && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        },
        () => {
          /* keep showing what we have; the next tick tries again */
        }
      ).finally(() => {
        inFlight = false;
      });
    };
    const id = setInterval(tick, ms);
    const back = () => !document.hidden && tick();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      dead = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [ms, setData]);

  return base;
}

/** How often live screens refresh: quickly while something is moving, slowly otherwise. */
export const LIVE_MS = { active: 15_000, idle: 120_000 } as const;

/** Runs one action at a time and keeps its error for display. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError((err as Error).message);
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, setError, run };
}

/** Form value helpers: blank inputs become null, numbers are parsed or null. */
export const text = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};
export const num = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Debounced copy of a value, for search boxes. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function vehicleLabel(v: { plate: string | null; make: string | null; model: string | null; year?: number | null } | null | undefined, fallback: string) {
  if (!v) return fallback;
  const name = [v.make, v.model, v.year].filter(Boolean).join(" ");
  return [v.plate, name].filter(Boolean).join(" · ") || fallback;
}

/** "Toyota Aqua 2015" without the plate, for card titles. */
export function vehicleName(v: { make: string | null; model: string | null; year?: number | null; plate?: string | null } | null | undefined, fallback: string) {
  if (!v) return fallback;
  // Only the plate known (a quick booking or a Kaduna job): show it rather than "not recorded".
  return [v.make, v.model, v.year].filter(Boolean).join(" ") || v.plate || fallback;
}
