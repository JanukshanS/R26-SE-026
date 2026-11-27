"use client";

/**
 * Warranty claims. A customer brings a part back: find the sale by serial or
 * receipt number, record the fault, and the system says whether it's still
 * covered and what a replacement should cost (pro rata after the free
 * months). Then replace, refund, repair or reject. On the shop's side, the
 * faulty unit goes back to the supplier until they credit or replace it.
 */
import { useState } from "react";
import { PackageCheck, Search, ShieldAlert, ShieldCheck, Truck } from "lucide-react";

import { Badge, Card, Chip, Empty, ErrorNote, Field, Kpi, Loading, Panel, Segmented, Spinner, btnDanger, btnPrimary, btnSecondary, btnSm, inputCls, useAction, useLoad, useMoney, type Tone } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import {
  claimOnSupplier,
  listClaims,
  listSuppliers,
  lookupWarranty,
  openClaim,
  resolveClaim,
  type ClaimStatus,
  type SaleMethod,
  type Shop,
  type WarrantyClaim,
  type WarrantyHit,
} from "@/lib/partsApi";

import { useAccess, useApproval } from "./access";

const STATUS_TONE: Record<ClaimStatus, Tone> = { OPEN: "warn", REPLACED: "ok", REFUNDED: "info", REPAIRED: "ok", REJECTED: "gray" };
const PAY: SaleMethod[] = ["CASH", "CARD", "BANK_TRANSFER", "OTHER"];
const REFUND: SaleMethod[] = ["CASH", "CARD", "BANK_TRANSFER", "VOUCHER", "OTHER"];

