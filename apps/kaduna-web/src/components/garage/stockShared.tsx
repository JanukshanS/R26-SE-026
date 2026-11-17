"use client";

/** Bits shared by the garage's stock screens: where things are kept, and a few formatters. */
import { useState } from "react";
import { MapPin, Plus } from "lucide-react";

import { createLocation, listLocations, updateLocation, type StockLocation } from "@/lib/garageApi";
import { useT } from "@/lib/i18n";

import { Badge, Card, ErrorNote, Field, Loading, Panel, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, text, useAction, useLoad } from "./ui";

/** Active locations, for the select boxes. */
export function useLocations(enabled = true) {
  return useLoad(() => (enabled ? listLocations() : Promise.resolve([] as StockLocation[])), [enabled]);
}

export function LocationSelect({ locations, defaultValue, name = "locationId", allowNone = true }: { locations: StockLocation[]; defaultValue?: string | null; name?: string; allowNone?: boolean }) {
  const t = useT();
  return (
    <select name={name} defaultValue={defaultValue ?? ""} key={`${defaultValue}-${locations.length}`} className={inputCls}>
      {allowNone && <option value="">{t("garage.stk.noLocation")}</option>}
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}

/** Manage the garage's shelves, bays and cabinets. */
export function LocationsPanel({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const action = useAction();
  const list = useLoad(() => (open ? listLocations(true) : Promise.resolve([] as StockLocation[])), [open]);
  const [form, setForm] = useState(0);

  async function done<T>(key: string, fn: () => Promise<T>) {
    const result = await action.run(key, fn);
    if (result) {
      list.reload();
      onChanged();
    }
    return result;
  }

  return (
    <Panel open={open} onClose={onClose} title={t("garage.stk.locations")} description={t("garage.stk.locationsBody")}>
      <form
        key={form}
        className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await done("add", () => createLocation({ name: text(f.get("name")) ?? "", note: text(f.get("note")) }));
          if (ok) setForm((n) => n + 1);
        }}
      >
        <Field label={t("garage.stk.locationName")} className="min-w-40 flex-1">
          <input name="name" required maxLength={80} placeholder={t("garage.stk.locationPlaceholder")} className={inputCls} />
        </Field>
        <Field label={t("garage.field.note")} className="min-w-40 flex-1">
          <input name="note" maxLength={240} className={inputCls} />
        </Field>
        <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} ${btnSm}`}>
          {action.busy === "add" ? <Spinner /> : <Plus />} {t("garage.action.add")}
        </button>
      </form>
      {action.error && <ErrorNote message={action.error} />}

      <Card className="p-5">
        {list.error ? (
          <ErrorNote message={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Loading className="p-4!" />
        ) : list.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("garage.stk.noLocations")}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {list.data.map((l) => (
              <li key={l.id} className={`flex items-center gap-3 py-3 ${l.active ? "" : "opacity-50"}`}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-canvas text-muted-foreground">
                  <MapPin className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t("garage.stk.locationCounts", { parts: l.partCount ?? 0, tools: l.assetCount ?? 0, held: l.heldCount ?? 0 })}
                    {l.note ? ` · ${l.note}` : ""}
                  </p>
                </div>
                {!l.active && <Badge tone="gray">{t("garage.parts.inactive")}</Badge>}
                <button
                  type="button"
                  disabled={action.busy !== null}
                  onClick={() => done(`toggle-${l.id}`, () => updateLocation(l.id, { active: !l.active }))}
                  className={`${btnSecondary} ${btnSm}`}
                >
                  {l.active ? t("garage.stk.retireLocation") : t("garage.stk.restoreLocation")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Panel>
  );
}

/** A YYYY-MM-DD date, written the way the garage's language writes dates. */
export const prettyDay = (formatDate: (d: string | number | Date, o?: Intl.DateTimeFormatOptions) => string, day: string | null) =>
  day ? formatDate(`${day}T12:00:00`, { day: "numeric", month: "short", year: "numeric" }) : "—";
