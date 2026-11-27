"use client";

/**
 * Buying stock: what to reorder (grouped by usual supplier, one click to a
 * purchase order), purchase orders from draft to received, and suppliers.
 */
import { useEffect, useState } from "react";
import { PackageCheck, PackagePlus, Pencil, Phone, Plus, Send, Trash2, Truck, X } from "lucide-react";

import { Badge, Card, CardHeader, Empty, ErrorNote, Field, Loading, Panel, Segmented, Spinner, btnDanger, btnPrimary, btnSecondary, btnSm, inputCls, num, text, useAction, useLoad, useMoney, type Tone } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import {
  cancelPurchase,
  createPurchase,
  createSupplier,
  getReorderList,
  listPurchases,
  listLocations,
  listSuppliers,
  placePurchase,
  receivePurchase,
  updateSupplier,
  type Part,
  type Purchase,
  type PurchaseStatus,
  type Shop,
  type Supplier,
} from "@/lib/partsApi";

import { PartPicker } from "./common";

const PO_TONE: Record<PurchaseStatus, Tone> = { DRAFT: "gray", ORDERED: "info", PARTLY_RECEIVED: "warn", RECEIVED: "ok", CANCELLED: "gray" };

type Draft = { supplierId: string; lines: { part: Pick<Part, "id" | "name" | "sku" | "unit" | "costPrice" | "purchaseUnit" | "purchaseFactor">; quantity: number; unitCost: number }[] };

