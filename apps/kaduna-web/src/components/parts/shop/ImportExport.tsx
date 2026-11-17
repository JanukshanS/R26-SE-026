"use client";

/**
 * The catalogue in bulk. Export everything to a spreadsheet (CSV, opens in
 * Excel), or import one: it's checked first and shows what would be added or
 * changed and any rows with problems; nothing is saved until every row is
 * right and you confirm.
 */
import { useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";

import { Badge, Card, ErrorNote, Panel, Spinner, btnPrimary, btnSecondary, btnSm, useAction } from "@/components/garage/ui";
import { useT } from "@/lib/i18n";
import { exportParts, importParts, type ImportResult } from "@/lib/partsApi";

const TEMPLATE =
  "sku,name,brand,category,oem_number,part_number,cross_refs,barcode,location,unit,cost_price,retail_price,trade_price,tax_rate,stock,reorder_level,reorder_qty,supplier,universal,listed,warranty_months,core_charge,serialized,fits,notes\r\n" +
  'BP-AQUA-F,Front brake pads,Bosch,Brakes,04465-52260,0986AB1234,ALT-123|ALT-456,,A3-02,set,3000,5000,4500,,10,2,10,Lanka Motor Parts,no,yes,6,,no,"Toyota Aqua 2012-2017; Toyota Prius C",\r\n';

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ImportExport({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const t = useT();
  const action = useAction();
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);

  async function pick(f: File | undefined) {
    setCheck(null);
    setDone(null);
    if (!f) return;
    const csv = await f.text();
    setFile({ name: f.name, csv });
    const r = await action.run("check", () => importParts(csv, true));
    if (r) setCheck(r);
  }

  return (
    <Panel wide open={open} onClose={onClose} title={t("shop.inv.importExport")} description={t("shop.io.body")}>
      <Card className="space-y-3 p-5">
        <h3 className="text-sm font-semibold">{t("shop.io.exportTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("shop.io.exportBody")}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={action.busy !== null} onClick={async () => { const r = await action.run("export", exportParts); if (r) download(`parts-${new Date().toLocaleDateString("en-CA")}.csv`, r.csv); }} className={btnSecondary}>
            {action.busy === "export" ? <Spinner /> : <Download />} {t("shop.io.export")}
          </button>
          <button type="button" onClick={() => download("parts-template.csv", TEMPLATE)} className={btnSecondary}><FileSpreadsheet /> {t("shop.io.template")}</button>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="text-sm font-semibold">{t("shop.io.importTitle")}</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("shop.io.rule1")}</li>
          <li>{t("shop.io.rule2")}</li>
          <li>{t("shop.io.rule3")}</li>
          <li>{t("shop.io.rule4")}</li>
        </ul>
        <label className={`${btnSecondary} cursor-pointer`}>
          {action.busy === "check" ? <Spinner /> : <Upload />} {file ? file.name : t("shop.io.choose")}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {action.error && <ErrorNote message={action.error} />}

        {check && !done && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="ok" dot={false}>{t("shop.io.new", { n: check.create })}</Badge>
              <Badge tone="info" dot={false}>{t("shop.io.updated", { n: check.update })}</Badge>
              {check.errors.length > 0 && <Badge tone="bad" dot={false}>{t("shop.io.problems", { n: check.errors.length })}</Badge>}
            </div>
            {check.ignoredColumns.length > 0 && <p className="text-xs text-warn">{t("shop.io.ignored", { cols: check.ignoredColumns.join(", ") })}</p>}
            {check.errors.length > 0 ? (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-bad/30 bg-bad-soft p-3 text-sm">
                {check.errors.map((e) => <p key={`${e.row}-${e.message}`}><span className="font-mono text-xs">{t("shop.io.row", { n: e.row })}</span> {e.message}</p>)}
              </div>
            ) : (
              <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm">
                {check.preview.map((r) => (
                  <li key={r.row} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="w-28 truncate font-mono text-xs text-muted-foreground">{r.sku}</span>
                    <span className="min-w-0 flex-1 truncate">{r.name ?? "—"}</span>
                    <Badge tone={r.action === "create" ? "ok" : "info"} dot={false}>{t(`shop.io.action.${r.action}`)}</Badge>
                  </li>
                ))}
                {check.rows > check.preview.length && <li className="px-3 py-1.5 text-xs text-muted-foreground">{t("shop.io.more", { n: check.rows - check.preview.length })}</li>}
              </ul>
            )}
            <button
              type="button"
              disabled={action.busy !== null || check.errors.length > 0 || !file}
              onClick={async () => {
                const r = await action.run("apply", () => importParts(file!.csv, false));
                if (r?.applied) {
                  setDone(r);
                  onImported();
                }
              }}
              className={btnPrimary}
            >
              {action.busy === "apply" ? <Spinner /> : <Upload />} {t("shop.io.apply", { n: check.create + check.update })}
            </button>
          </div>
        )}
        {done && (
          <div className="flex items-center gap-2 rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">
            <CheckCircle2 className="size-4" /> {t("shop.io.done", { created: done.create, updated: done.update })}
            <button type="button" onClick={() => { setFile(null); setCheck(null); setDone(null); }} className={`${btnSecondary} ${btnSm} ml-auto`}>{t("shop.io.another")}</button>
          </div>
        )}
      </Card>
    </Panel>
  );
}
