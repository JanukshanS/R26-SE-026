"use client";

/**
 * Stocktakes. Start one for the whole shop, a category or an aisle; count by
 * scanning (each scan adds one) or by typing the number; see the differences
 * as you go; then post it to put the stock right. The shop can keep selling
 * while counting: each count remembers the stock at that moment.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Play, ScanBarcode, Send, X } from "lucide-react";

import { Badge, Card, CardHeader, Chip, Empty, ErrorNote, Field, Kpi, Loading, Progress, Spinner, btnDanger, btnPrimary, btnSecondary, btnSm, inputCls, useAction, useLoad, useMoney } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { cancelStocktake, enterCounts, getStocktake, listCategories, listStocktakes, lookupPart, postStocktake, startStocktake, type Shop, type Stocktake as Count } from "@/lib/partsApi";

import { useAccess } from "./access";

export default function Stocktake({ shop }: { shop: Shop }) {
  const t = useT();
  const { formatDate } = useI18n();
  const money = useMoney();
  const list = useLoad(listStocktakes, []);
  const [openId, setOpenId] = useState<string | null>(null);

  const current = list.data?.find((c) => c.status === "OPEN");
  const showing = openId ?? current?.id ?? null;

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;

  return (
    <div className="space-y-6">
      {showing ? (
        <Counting shop={shop} id={showing} onDone={() => { setOpenId(null); list.reload(); }} onBack={openId ? () => setOpenId(null) : undefined} />
      ) : (
        <StartCount onStarted={(c) => { list.reload(); setOpenId(c.id); }} />
      )}
      <Card className="p-0!">
        <div className="px-5 pt-4"><CardHeader title={t("shop.count.history")} /></div>
        {list.data.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{t("shop.count.none")}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {list.data.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-canvas">
                  <span className="w-10 font-mono text-muted-foreground">#{c.number}</span>
                  <span className="min-w-0 flex-1 truncate">{scopeLabel(c, t)} · {c.createdByName}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(c.postedAt ?? c.createdAt, { day: "numeric", month: "short" })}</span>
                  <Badge tone={c.status === "POSTED" ? "ok" : c.status === "OPEN" ? "info" : "gray"} dot={false}>{t(`shop.count.status.${c.status}`)}</Badge>
                  {c.varianceValue != null && c.status === "POSTED" && <span className={`w-28 text-right tabular-nums ${c.varianceValue < 0 ? "text-bad" : ""}`}>{money(c.varianceValue, shop.currency)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const scopeLabel = (c: Pick<Count, "category" | "location">, t: (k: string, v?: Record<string, string | number>) => string) =>
  [c.category, c.location ? t("shop.count.shelves", { loc: c.location }) : null].filter(Boolean).join(" · ") || t("shop.count.everything");

function StartCount({ onStarted }: { onStarted: (c: Count) => void }) {
  const t = useT();
  const action = useAction();
  const cats = useLoad(listCategories, []);
  const [scope, setScope] = useState({ category: "", location: "", note: "" });
  return (
    <Card className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-primary"><ClipboardList className="size-5" /></span>
        <div><h2 className="font-display text-lg font-bold">{t("shop.count.startTitle")}</h2><p className="text-sm text-muted-foreground">{t("shop.count.startBody")}</p></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("shop.inv.category")}>
          <select value={scope.category} onChange={(e) => setScope({ ...scope, category: e.target.value })} className={inputCls}>
            <option value="">{t("shop.count.allCategories")}</option>
            {(cats.data ?? []).map((c) => <option key={c.category} value={c.category}>{c.category} ({c.parts})</option>)}
          </select>
        </Field>
        <Field label={t("shop.count.location")} hint={t("shop.count.locationHint")}><input value={scope.location} onChange={(e) => setScope({ ...scope, location: e.target.value })} placeholder="A3" maxLength={60} className={inputCls} /></Field>
      </div>
      <input value={scope.note} onChange={(e) => setScope({ ...scope, note: e.target.value })} placeholder={t("shop.count.notePlaceholder")} maxLength={500} className={inputCls} />
      {action.error && <ErrorNote message={action.error} />}
      <button type="button" disabled={action.busy !== null} onClick={async () => { const c = await action.run("start", () => startStocktake({ category: scope.category || null, location: scope.location.trim() || null, note: scope.note.trim() || null })); if (c) onStarted(c); }} className={btnPrimary}>
        {action.busy === "start" ? <Spinner /> : <Play />} {t("shop.count.start")}
      </button>
    </Card>
  );
}

function Counting({ shop, id, onDone, onBack }: { shop: Shop; id: string; onDone: () => void; onBack?: () => void }) {
  const t = useT();
  const money = useMoney();
  const access = useAccess();
  const action = useAction();
  const count = useLoad(() => getStocktake(id), [id]);
  const [filter, setFilter] = useState<"all" | "todo" | "diff">("all");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [scan, setScan] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [zero, setZero] = useState(false);
  const scanBox = useRef<HTMLInputElement>(null);
  const c = count.data;
  const open = c?.status === "OPEN";
  const showCost = access.can("cost");

  useEffect(() => {
    if (open) scanBox.current?.focus();
  }, [open]);

  const rows = useMemo(() => (c ? c.lines.filter((l) => (filter === "todo" ? l.countedQty == null : filter === "diff" ? l.variance != null && l.variance !== 0 : true)) : []), [c, filter]);

  const locations = useMemo(() => (c ? [...new Map(c.lines.map((l) => [l.location.id, l.location.name])).entries()] : []), [c]);
  const [at, setAt] = useState("");

  /** Typed counts are keyed by line (a part at a location). */
  async function save(lines: { lineId?: string; partId: string; locationId?: string | null; countedQty: number | null }[]) {
    const next = await action.run("save", () => enterCounts(id, lines.map(({ partId, locationId, countedQty }) => ({ partId, locationId, countedQty }))));
    if (next) {
      count.setData(next);
      setTyped((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !lines.some((l) => l.lineId === k))));
    }
    return next;
  }

  async function onScan(code: string) {
    if (!c) return;
    const p = await lookupPart(code).catch(() => null);
    if (!p) {
      setFlash(t("shop.count.unknown", { code }));
      return;
    }
    // Counting at a chosen location, or the part's own line (its default location first).
    const mine = c.lines.filter((l) => l.part.id === p.id);
    const line = at ? mine.find((l) => l.location.id === at) : mine.find((l) => l.location.id === p.defaultLocationId) ?? mine[0];
    const next = (line?.countedQty ?? 0) + 1;
    const saved = await save([{ partId: p.id, locationId: at || line?.location.id || null, countedQty: next }]);
    if (saved) setFlash(t("shop.count.scanned", { name: p.name, n: next }) + (line ? ` · ${line.location.name}` : ""));
  }

  if (count.error) return <ErrorNote message={count.error} onRetry={count.reload} />;
  if (!c) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">{t("shop.count.title", { n: c.number })} <Badge tone={c.status === "POSTED" ? "ok" : c.status === "OPEN" ? "info" : "gray"} dot={false}>{t(`shop.count.status.${c.status}`)}</Badge></h2>
          <p className="text-sm text-muted-foreground">{scopeLabel(c, t)} · {c.createdByName}{c.note && ` · ${c.note}`}</p>
        </div>
        {onBack && <button type="button" onClick={onBack} className={`${btnSecondary} ${btnSm}`}><X /> {t("shop.count.back")}</button>}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi tone="brand" icon={ClipboardList} value={`${c.progress.counted} / ${c.progress.lines}`} label={t("shop.count.counted")} />
        <Kpi tone={c.progress.differences ? "warn" : "ok"} icon={ScanBarcode} value={c.progress.differences} label={t("shop.count.differences")} />
        {showCost && c.varianceValue != null && <Kpi tone={c.varianceValue < 0 ? "bad" : "ok"} icon={Send} value={money(c.varianceValue, shop.currency)} label={t("shop.count.varianceValue")} />}
      </div>
      <Progress value={c.progress.lines ? (c.progress.counted / c.progress.lines) * 100 : 0} />

      {open && (
        <Card className="space-y-3">
          {locations.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("shop.count.countingAt")}</span>
              <select value={at} onChange={(e) => setAt(e.target.value)} className={`${inputCls} w-auto! py-1.5!`}>
                <option value="">{t("shop.count.atDefault")}</option>
                {locations.map(([lid, name]) => <option key={lid} value={lid}>{name}</option>)}
              </select>
            </label>
          )}
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const code = scan.trim(); setScan(""); if (code) await onScan(code); scanBox.current?.focus(); }}>
            <div className="relative flex-1">
              <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input ref={scanBox} value={scan} onChange={(e) => setScan(e.target.value)} placeholder={t("shop.count.scanPlaceholder")} className={`${inputCls} pl-9`} />
            </div>
            <button type="submit" disabled={!scan.trim()} className={btnSecondary}>{t("shop.count.add")}</button>
          </form>
          {flash && <p className="text-sm text-muted-foreground">{flash}</p>}
        </Card>
      )}

      <Card className="p-0!">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <div className="flex gap-2">
            <Chip on={filter === "all"} onClick={() => setFilter("all")}>{t("shop.count.filterAll")}</Chip>
            <Chip on={filter === "todo"} onClick={() => setFilter("todo")}>{t("shop.count.filterTodo")}</Chip>
            <Chip on={filter === "diff"} onClick={() => setFilter("diff")}>{t("shop.count.filterDiff")}</Chip>
          </div>
          {open && Object.keys(typed).length > 0 && (
            <button type="button" disabled={action.busy !== null} onClick={() =>
                save(
                  Object.entries(typed).map(([lineId, v]) => {
                    const l = c.lines.find((x) => x.id === lineId)!;
                    return { lineId, partId: l.part.id, locationId: l.location.id, countedQty: v === "" ? null : Number(v) };
                  })
                )
              } className={`${btnPrimary} ${btnSm}`}>
              {action.busy === "save" && <Spinner />} {t("shop.count.saveN", { n: Object.keys(typed).length })}
            </button>
          )}
        </div>
        {rows.length === 0 ? <div className="p-5"><Empty title={t("shop.count.nothing")} /></div> : (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">{t("shop.inv.part")}</th>
                  <th className="px-3 py-2 font-medium">{t("shop.count.location")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("shop.count.expected")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("shop.count.countedCol")}</th>
                  <th className="px-5 py-2 text-right font-medium">{t("shop.count.variance")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-5 py-2"><span className="block font-medium">{l.part.name}</span><span className="block font-mono text-xs text-muted-foreground">{l.part.sku}{l.countedByName && ` · ${l.countedByName}`}</span></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{l.location.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{l.expectedQty}</td>
                    <td className="px-3 py-2 text-right">
                      {open ? (
                        <input type="number" min={0} step="1" value={typed[l.id] ?? (l.countedQty ?? "")} onChange={(e) => setTyped({ ...typed, [l.id]: e.target.value })} aria-label={t("shop.count.countedCol")} className={`${inputCls} ml-auto w-20! py-1! text-right ${typed[l.id] !== undefined ? "border-primary!" : ""}`} />
                      ) : (
                        <span className="tabular-nums">{l.countedQty ?? "—"}</span>
                      )}
                    </td>
                    <td className={`px-5 py-2 text-right font-medium tabular-nums ${l.variance == null || l.variance === 0 ? "text-muted-foreground" : l.variance < 0 ? "text-bad" : "text-ok"}`}>
                      {l.variance == null ? "—" : `${l.variance > 0 ? "+" : ""}${l.variance}`}
                      {showCost && l.varianceValue ? <span className="block text-xs">{money(l.varianceValue, shop.currency)}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <Card className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} className="size-4 accent-primary" /> {t("shop.count.zeroUncounted", { n: c.progress.lines - c.progress.counted })}</label>
          {action.error && <ErrorNote message={action.error} />}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={action.busy !== null || c.progress.counted === 0 || Object.keys(typed).length > 0} onClick={async () => (await action.run("post", () => postStocktake(id, zero))) && onDone()} className={btnPrimary}>
              {action.busy === "post" ? <Spinner /> : <Send />} {t("shop.count.post")}
            </button>
            <button type="button" disabled={action.busy !== null} onClick={async () => (await action.run("cancel", () => cancelStocktake(id))) && onDone()} className={btnDanger}>
              {action.busy === "cancel" ? <Spinner /> : <X />} {t("shop.count.cancel")}
            </button>
          </div>
          {Object.keys(typed).length > 0 && <p className="text-xs text-warn">{t("shop.count.unsaved")}</p>}
        </Card>
      )}
    </div>
  );
}