export default function Purchasing({ shop }: { shop: Shop }) {
  const t = useT();
  const [view, setView] = useState<"reorder" | "orders" | "suppliers">("reorder");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [opened, setOpened] = useState<Purchase | null>(null);
  const pos = useLoad(() => listPurchases(), []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "reorder", label: t("shop.buy.reorder") },
            { value: "orders", label: t("shop.buy.orders") },
            { value: "suppliers", label: t("shop.buy.suppliers") },
          ]}
        />
        {view !== "suppliers" && (
          <button type="button" onClick={() => setDraft({ supplierId: "", lines: [] })} className={`${btnPrimary} ${btnSm} ml-auto`}><PackagePlus /> {t("shop.buy.newPo")}</button>
        )}
      </div>

      {view === "reorder" ? (
        <Reorder shop={shop} onStart={setDraft} />
      ) : view === "suppliers" ? (
        <Suppliers shop={shop} />
      ) : pos.error ? (
        <ErrorNote message={pos.error} onRetry={pos.reload} />
      ) : !pos.data ? (
        <Loading />
      ) : pos.data.length === 0 ? (
        <Empty title={t("shop.buy.noOrders")} body={t("shop.buy.noOrdersBody")} />
      ) : (
        <Card className="p-0!">
          <ul className="divide-y divide-border text-sm">
            {pos.data.map((po) => (
              <li key={po.id}>
                <button type="button" onClick={() => setOpened(po)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-canvas">
                  <span className="w-16 font-mono text-muted-foreground">PO #{po.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{po.supplier.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t("shop.buy.lines", { count: po.items.length })}</span>
                  </span>
                  <Badge tone={PO_TONE[po.status]}>{t(`shop.po.${po.status}`)}</Badge>
                  <PoMoney shop={shop} amount={po.total} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <DraftPanel shop={shop} draft={draft} onClose={() => setDraft(null)} onCreated={(po) => { setDraft(null); pos.reload(); setView("orders"); setOpened(po); }} />
      <PurchasePanel shop={shop} po={opened} onClose={() => setOpened(null)} onChanged={(po) => { setOpened(po); pos.reload(); }} />
    </div>
  );
}

function PoMoney({ shop, amount }: { shop: Shop; amount: number }) {
  const money = useMoney();
  return <span className="w-28 text-right font-medium tabular-nums">{money(amount, shop.currency)}</span>;
}

function Reorder({ shop, onStart }: { shop: Shop; onStart: (d: Draft) => void }) {
  const t = useT();
  const money = useMoney();
  const list = useLoad(getReorderList, []);
  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  if (list.data.length === 0) return <Empty title={t("shop.buy.nothingLow")} body={t("shop.buy.nothingLowBody")} />;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {list.data.map((g) => (
        <Card key={g.supplier?.id ?? "none"}>
          <CardHeader
            title={g.supplier?.name ?? t("shop.buy.noSupplier")}
            sub={g.supplier?.phone ?? undefined}
            action={
              g.supplier && (
                <button
                  type="button"
                  onClick={() => onStart({ supplierId: g.supplier!.id, lines: g.lines.filter((l) => l.suggested > 0).map((l) => ({ part: l.part, quantity: l.suggested, unitCost: Math.round((l.part.costPrice ?? 0) * (l.part.purchaseFactor || 1) * 100) / 100 })) })}
                  className={`${btnPrimary} ${btnSm}`}
                >
                  <PackagePlus /> {t("shop.buy.makePo")}
                </button>
              )
            }
          />
          <ul className="divide-y divide-border text-sm">
            {g.lines.map((l) => (
              <li key={l.part.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.part.name}</span>
                  <span className="block text-xs text-muted-foreground">{t("shop.buy.stockVsLevel", { stock: l.part.stockQty, level: l.part.reorderLevel })}{l.onOrder > 0 && ` · ${t("shop.buy.onOrder", { n: l.onOrder })}`}</span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">{t("shop.buy.buyN", { n: l.suggested })}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">{money((l.part.costPrice ?? 0) * l.suggested, shop.currency)}</span>
                </span>
              </li>
            ))}
          </ul>
          {!g.supplier && <p className="mt-3 text-xs text-muted-foreground">{t("shop.buy.setSupplierHint")}</p>}
        </Card>
      ))}
    </div>
  );
}

function DraftPanel({ shop, draft, onClose, onCreated }: { shop: Shop; draft: Draft | null; onClose: () => void; onCreated: (po: Purchase) => void }) {
  const t = useT();
  const money = useMoney();
  const action = useAction();
  const suppliers = useLoad(() => (draft ? listSuppliers() : Promise.resolve([])), [draft !== null]);
  const [d, setD] = useState<Draft>({ supplierId: "", lines: [] });
  const [note, setNote] = useState("");
  useEffect(() => {
    if (draft) setD(draft);
    setNote("");
  }, [draft]);
  const total = d.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);

  return (
    <Panel wide open={draft !== null} onClose={onClose} title={t("shop.buy.newPo")}>
      <Card className="space-y-4 p-5">
        <Field label={t("shop.buy.supplier")}>
          <select value={d.supplierId} onChange={(e) => setD({ ...d, supplierId: e.target.value })} className={inputCls}>
            <option value="">—</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        {suppliers.data?.length === 0 && <p className="text-xs text-muted-foreground">{t("shop.buy.addSupplierFirst")}</p>}
        <PartPicker onPick={(p) => setD((x) => (x.lines.some((l) => l.part.id === p.id) ? x : { ...x, lines: [...x.lines, { part: p, quantity: Math.max(1, Math.ceil((p.reorderQty || 1) / (p.purchaseFactor || 1))), unitCost: Math.round((p.costPrice ?? 0) * (p.purchaseFactor || 1) * 100) / 100 }] }))} />
        {d.lines.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {d.lines.map((l, i) => (
              <li key={l.part.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{l.part.name}</span> <span className="font-mono text-xs text-muted-foreground">{l.part.sku}</span>
                  {l.part.purchaseUnit && l.part.purchaseFactor !== 1 && <span className="block text-xs text-muted-foreground">{t("shop.buy.perUnit", { unit: l.part.purchaseUnit, n: l.part.purchaseFactor, sell: l.part.unit })}</span>}
                </span>
                <input type="number" min={1} step="any" value={l.quantity} onChange={(e) => setD({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) || 1 } : x)) })} aria-label={t("garage.field.qty")} className={`${inputCls} w-20! py-1.5!`} />
                <input type="number" min={0} step="0.01" value={l.unitCost} onChange={(e) => setD({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, unitCost: Number(e.target.value) || 0 } : x)) })} aria-label={t("shop.inv.cost")} className={`${inputCls} w-28! py-1.5! text-right`} />
                <span className="w-28 text-right tabular-nums">{money(l.quantity * l.unitCost, shop.currency)}</span>
                <button type="button" onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i) })} aria-label={t("garage.action.remove")} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-bad-soft hover:text-bad"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between border-t border-border pt-2 text-sm font-semibold"><span>{t("garage.invoice.total")}</span><span className="tabular-nums">{money(total, shop.currency)}</span></div>
        <Field label={t("shop.buy.note")}><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={inputCls} /></Field>
      </Card>
      {action.error && <ErrorNote message={action.error} />}
      <button
        type="button"
        disabled={action.busy !== null || !d.supplierId || d.lines.length === 0}
        onClick={async () => {
          const po = await action.run("create", () => createPurchase({ supplierId: d.supplierId, note: note.trim() || null, items: d.lines.map((l) => ({ partId: l.part.id, quantity: l.quantity, unitCost: l.unitCost })) }));
          if (po) onCreated(po);
        }}
        className={`${btnPrimary} w-full`}
      >
        {action.busy === "create" && <Spinner />} {t("shop.buy.saveDraft")}
      </button>
    </Panel>
  );
}