export default function Warranty({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const access = useAccess();
  const [filter, setFilter] = useState<"OPEN" | "PENDING" | "ALL">("OPEN");
  const claims = useLoad(() => listClaims(filter === "OPEN" ? { status: "OPEN" } : filter === "PENDING" ? { supplier: "PENDING" } : {}), [filter]);
  const [open, setOpen] = useState<WarrantyClaim | null>(null);
  const [starting, setStarting] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={filter === "OPEN"} onClick={() => setFilter("OPEN")}>{t("shop.claim.filterOpen")}</Chip>
        <Chip on={filter === "PENDING"} onClick={() => setFilter("PENDING")}>{t("shop.claim.filterSupplier")}</Chip>
        <Chip on={filter === "ALL"} onClick={() => setFilter("ALL")}>{t("shop.count.filterAll")}</Chip>
        {access.can("sell") && <button type="button" onClick={() => setStarting(true)} className={`${btnPrimary} ${btnSm} ml-auto`}><ShieldAlert /> {t("shop.claim.new")}</button>}
      </div>
      {claims.data && filter === "PENDING" && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Kpi tone="vio" icon={Truck} value={claims.data.length} label={t("shop.claim.withSuppliers")} />
        </div>
      )}
      {claims.error ? <ErrorNote message={claims.error} onRetry={claims.reload} /> : !claims.data ? <Loading /> : claims.data.length === 0 ? (
        <Empty title={t("shop.claim.none")} body={t("shop.claim.noneBody")} />
      ) : (
        <Card className="p-0!">
          <ul className="divide-y divide-border text-sm">
            {claims.data.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpen(c)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-canvas">
                  <span className="w-10 font-mono text-muted-foreground">#{c.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.part?.name ?? "—"}{c.serialNumber && <span className="ml-1 font-mono text-xs text-muted-foreground">{c.serialNumber}</span>}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[c.customerName, c.fault, formatDate(c.createdAt, { day: "numeric", month: "short" })].filter(Boolean).join(" · ")}</span>
                  </span>
                  {!c.covered && <Badge tone="bad" dot={false}>{t("shop.claim.notCovered")}</Badge>}
                  {c.supplier.status !== "NONE" && <Badge tone="vio" dot={false}>{t(`shop.claim.sup.${c.supplier.status}`)}</Badge>}
                  <Badge tone={STATUS_TONE[c.status]} dot={false}>{t(`shop.claim.status.${c.status}`)}</Badge>
                  {c.status === "REPLACED" && c.charged > 0 && <span className="text-xs tabular-nums text-muted-foreground">{money(c.charged, shop.currency)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <NewClaim open={starting} onClose={() => setStarting(false)} onOpened={(c) => { setStarting(false); claims.reload(); setOpen(c); }} />
      <ClaimPanel shop={shop} claim={open} onClose={() => setOpen(null)} onChanged={(c) => { setOpen(c); claims.reload(); }} />
    </div>
  );
}

function NewClaim({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (c: WarrantyClaim) => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const action = useAction();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<WarrantyHit[] | null>(null);
  const [pick, setPick] = useState<WarrantyHit | null>(null);
  const [fault, setFault] = useState("");
  return (
    <Panel open={open} onClose={onClose} title={t("shop.claim.new")} description={t("shop.claim.newBody")}>
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); setPick(null); if (q.trim()) setHits((await action.run("find", () => lookupWarranty(q.trim()))) ?? null); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("shop.sale.warrantyPlaceholder")} className={inputCls} autoFocus />
        <button type="submit" disabled={!q.trim() || action.busy !== null} className={btnSecondary}>{action.busy === "find" ? <Spinner /> : <Search />} {t("shop.sale.warrantyFind")}</button>
      </form>
      {hits && (hits.length === 0 ? <Empty title={t("shop.sale.warrantyNone")} /> : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-white text-sm">
          {hits.map((h) => (
            <li key={h.item.id}>
              <button type="button" onClick={() => setPick(h)} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${pick?.item.id === h.item.id ? "bg-brand-soft" : "hover:bg-canvas"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{h.item.description}{h.item.serialNumber && <span className="ml-1 font-mono text-xs text-muted-foreground">{h.item.serialNumber}</span>}</span>
                  <span className="block text-xs text-muted-foreground">{t("shop.sale.receipt")} #{h.sale.number} · {formatDate(h.sale.createdAt, { day: "numeric", month: "short", year: "numeric" })}{h.sale.customerName && ` · ${h.sale.customerName}`}</span>
                </span>
                <Badge tone={h.covered ? "ok" : "gray"} dot={false}>{h.covered ? t("shop.sale.covered") : t("shop.sale.expired")}</Badge>
              </button>
            </li>
          ))}
        </ul>
      ))}
      {pick && (
        <Card className="space-y-3 p-5">
          <Field label={t("shop.claim.fault")}><textarea value={fault} onChange={(e) => setFault(e.target.value)} rows={3} maxLength={1000} placeholder={t("shop.claim.faultPlaceholder")} className={inputCls} /></Field>
          {action.error && <ErrorNote message={action.error} />}
          <button
            type="button"
            disabled={!fault.trim() || action.busy !== null}
            onClick={async () => {
              const c = await action.run("open", () => openClaim({ saleItemId: pick.item.id, fault: fault.trim() }));
              if (c) {
                setQ("");
                setHits(null);
                setPick(null);
                setFault("");
                onOpened(c);
              }
            }}
            className={btnPrimary}
          >
            {action.busy === "open" ? <Spinner /> : <ShieldAlert />} {t("shop.claim.open")}
          </button>
        </Card>
      )}
    </Panel>
  );
}

function ClaimPanel({ shop, claim: c, onClose, onChanged }: { shop: Shop; claim: WarrantyClaim | null; onClose: () => void; onChanged: (c: WarrantyClaim) => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const access = useAccess();
  const action = useAction();
  const { approve, prompt } = useApproval();
  const [outcome, setOutcome] = useState<"REPLACE" | "REFUND" | "REPAIR" | "REJECT">("REPLACE");
  const [charge, setCharge] = useState<string | null>(null);
  const [method, setMethod] = useState<SaleMethod>("CASH");
  const [serial, setSerial] = useState("");
  const [note, setNote] = useState("");
  const [sup, setSup] = useState({ supplierId: "", amount: "", note: "" });
  const suppliers = useLoad(() => (c && access.can("purchasing") ? listSuppliers() : Promise.resolve([])), [c?.id]);
  const cur = shop.currency;
  if (!c) return <Panel open={false} onClose={onClose} title=""><span /></Panel>;
  const chargeNum = charge == null ? c.suggestedCharge : Number(charge) || 0;
  const day = (s: string | null) => (s ? formatDate(s, { day: "numeric", month: "short", year: "numeric" }) : "—");

  async function resolve() {
    const next = await action.run("resolve", () =>
      approve((pin) =>
        resolveClaim(c!.id, {
          outcome,
          charge: outcome === "REPLACE" ? chargeNum : null,
          paymentMethod: outcome === "REPLACE" && chargeNum > 0 ? method : null,
          refundMethod: outcome === "REFUND" ? method : null,
          serialNumber: outcome === "REPLACE" && c!.part?.serialized ? serial.trim() || null : null,
          note: note.trim() || null,
          approvalPin: pin ?? null,
        })
      )
    );
    if (next) onChanged(next);
  }

  async function supplier(actionName: "SEND" | "CREDITED" | "REPLACED" | "REJECTED") {
    const next = await action.run(actionName, () =>
      claimOnSupplier(c!.id, { action: actionName, supplierId: sup.supplierId || null, amount: sup.amount === "" ? null : Number(sup.amount), note: sup.note.trim() || null })
    );
    if (next) {
      setSup({ supplierId: "", amount: "", note: "" });
      onChanged(next);
    }
  }

  return (
    <Panel wide open onClose={onClose} title={`${t("shop.claim.title")} #${c.number}`} description={<Badge tone={STATUS_TONE[c.status]} dot={false}>{t(`shop.claim.status.${c.status}`)}</Badge>}>
      {prompt}
      <Card className="space-y-2 p-5 text-sm">
        <p className="font-semibold">{c.part?.name ?? "—"}{c.serialNumber && <span className="ml-2 font-mono text-xs text-muted-foreground">{c.serialNumber}</span>}</p>
        <p className="text-muted-foreground">{c.fault}</p>
        <div className="grid gap-2 pt-2 sm:grid-cols-3">
          <span><span className="block text-xs text-muted-foreground">{t("shop.claim.customer")}</span>{c.customerName ?? "—"}{c.customerPhone && ` · ${c.customerPhone}`}</span>
          <span><span className="block text-xs text-muted-foreground">{t("shop.claim.sold")}</span>{day(c.soldAt)}</span>
          <span>
            <span className="block text-xs text-muted-foreground">{t("shop.claim.until")}</span>{day(c.warrantyUntil)}{" "}
            {c.covered ? <Badge tone="ok" dot={false}><ShieldCheck className="size-3" /> {t("shop.sale.covered")}</Badge> : <Badge tone="bad" dot={false}>{t("shop.claim.notCovered")}</Badge>}
          </span>
        </div>
        {c.status !== "OPEN" && (
          <p className="border-t border-border pt-2 text-muted-foreground">
            {t(`shop.claim.status.${c.status}`)}{c.charged > 0 && ` · ${t("shop.claim.chargedN", { amount: money(c.charged, cur) })}`}{c.resolvedByName && ` · ${c.resolvedByName}`}{c.resolvedAt && ` · ${day(c.resolvedAt)}`}{c.outcomeNote && ` · ${c.outcomeNote}`}
          </p>
        )}
      </Card>

      {c.status === "OPEN" && access.can("sell") && (
        <Card className="space-y-3 p-5">
          <Segmented value={outcome} onChange={setOutcome} options={(["REPLACE", "REFUND", "REPAIR", "REJECT"] as const).map((o) => ({ value: o, label: t(`shop.claim.do.${o}`) }))} />
          {outcome === "REPLACE" && (
            <>
              <Field label={t("shop.claim.charge")} hint={c.suggestedCharge > 0 ? t("shop.claim.suggested", { amount: money(c.suggestedCharge, cur) }) : t("shop.claim.free")}>
                <input type="number" min={0} step="0.01" value={charge ?? String(c.suggestedCharge)} onChange={(e) => setCharge(e.target.value)} className={inputCls} />
              </Field>
              {chargeNum > 0 && <Field label={t("shop.sale.method")}><div className="flex flex-wrap gap-2">{PAY.map((m) => <Chip key={m} on={method === m} onClick={() => setMethod(m)}>{t(`shop.method.${m}`)}</Chip>)}</div></Field>}
              {c.part?.serialized && <Field label={t("shop.claim.newSerial")}><input value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} maxLength={80} className={`${inputCls} font-mono`} /></Field>}
            </>
          )}
          {outcome === "REFUND" && <Field label={t("shop.sale.refundBy")}><div className="flex flex-wrap gap-2">{REFUND.map((m) => <Chip key={m} on={method === m} onClick={() => setMethod(m)}>{t(`shop.method.${m}`)}</Chip>)}</div></Field>}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={outcome === "REJECT" ? t("shop.claim.whyReject") : t("shop.acc.note")} maxLength={1000} className={inputCls} />
          {action.error && <ErrorNote message={action.error} />}
          <button type="button" disabled={action.busy !== null || (outcome === "REJECT" && !note.trim()) || (outcome === "REPLACE" && Boolean(c.part?.serialized) && !serial.trim())} onClick={resolve} className={outcome === "REJECT" ? btnDanger : btnPrimary}>
            {action.busy === "resolve" ? <Spinner /> : <PackageCheck />} {t(`shop.claim.do.${outcome}`)}
          </button>
        </Card>
      )}

      {access.can("purchasing") && (
        <Card className="space-y-3 p-5">
          <h3 className="flex items-center gap-2 font-semibold"><Truck className="size-4" /> {t("shop.claim.supplierTitle")} <Badge tone="vio" dot={false}>{t(`shop.claim.sup.${c.supplier.status}`)}</Badge></h3>
          {c.supplier.status === "NONE" || c.supplier.status === "REJECTED" ? (
            <>
              <p className="text-sm text-muted-foreground">{t("shop.claim.supplierHint")}</p>
              <select value={sup.supplierId} onChange={(e) => setSup({ ...sup, supplierId: e.target.value })} className={inputCls}>
                <option value="">{t("shop.claim.usualSupplier")}</option>
                {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" disabled={action.busy !== null} onClick={() => supplier("SEND")} className={btnSecondary}>{action.busy === "SEND" ? <Spinner /> : <Truck />} {t("shop.claim.send")}</button>
            </>
          ) : c.supplier.status === "PENDING" ? (
            <>
              <p className="text-sm text-muted-foreground">{t("shop.claim.sentOn", { date: day(c.supplier.sentAt) })}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input type="number" min={0} step="0.01" value={sup.amount} onChange={(e) => setSup({ ...sup, amount: e.target.value })} placeholder={t("shop.claim.creditAmount")} className={inputCls} />
                <input value={sup.note} onChange={(e) => setSup({ ...sup, note: e.target.value })} placeholder={t("shop.acc.note")} maxLength={500} className={inputCls} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={action.busy !== null} onClick={() => supplier("CREDITED")} className={`${btnPrimary} ${btnSm}`}>{t("shop.claim.sup.do.CREDITED")}</button>
                <button type="button" disabled={action.busy !== null} onClick={() => supplier("REPLACED")} className={`${btnSecondary} ${btnSm}`}>{t("shop.claim.sup.do.REPLACED")}</button>
                <button type="button" disabled={action.busy !== null} onClick={() => supplier("REJECTED")} className={`${btnDanger} ${btnSm}`}>{t("shop.claim.sup.do.REJECTED")}</button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{c.supplier.credit != null && t("shop.claim.creditedN", { amount: money(c.supplier.credit, cur) })}{c.supplier.note && ` · ${c.supplier.note}`}</p>
          )}
          {action.error && c.status !== "OPEN" && <ErrorNote message={action.error} />}
        </Card>
      )}
    </Panel>
  );
}
