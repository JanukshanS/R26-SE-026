"use client";

/**
 * Buying stock from suppliers: draft an order, place it, and book the goods in
 * when they arrive (all at once or in part). Received stock goes straight onto
 * the part, at the price on the order.
 */
import { useState } from "react";
import { PackageCheck, Plus, Send, Trash2, Truck, Wand2 } from "lucide-react";

import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  listParts,
  listPurchaseOrders,
  listSuppliers,
  placePurchaseOrder,
  receivePurchaseOrder,
  updatePurchaseOrder,
  type Garage,
  type Part,
  type PurchaseOrder,
  type PurchaseStatus,
} from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import { Badge, Card, Chip, Empty, ErrorNote, Field, Loading, Panel, Spinner, btnDanger, btnPrimary, btnSecondary, btnSm, inputCls, num, text, useAction, useLoad, useMoney, type Tone } from "./ui";

const STATUS_TONE: Record<PurchaseStatus, Tone> = { DRAFT: "gray", ORDERED: "info", PARTLY_RECEIVED: "warn", RECEIVED: "ok", CANCELLED: "bad" };
const STATUSES: PurchaseStatus[] = ["DRAFT", "ORDERED", "PARTLY_RECEIVED", "RECEIVED", "CANCELLED"];

export default function PurchaseOrders({ garage }: { garage: Garage }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const [status, setStatus] = useState<PurchaseStatus | "ALL">("ALL");
  const orders = useLoad(() => listPurchaseOrders(status === "ALL" ? undefined : status), [status]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const open = orders.data?.items.find((o) => o.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Chip on={status === "ALL"} onClick={() => setStatus("ALL")}>
            {t("garage.po.all")}
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} on={status === s} onClick={() => setStatus(s)}>
              {t(`garage.po.status.${s}`)}
            </Chip>
          ))}
          <div className="flex-1" />
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            <Plus /> {t("garage.po.new")}
          </button>
        </div>
        {orders.error ? (
          <ErrorNote message={orders.error} onRetry={orders.reload} />
        ) : !orders.data ? (
          <Loading className="p-4!" />
        ) : orders.data.items.length === 0 ? (
          <Empty title={status === "ALL" ? t("garage.po.emptyTitle") : t("garage.po.noMatch")} body={status === "ALL" ? t("garage.po.emptyBody") : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-3 pr-3 font-medium">{t("garage.po.order")}</th>
                  <th className="pb-3 pr-3 font-medium">{t("garage.sup.supplier")}</th>
                  <th className="hidden pb-3 pr-3 font-medium sm:table-cell">{t("garage.po.lines")}</th>
                  <th className="pb-3 pr-3 font-medium">{t("garage.field.status")}</th>
                  <th className="pb-3 text-right font-medium">{t("garage.po.total")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.id} onClick={() => setOpenId(o.id)} className="cursor-pointer border-t border-border hover:bg-canvas/60">
                    <td className="py-3 pr-3">
                      <button type="button" onClick={() => setOpenId(o.id)} className="font-mono font-semibold hover:underline">
                        {o.reference}
                      </button>
                      <p className="text-xs text-muted-foreground">{formatDate(o.createdAt, { day: "numeric", month: "short", year: "numeric" })}</p>
                    </td>
                    <td className="py-3 pr-3">{o.supplierName}</td>
                    <td className="hidden py-3 pr-3 text-muted-foreground sm:table-cell">{t("garage.po.lineCount", { n: o.lines.length })}</td>
                    <td className="py-3 pr-3">
                      <Badge tone={STATUS_TONE[o.status]}>{t(`garage.po.status.${o.status}`)}</Badge>
                    </td>
                    <td className="py-3 text-right font-medium tabular-nums">{money(o.total, garage.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <OrderForm
        open={creating}
        garage={garage}
        order={null}
        onClose={() => setCreating(false)}
        onSaved={(o) => {
          setCreating(false);
          orders.reload();
          setOpenId(o.id);
        }}
      />
      <OrderPanel order={open} garage={garage} onClose={() => setOpenId(null)} onChanged={orders.reload} />
    </div>
  );
}

type DraftLine = { partId: string; quantity: string; unitCost: string };

/** Create a draft, or edit an existing one. */
function OrderForm({ open, garage, order, onClose, onSaved }: { open: boolean; garage: Garage; order: PurchaseOrder | null; onClose: () => void; onSaved: (o: PurchaseOrder) => void }) {
  const t = useT();
  const money = useMoney();
  const action = useAction();
  const suppliers = useLoad(() => (open ? listSuppliers() : Promise.resolve([])), [open]);
  const parts = useLoad(() => (open ? listParts({ limit: 200 }) : Promise.resolve(null)), [open]);
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? "");
  const [lines, setLines] = useState<DraftLine[]>(order ? order.lines.map((l) => ({ partId: l.partId, quantity: String(l.quantity), unitCost: String(l.unitCost) })) : []);
  const catalogue = parts.data?.items.filter((p) => p.active) ?? [];
  const partOf = (id: string) => catalogue.find((p) => p.id === id);
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const free = catalogue.filter((p) => !lines.some((l) => l.partId === p.id));

  const addPart = (p: Part, qty?: number) => setLines((ls) => (ls.some((l) => l.partId === p.id) ? ls : [...ls, { partId: p.id, quantity: String(qty ?? Math.max(1, Math.ceil(p.reorderLevel * 2 - p.stockQty))), unitCost: String(p.unitCost) }]));
  const suggest = () => {
    const low = catalogue.filter((p) => p.lowStock && (!supplierId || !p.supplierId || p.supplierId === supplierId));
    low.forEach((p) => addPart(p));
  };
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const valid = supplierId && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0 && Number(l.unitCost) >= 0 && l.unitCost !== "");

  async function save(note: string | null) {
    const payload = lines.map((l) => ({ partId: l.partId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) }));
    const o = await action.run("save", () => (order ? updatePurchaseOrder(order.id, { note, lines: payload }) : createPurchaseOrder({ supplierId, note, lines: payload })));
    if (o) onSaved(o);
  }

  return (
    <Panel open={open} onClose={onClose} title={order ? t("garage.po.edit", { ref: order.reference }) : t("garage.po.new")} description={t("garage.po.formBody")} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save(text(new FormData(e.currentTarget).get("note")));
        }}
      >
        <Card className="space-y-3 p-5">
          <Field label={t("garage.sup.supplier")}>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required disabled={!!order} className={inputCls}>
              <option value="" disabled>
                {t("garage.po.pickSupplier")}
              </option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          {suppliers.data && suppliers.data.length === 0 && <p className="text-sm text-muted-foreground">{t("garage.po.noSuppliers")}</p>}
          <Field label={t("garage.field.note")}>
            <input name="note" maxLength={500} defaultValue={order?.note ?? ""} placeholder={t("garage.po.notePlaceholder")} className={inputCls} />
          </Field>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h3 className="font-display text-lg font-semibold">{t("garage.po.items")}</h3>
            <div className="flex-1" />
            <button type="button" onClick={suggest} className={`${btnSecondary} ${btnSm}`}>
              <Wand2 /> {t("garage.po.suggest")}
            </button>
          </div>
          {lines.length > 0 && (
            <table className="mb-4 w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3 font-medium">{t("garage.field.partName")}</th>
                  <th className="pb-2 pr-2 text-right font-medium">{t("garage.po.qty")}</th>
                  <th className="pb-2 pr-2 text-right font-medium">{t("garage.po.unitCost")}</th>
                  <th className="pb-2 text-right font-medium">{t("garage.po.total")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = partOf(l.partId);
                  return (
                    <tr key={l.partId} className="border-t border-border/60">
                      <td className="py-2 pr-3">
                        <p className="font-medium">{p?.name ?? order?.lines.find((x) => x.partId === l.partId)?.name ?? l.partId}</p>
                        <p className="text-xs text-muted-foreground">{p ? t("garage.po.onHand", { n: p.stockQty }) : ""}</p>
                      </td>
                      <td className="py-2 pr-2">
                        <input type="number" min={0.01} step="any" required value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label={t("garage.po.qty")} className={`${inputCls} ml-auto w-20! py-1.5 text-right tabular-nums`} />
                      </td>
                      <td className="py-2 pr-2">
                        <input type="number" min={0} step="0.01" required value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} aria-label={t("garage.po.unitCost")} className={`${inputCls} ml-auto w-28! py-1.5 text-right tabular-nums`} />
                      </td>
                      <td className="py-2 text-right tabular-nums">{money((Number(l.quantity) || 0) * (Number(l.unitCost) || 0), garage.currency)}</td>
                      <td className="py-2 pl-2 text-right">
                        <button type="button" aria-label={t("garage.action.remove")} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-bad">
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <Field label={t("garage.po.addPart")}>
            <select
              value=""
              onChange={(e) => {
                const p = partOf(e.target.value);
                if (p) addPart(p);
              }}
              className={inputCls}
            >
              <option value="">{parts.data ? t("garage.po.pickPart") : t("garage.loading")}</option>
              {free.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku}) · {p.stockQty}
                </option>
              ))}
            </select>
          </Field>
          <p className="mt-4 text-right text-sm text-muted-foreground">
            {t("garage.po.total")}: <span className="font-display text-lg font-semibold text-foreground">{money(total, garage.currency)}</span>
          </p>
        </Card>

        {action.error && <ErrorNote message={action.error} />}
        <button type="submit" disabled={!valid || action.busy !== null} className={`${btnPrimary} w-full disabled:opacity-50`}>
          {action.busy && <Spinner />} {t("garage.po.saveDraft")}
        </button>
      </form>
    </Panel>
  );
}