function PurchasePanel({ shop, po, onClose, onChanged }: { shop: Shop; po: Purchase | null; onClose: () => void; onChanged: (po: Purchase) => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  const [rx, setRx] = useState<Record<string, { qty: string; cost: string; loc?: string }>>({});
  const locations = useLoad(() => (po ? listLocations() : Promise.resolve([])), [po?.id]);
  const [extra, setExtra] = useState("");
  const [bill, setBill] = useState({ reference: "", billDate: "", dueDate: "" });
  useEffect(() => {
    if (!po) return;
    setRx(Object.fromEntries(po.items.map((i) => [i.id, { qty: String(Math.max(0, i.quantity - i.receivedQty)), cost: String(i.unitCost) }])));
    setExtra("");
    setBill({ reference: "", billDate: "", dueDate: "" });
  }, [po]);
  const arriving = po ? po.items.reduce((s, i) => s + (Number(rx[i.id]?.qty) || 0) * (rx[i.id]?.cost === "" ? i.unitCost : Number(rx[i.id]?.cost) || 0), 0) : 0;
  const receiving = po && (po.status === "ORDERED" || po.status === "PARTLY_RECEIVED");

  async function run(key: string, fn: () => Promise<Purchase>) {
    const next = await action.run(key, fn);
    if (next) onChanged(next);
  }

  return (
    <Panel wide open={po !== null} onClose={onClose} title={po ? `PO #${po.number} · ${po.supplier.name}` : ""} description={po ? <Badge tone={PO_TONE[po.status]}>{t(`shop.po.${po.status}`)}</Badge> : undefined}>
      {po && (
        <>
          <Card className="p-5">
            <ul className="divide-y divide-border text-sm">
              {po.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.part.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("shop.buy.received", { got: i.receivedQty, of: i.quantity })}{i.purchaseUnit && ` ${i.purchaseUnit}`} · {money(i.unitCost, shop.currency)}
                      {i.unitFactor !== 1 && ` · ${t("shop.kit.boughtAs", { unit: i.purchaseUnit ?? "", n: i.unitFactor, sell: i.part.unit })}`}
                    </span>
                  </span>
                  {receiving && (
                    <>
                      <input type="number" min={0} step="any" value={rx[i.id]?.qty ?? ""} onChange={(e) => setRx({ ...rx, [i.id]: { ...rx[i.id], qty: e.target.value } })} aria-label={t("shop.buy.arrived")} className={`${inputCls} w-20! py-1.5!`} />
                      <input type="number" min={0} step="0.01" value={rx[i.id]?.cost ?? ""} onChange={(e) => setRx({ ...rx, [i.id]: { ...rx[i.id], cost: e.target.value } })} aria-label={t("shop.inv.cost")} className={`${inputCls} w-28! py-1.5! text-right`} />
                      {(locations.data ?? []).length > 1 && (
                        <select value={rx[i.id]?.loc ?? ""} onChange={(e) => setRx({ ...rx, [i.id]: { ...rx[i.id], loc: e.target.value } })} aria-label={t("shop.part.location")} className={`${inputCls} w-36! py-1.5!`}>
                          <option value="">{t("shop.buy.defaultLocation")}</option>
                          {(locations.data ?? []).filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      )}
                    </>
                  )}
                  {!receiving && <span className="w-28 text-right tabular-nums">{money(i.lineTotal, shop.currency)}</span>}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-semibold"><span>{t("garage.invoice.total")}</span><span>{money(po.total, shop.currency)}</span></div>
            {po.note && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{po.note}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              {formatDate(po.createdAt, { day: "numeric", month: "short", year: "numeric" })}
              {po.orderedAt && ` · ${t("shop.buy.sent", { date: formatDate(po.orderedAt, { day: "numeric", month: "short" }) })}`}
              {po.receivedAt && ` · ${t("shop.buy.receivedOn", { date: formatDate(po.receivedAt, { day: "numeric", month: "short" }) })}`}
            </p>
          </Card>
          {receiving && (
            <Card className="space-y-3 p-5">
              <h3 className="text-sm font-semibold">{t("shop.buy.delivery")}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("shop.buy.extraCosts")} hint={t("shop.buy.extraHint")}><input type="number" min={0} step="0.01" value={extra} onChange={(e) => setExtra(e.target.value)} className={inputCls} /></Field>
                <Field label={t("shop.pay.invoiceNo")} hint={t("shop.buy.billHint")}><input value={bill.reference} onChange={(e) => setBill({ ...bill, reference: e.target.value })} maxLength={80} className={inputCls} /></Field>
                {bill.reference.trim() && (
                  <>
                    <Field label={t("shop.pay.billDate")}><input type="date" value={bill.billDate} onChange={(e) => setBill({ ...bill, billDate: e.target.value })} className={inputCls} /></Field>
                    <Field label={t("shop.pay.dueDate")}><input type="date" value={bill.dueDate} onChange={(e) => setBill({ ...bill, dueDate: e.target.value })} className={inputCls} /></Field>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t("shop.buy.arrivingValue", { amount: money(arriving + (Number(extra) || 0), shop.currency) })}</p>
            </Card>
          )}
          {action.error && <ErrorNote message={action.error} />}
          <div className="flex flex-wrap gap-2">
            {po.status === "DRAFT" && <button type="button" disabled={action.busy !== null} onClick={() => run("order", () => placePurchase(po.id))} className={btnPrimary}>{action.busy === "order" ? <Spinner /> : <Send />} {t("shop.buy.markSent")}</button>}
            {receiving && (
              <button
                type="button"
                disabled={action.busy !== null}
                onClick={() =>
                  run("receive", () =>
                    receivePurchase(
                      po.id,
                      po.items.map((i) => ({ itemId: i.id, quantity: Number(rx[i.id]?.qty) || 0, unitCost: rx[i.id]?.cost === "" ? undefined : Number(rx[i.id]?.cost), locationId: rx[i.id]?.loc || null })),
                      { extraCosts: Number(extra) || 0, bill: bill.reference.trim() ? { reference: bill.reference.trim(), billDate: bill.billDate || undefined, dueDate: bill.dueDate || null } : null }
                    )
                  )
                }
                className={btnPrimary}
              >
                {action.busy === "receive" ? <Spinner /> : <PackageCheck />} {t("shop.buy.receive")}
              </button>
            )}
            {(po.status === "DRAFT" || po.status === "ORDERED") && (
              <button type="button" disabled={action.busy !== null} onClick={() => window.confirm(t("shop.buy.confirmCancel")) && run("cancel", () => cancelPurchase(po.id))} className={btnDanger}>
                {action.busy === "cancel" ? <Spinner /> : <X />} {t("shop.buy.cancel")}
              </button>
            )}
          </div>
          {receiving && <p className="text-xs text-muted-foreground">{t("shop.buy.receiveHint")}</p>}
        </>
      )}
    </Panel>
  );
}

function Suppliers({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const list = useLoad(() => listSuppliers({ includeInactive: true }), []);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const action = useAction();
  const s = editing && editing !== "new" ? editing : null;

  async function submit(form: FormData) {
    const input = { name: text(form.get("name")) ?? "", contactName: text(form.get("contactName")), phone: text(form.get("phone")), email: text(form.get("email")), address: text(form.get("address")), notes: text(form.get("notes")), paymentDays: num(form.get("paymentDays")) ?? 30 };
    if (await action.run("save", () => (s ? updateSupplier(s.id, input) : createSupplier(input)))) {
      setEditing(null);
      list.reload();
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => setEditing("new")} className={`${btnPrimary} ${btnSm}`}><Plus /> {t("shop.buy.addSupplier")}</button>
      {list.error ? (
        <ErrorNote message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <Empty title={t("shop.buy.noSuppliers")} body={t("shop.buy.noSuppliersBody")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.data.map((x) => (
            <Card key={x.id} as="article" className={`p-5 ${x.active ? "" : "opacity-60"}`}>
              <CardHeader title={x.name} sub={x.contactName ?? undefined} action={<button type="button" onClick={() => setEditing(x)} className={`${btnSecondary} ${btnSm}`} aria-label={t("me.action.edit")}><Pencil /></button>} />
              <p className="text-sm text-muted-foreground">{t("shop.buy.supplierStats", { parts: x.partCount ?? 0, open: x.openOrders ?? 0 })}</p>
              {(x.balance ?? 0) !== 0 && <p className="mt-1 text-sm font-medium">{t("shop.buy.youOwe", { amount: money(x.balance ?? 0, shop.currency) })}</p>}
              {x.phone && <a href={`tel:${x.phone}`} className={`${btnSecondary} ${btnSm} mt-3`}><Phone /> {x.phone}</a>}
            </Card>
          ))}
        </div>
      )}
      <Panel open={editing !== null} onClose={() => setEditing(null)} title={s ? t("shop.buy.editSupplier") : t("shop.buy.addSupplier")}>
        {editing !== null && (
          <form key={s?.id ?? "new"} className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}>
            <Card className="space-y-4 p-5">
              <Field label={t("shop.buy.supplierName")}><input name="name" required maxLength={160} defaultValue={s?.name} className={inputCls} /></Field>
              <Field label={t("shop.buy.contact")}><input name="contactName" maxLength={120} defaultValue={s?.contactName ?? ""} className={inputCls} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("garage.field.phone")}><input name="phone" maxLength={40} defaultValue={s?.phone ?? ""} className={inputCls} /></Field>
                <Field label={t("garage.field.email")}><input name="email" type="email" maxLength={200} defaultValue={s?.email ?? ""} className={inputCls} /></Field>
              </div>
              <Field label={t("parts.shop.address")}><input name="address" maxLength={500} defaultValue={s?.address ?? ""} className={inputCls} /></Field>
              <Field label={t("shop.buy.paymentDays")} hint={t("shop.buy.paymentDaysHint")}><input name="paymentDays" type="number" min={0} max={365} defaultValue={s?.paymentDays ?? 30} className={inputCls} /></Field>
              <Field label={t("shop.inv.notes")}><textarea name="notes" rows={2} maxLength={2000} defaultValue={s?.notes ?? ""} className={inputCls} /></Field>
            </Card>
            {action.error && <ErrorNote message={action.error} />}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} flex-1`}>{action.busy === "save" && <Spinner />} {t("garage.action.save")}</button>
              {s && (
                <button type="button" disabled={action.busy !== null} onClick={async () => (await action.run("toggle", () => updateSupplier(s.id, { active: !s.active }))) && (setEditing(null), list.reload())} className={btnSecondary}>
                  <Truck /> {s.active ? t("shop.inv.deactivate") : t("shop.inv.reactivate")}
                </button>
              )}
            </div>
          </form>
        )}
      </Panel>
    </div>
  );
}
