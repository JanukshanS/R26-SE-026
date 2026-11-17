"use client";

/**
 * Stocktake: count what is actually on the shelf, see the differences against
 * the books, and correct stock to match. Every count is kept, with what was
 * expected next to what was found.
 */
import { useState } from "react";
import { ChevronDown, ClipboardCheck, ListChecks } from "lucide-react";

import { createStockCount, listParts, listStockCounts, type Garage, type Part, type StockCount } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import { Badge, Card, CardHeader, Empty, ErrorNote, Field, Loading, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, text, useAction, useLoad, useMoney } from "./ui";
import { LocationSelect, useLocations } from "./stockShared";

export default function Stocktake({ garage }: { garage: Garage }) {
  const t = useT();
  const history = useLoad(() => listStockCounts(), []);
  const [last, setLast] = useState<StockCount | null>(null);

  return (
    <div className="space-y-6">
      <NewCount
        garage={garage}
        onDone={(c) => {
          setLast(c);
          history.reload();
        }}
      />
      {last && (
        <Card className="border-ok/40 bg-ok-soft/40">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="size-5 text-ok" />
            <p className="text-sm font-medium">{t("garage.count.saved", { n: last.lineCount, m: last.mismatches })}</p>
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title={t("garage.count.history")} sub={t("garage.count.historySub")} />
        {history.error ? (
          <ErrorNote message={history.error} onRetry={history.reload} />
        ) : !history.data ? (
          <Loading className="p-4!" />
        ) : history.data.items.length === 0 ? (
          <Empty title={t("garage.count.noneTitle")} body={t("garage.count.noneBody")} />
        ) : (
          <ul className="divide-y divide-border">
            {history.data.items.map((c) => (
              <CountRow key={c.id} count={c} garage={garage} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NewCount({ garage, onDone }: { garage: Garage; onDone: (c: StockCount) => void }) {
  const t = useT();
  const action = useAction();
  const locations = useLocations();
  const [locationId, setLocationId] = useState("");
  const [kind, setKind] = useState<"" | "PART" | "CONSUMABLE">("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const parts = useLoad(() => listParts({ locationId: locationId || undefined, kind: kind || undefined, limit: 200 }), [locationId, kind]);

  const entered = Object.entries(counts).filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v)));
  const diffs = entered.filter(([id, v]) => {
    const p = parts.data?.items.find((x) => x.id === id);
    return p && Number(v) !== p.stockQty;
  }).length;

  async function submit(note: string | null) {
    const c = await action.run("save", () => createStockCount({ note, lines: entered.map(([partId, v]) => ({ partId, counted: Number(v) })) }));
    if (c) {
      setCounts({});
      parts.reload();
      onDone(c);
    }
  }

  return (
    <Card>
      <CardHeader title={t("garage.count.newTitle")} sub={t("garage.count.newBody")} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t("garage.asset.location")} className="min-w-44">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
            <option value="">{t("garage.count.allShelves")}</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("garage.stk.kind")} className="min-w-40">
          <select value={kind} onChange={(e) => setKind(e.target.value as "" | "PART" | "CONSUMABLE")} className={inputCls}>
            <option value="">{t("garage.stk.kindAll")}</option>
            <option value="PART">{t("garage.stk.kindPart")}</option>
            <option value="CONSUMABLE">{t("garage.stk.kindConsumable")}</option>
          </select>
        </Field>
      </div>

      {parts.error ? (
        <ErrorNote message={parts.error} onRetry={parts.reload} />
      ) : !parts.data ? (
        <Loading className="p-4!" />
      ) : parts.data.items.length === 0 ? (
        <Empty title={t("garage.count.noParts")} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-3 pr-3 font-medium">{t("garage.field.partName")}</th>
                  <th className="hidden pb-3 pr-3 font-medium sm:table-cell">{t("garage.asset.location")}</th>
                  <th className="pb-3 pr-3 text-right font-medium">{t("garage.count.expected")}</th>
                  <th className="pb-3 pr-3 text-right font-medium">{t("garage.count.counted")}</th>
                  <th className="pb-3 text-right font-medium">{t("garage.count.difference")}</th>
                </tr>
              </thead>
              <tbody>
                {parts.data.items.map((p) => (
                  <CountLine key={p.id} part={p} locations={locations.data ?? []} value={counts[p.id] ?? ""} onChange={(v) => setCounts((c) => ({ ...c, [p.id]: v }))} />
                ))}
              </tbody>
            </table>
          </div>
          <form
            className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit(text(new FormData(e.currentTarget).get("note")));
            }}
          >
            <Field label={t("garage.field.note")} className="min-w-52 flex-1">
              <input name="note" maxLength={240} placeholder={t("garage.count.notePlaceholder")} className={inputCls} />
            </Field>
            <p className="pb-2.5 text-sm text-muted-foreground">{t("garage.count.summary", { n: entered.length, m: diffs })}</p>
            <button type="button" disabled={entered.length === 0 || action.busy !== null} onClick={() => setCounts({})} className={`${btnSecondary} ${btnSm}`}>
              {t("garage.count.clear")}
            </button>
            <button type="submit" disabled={entered.length === 0 || action.busy !== null} className={`${btnPrimary} disabled:opacity-50`}>
              {action.busy ? <Spinner /> : <ListChecks />} {t("garage.count.apply")}
            </button>
          </form>
          {action.error && <div className="mt-3"><ErrorNote message={action.error} /></div>}
        </>
      )}
      <span className="sr-only">{garage.currency}</span>
    </Card>
  );
}

function CountLine({ part, locations, value, onChange }: { part: Part; locations: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  const diff = value.trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value) - part.stockQty;
  return (
    <tr className="border-t border-border">
      <td className="py-2.5 pr-3">
        <p className="font-medium">{part.name}</p>
        <p className="font-mono text-xs text-muted-foreground">{part.sku}</p>
      </td>
      <td className="hidden py-2.5 pr-3 text-muted-foreground sm:table-cell">{locations.find((l) => l.id === part.locationId)?.name ?? "—"}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{part.stockQty}</td>
      <td className="py-2.5 pr-3 text-right">
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          aria-label={part.name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} ml-auto w-24! py-1.5 text-right tabular-nums`}
        />
      </td>
      <td className="py-2.5 text-right tabular-nums">
        {diff == null ? <span className="text-muted-foreground">—</span> : diff === 0 ? <Badge tone="ok">0</Badge> : <Badge tone={diff < 0 ? "bad" : "warn"}>{diff > 0 ? `+${diff}` : diff}</Badge>}
      </td>
    </tr>
  );
}

function CountRow({ count, garage }: { count: StockCount; garage: Garage }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition ${open ? "" : "-rotate-90"}`} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{formatDate(count.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t("garage.count.rowSub", { n: count.lineCount, m: count.mismatches })}
            {count.countedBy ? ` · ${count.countedBy}` : ""}
            {count.note ? ` · ${count.note}` : ""}
          </p>
        </div>
        {count.mismatches === 0 ? <Badge tone="ok">{t("garage.count.allMatched")}</Badge> : <Badge tone={count.netVarianceValue < 0 ? "bad" : "warn"}>{money(count.netVarianceValue, garage.currency)}</Badge>}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto pl-7">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 pr-3 font-medium">{t("garage.field.partName")}</th>
                <th className="pb-2 pr-3 text-right font-medium">{t("garage.count.expected")}</th>
                <th className="pb-2 pr-3 text-right font-medium">{t("garage.count.counted")}</th>
                <th className="pb-2 text-right font-medium">{t("garage.count.difference")}</th>
              </tr>
            </thead>
            <tbody>
              {count.lines.map((l) => (
                <tr key={l.partId} className="border-t border-border/60">
                  <td className="py-2 pr-3">
                    {l.name} <span className="font-mono text-xs text-muted-foreground">{l.sku}</span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.expected}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.counted}</td>
                  <td className={`py-2 text-right tabular-nums ${l.variance < 0 ? "text-bad" : l.variance > 0 ? "text-warn" : "text-muted-foreground"}`}>{l.variance > 0 ? `+${l.variance}` : l.variance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

// Re-exported so the location select used by the part forms and this screen stays in one place.
export { LocationSelect };