function OrderPanel({ order, garage, onClose, onChanged }: { order: PurchaseOrder | null; garage: Garage; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  const [receiving, setReceiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});

  async function done<T>(key: string, fn: () => Promise<T>) {
    const result = await action.run(key, fn);
    if (result) {
      setReceiving(false);
      onChanged();
    }
  }
  const canReceive = order && (order.status === "ORDERED" || order.status === "PARTLY_RECEIVED");
  const arriving = order ? order.lines.map((l) => ({ line: l, n: Number(qty[l.id] ?? l.quantity - l.receivedQty) })).filter((x) => x.n > 0) : [];

  return (
    <>
      <Panel
        open={order !== null && !editing}
        onClose={() => {
          setReceiving(false);
          action.setError(null);
          onClose();
        }}
        title={order?.reference ?? ""}
        description={order ? <><Truck className="size-4" /> {order.supplierName} <Badge tone={STATUS_TONE[order.status]}>{t(`garage.po.status.${order.status}`)}</Badge></> : undefined}
        wide
      >
        {order && (
          <>
            <Card className="p-5">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">{t("garage.field.partName")}</th>
                    <th className="pb-2 pr-3 text-right font-medium">{t("garage.po.ordered")}</th>
                    <th className="pb-2 pr-3 text-right font-medium">{t("garage.po.received")}</th>
                    <th className="pb-2 pr-3 text-right font-medium">{t("garage.po.unitCost")}</th>
                    <th className="pb-2 text-right font-medium">{t("garage.po.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border/60">
                      <td className="py-2 pr-3">
                        <p className="font-medium">{l.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{l.sku}</p>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.quantity}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${l.receivedQty >= l.quantity ? "text-ok" : ""}`}>{l.receivedQty}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(l.unitCost, garage.currency)}</td>
                      <td className="py-2 text-right tabular-nums">{money(l.lineTotal, garage.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-right text-sm text-muted-foreground">
                {t("garage.po.total")}: <span className="font-display text-lg font-semibold text-foreground">{money(order.total, garage.currency)}</span>
              </p>
              {order.note && <p className="mt-2 text-sm text-muted-foreground">{order.note}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {t("garage.po.created", { date: formatDate(order.createdAt, { day: "numeric", month: "short", year: "numeric" }) })}
                {order.orderedAt ? ` · ${t("garage.po.placedOn", { date: formatDate(order.orderedAt, { day: "numeric", month: "short" }) })}` : ""}
                {order.receivedAt ? ` · ${t("garage.po.receivedOn", { date: formatDate(order.receivedAt, { day: "numeric", month: "short" }) })}` : ""}
              </p>
            </Card>

            <div className="flex flex-wrap gap-2">
              {order.status === "DRAFT" && (
                <>
                  <button type="button" disabled={action.busy !== null} onClick={() => done("place", () => placePurchaseOrder(order.id))} className={`${btnPrimary} ${btnSm}`}>
                    {action.busy === "place" ? <Spinner /> : <Send />} {t("garage.po.place")}
                  </button>
                  <button type="button" onClick={() => setEditing(true)} className={`${btnSecondary} ${btnSm}`}>
                    {t("garage.action.edit")}
                  </button>
                </>
              )}
              {canReceive && (
                <button type="button" onClick={() => setReceiving((r) => !r)} className={`${btnPrimary} ${btnSm}`}>
                  <PackageCheck /> {t("garage.po.receive")}
                </button>
              )}
              {(order.status === "DRAFT" || order.status === "ORDERED") && (
                <button type="button" disabled={action.busy !== null} onClick={() => done("cancel", () => cancelPurchaseOrder(order.id))} className={`${btnDanger} ${btnSm} ml-auto`}>
                  {action.busy === "cancel" && <Spinner />} {t("garage.po.cancel")}
                </button>
              )}
            </div>

            {receiving && canReceive && (
              <form
                className="space-y-3 rounded-2xl bg-white p-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  done("receive", () => receivePurchaseOrder(order.id, arriving.map((x) => ({ lineId: x.line.id, quantity: x.n }))));
                }}
              >
                <p className="text-sm">{t("garage.po.receiveBody")}</p>
                {order.lines
                  .filter((l) => l.receivedQty < l.quantity)
                  .map((l) => (
                    <div key={l.id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                      <span className="text-xs text-muted-foreground">{t("garage.po.outstanding", { n: l.quantity - l.receivedQty })}</span>
                      <input
                        type="number"
                        min={0}
                        max={l.quantity - l.receivedQty}
                        step="any"
                        aria-label={l.name}
                        value={qty[l.id] ?? String(l.quantity - l.receivedQty)}
                        onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                        className={`${inputCls} w-24! py-1.5 text-right tabular-nums`}
                      />
                    </div>
                  ))}
                <div className="flex gap-2">
                  <button type="submit" disabled={arriving.length === 0 || action.busy !== null} className={`${btnPrimary} ${btnSm} disabled:opacity-50`}>
                    {action.busy === "receive" && <Spinner />} {t("garage.po.bookIn")}
                  </button>
                  <button type="button" onClick={() => setReceiving(false)} className={`${btnSecondary} ${btnSm}`}>
                    {t("garage.action.cancel")}
                  </button>
                </div>
              </form>
            )}
            {action.error && <ErrorNote message={action.error} />}
          </>
        )}
      </Panel>
      {order && editing && (
        <OrderForm
          open
          garage={garage}
          order={order}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}
