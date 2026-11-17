"use client";

/**
 * Orders from garages, from the shop's side: price them (and match requested
 * lines to stock), decline, mark ready, and hand over against the receiving
 * side's code, taking payment for pay-on-handover orders.
 */
import { useEffect, useState } from "react";
import { Check, ClipboardList, HardHat, KeyRound, Link2, PackageCheck, Phone, Truck, UserRound, Warehouse, X } from "lucide-react";

import { Card, Chip, Empty, ErrorNote, Field, Kpi, LIVE_MS, Loading, Spinner, btnDanger, btnPrimary, btnSecondary, btnSm, inputCls, useAction, useLiveLoad, useMoney, vehicleLabel } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { completeShopOrder, declineShopOrder, isOpenOrder, listShopOrders, markShopOrderReady, quoteShopOrder, type PaymentMethod, type Shop, type ShopOrder } from "@/lib/partsApi";

import { OrderStatusBadge, PaymentTermsBadge } from "../shared";
import { MethodChips, PartPicker } from "./common";

export default function ShopOrders({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const [openOnly, setOpenOnly] = useState(true);
  // New orders can arrive at any time, so it never slows right down.
  const orders = useLiveLoad(() => listShopOrders(openOnly ? { open: true } : {}), [openOnly], (d) => (d?.some((o) => isOpenOrder(o.status)) ? LIVE_MS.active : 30_000));
  const all = orders.data ?? [];
  const count = (s: ShopOrder["status"]) => all.filter((o) => o.status === s).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi tone="info" icon={ClipboardList} value={orders.data ? count("REQUESTED") : "–"} label={t("parts.kpi.toPrice")} />
        <Kpi tone="warn" icon={ClipboardList} value={orders.data ? count("QUOTED") : "–"} label={t("shop.orders.awaitingGarage")} />
        <Kpi tone="brand" icon={PackageCheck} value={orders.data ? count("CONFIRMED") : "–"} label={t("parts.kpi.toPack")} />
        <Kpi tone="vio" icon={Truck} value={orders.data ? count("READY") : "–"} label={t("parts.kpi.ready")} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip on={openOnly} onClick={() => setOpenOnly(true)}>{t("parts.filter.open")}</Chip>
        <Chip on={!openOnly} onClick={() => setOpenOnly(false)}>{t("parts.filter.all")}</Chip>
      </div>
      {orders.error && !orders.data ? (
        <ErrorNote message={orders.error} onRetry={orders.reload} />
      ) : !orders.data ? (
        <Loading />
      ) : all.length === 0 ? (
        <Empty title={t("parts.shopOrders.emptyTitle")} body={t("parts.shopOrders.emptyBody", { shop: shop.name })} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {all.map((o) => (
            <OrderCard key={o.id} shop={shop} order={o} onChanged={orders.reload} money={money} />
          ))}
        </div>
      )}
    </div>
  );
}

type Draft = { price: string; available: boolean; partId: string | null; partName: string | null };

function OrderCard({ shop, order: o, onChanged, money }: { shop: Shop; order: ShopOrder; onChanged: () => void; money: ReturnType<typeof useMoney> }) {
  const t = useT();
  const { formatDate } = useI18n();
  const action = useAction();
  const pricing = o.status === "REQUESTED" || o.status === "QUOTED";
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [matching, setMatching] = useState<string | null>(null);
  const [note, setNote] = useState(o.sellerNote ?? "");
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const cur = shop.currency;

  useEffect(() => {
    setDraft(Object.fromEntries(o.items.map((i) => [i.id, { price: i.unitPrice == null ? "" : String(i.unitPrice), available: i.available, partId: i.partId, partName: null }])));
    setNote(o.sellerNote ?? "");
    // Only when the order really changed: a background refresh mustn't wipe prices being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.id, o.updatedAt]);

  async function run(key: string, fn: () => Promise<unknown>) {
    if (await action.run(key, fn)) {
      setCode("");
      onChanged();
    }
  }

  const draftTotal = o.items.reduce((s, i) => {
    const d = draft[i.id];
    return d?.available && d.price ? s + Number(d.price) * i.quantity : s;
  }, 0);
  const allPriced = o.items.every((i) => !draft[i.id]?.available || draft[i.id]?.price !== "");
  const onHandover = o.paymentTerms === "ON_HANDOVER";

  return (
    <Card as="article" className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary"><Warehouse className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold">{o.garage.name}</p>
          <p className="text-xs text-muted-foreground">
            {t("parts.order.number", { n: o.number })} · {formatDate(o.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {o.job && ` · ${vehicleLabel(o.job.vehicle, t("garage.vehicle.unknown"))}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <OrderStatusBadge status={o.status} delivery={o.fulfilment === "DELIVERY"} />
          {o.paymentTerms && <PaymentTermsBadge terms={o.paymentTerms} paid={Boolean(o.paidAt)} />}
        </div>
      </div>

      {o.note && <p className="rounded-xl bg-canvas px-3 py-2 text-sm"><span className="font-medium">{o.garage.name}:</span> {o.note}</p>}

      <ul className="divide-y divide-border text-sm">
        {o.items.map((i) => {
          const d = draft[i.id] ?? { price: "", available: true, partId: i.partId, partName: null };
          return (
            <li key={i.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`min-w-0 flex-1 ${d.available ? "" : "text-muted-foreground line-through"}`}>
                  <span className="block truncate font-medium">{i.description}</span>
                  <span className="block text-xs text-muted-foreground">
                    {i.partNumber && <span className="font-mono">{i.partNumber} · </span>}
                    {i.partId || d.partId ? (d.partName ? t("shop.orders.matched", { part: d.partName }) : t("parts.item.fromCatalogue")) : t("parts.item.request")}
                  </span>
                </span>
                <span className="tabular-nums text-muted-foreground">× {i.quantity}</span>
                {pricing ? (
                  <>
                    <input type="number" min={0} step="0.01" disabled={!d.available} value={d.price} onChange={(e) => setDraft({ ...draft, [i.id]: { ...d, price: e.target.value } })} placeholder={t("parts.field.unitPrice")} aria-label={t("parts.field.unitPrice")} className={`${inputCls} w-28! py-1.5!`} />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={d.available} onChange={(e) => setDraft({ ...draft, [i.id]: { ...d, available: e.target.checked } })} className="size-4 accent-primary" /> {t("parts.item.inStock")}
                    </label>
                    {!i.partId && (
                      <button type="button" onClick={() => setMatching(matching === i.id ? null : i.id)} className={`${btnSecondary} ${btnSm}`} aria-label={t("shop.orders.match")}><Link2 /></button>
                    )}
                  </>
                ) : (
                  <span className="w-28 text-right tabular-nums">{!i.available ? t("parts.item.unavailable") : i.lineTotal == null ? "—" : money(i.lineTotal, cur)}</span>
                )}
              </div>
              {matching === i.id && (
                <div className="mt-2">
                  <PartPicker
                    autoFocus
                    placeholder={t("shop.orders.matchPlaceholder")}
                    onPick={(p) => {
                      setDraft({ ...draft, [i.id]: { ...d, partId: p.id, partName: p.name, price: d.price || String(p.tradePrice ?? p.retailPrice) } });
                      setMatching(null);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between border-t border-border pt-2 text-sm">
        <span className="text-muted-foreground">{t("parts.order.total")}</span>
        <span className="font-semibold tabular-nums">{pricing ? money(draftTotal, cur) : o.total == null ? "—" : money(o.total, cur)}</span>
      </div>

      <div className="flex items-start gap-2 text-sm">
        {o.fulfilment === "DELIVERY" ? (
          <><Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{t("parts.shopOrders.deliverTo", { address: o.deliveryAddress ?? "—" })}</span></>
        ) : o.collector?.kind === "MECHANIC" ? (
          <><HardHat className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{t("parts.shopOrders.mechanicCollects", { name: o.collector.name ?? "—", garage: o.garage.name })}{o.collector.phone && <> · <a href={`tel:${o.collector.phone}`} className="text-primary hover:underline">{o.collector.phone}</a></>}</span></>
        ) : (
          <><UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{t("parts.shopOrders.ownerCollects", { plate: o.job?.vehicle?.plate ?? "—" })}</span></>
        )}
      </div>
      {o.garage.phone && <a href={`tel:${o.garage.phone}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><Phone className="size-4" /> {t("parts.shopOrders.callGarage", { phone: o.garage.phone })}</a>}

      {pricing && (
        <Field label={t("parts.shopOrders.noteToGarage")}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t("parts.shopOrders.notePlaceholder")} className={inputCls} />
        </Field>
      )}
      {o.status === "QUOTED" && <p className="text-sm text-warn">{t("parts.shopOrders.waitingForGarage")}</p>}
      {!pricing && o.sellerNote && <p className="text-sm text-muted-foreground">{t("parts.shopOrders.yourNote")}: {o.sellerNote}</p>}

      {(o.status === "CONFIRMED" || o.status === "READY") && (
        <div className="space-y-3 rounded-2xl bg-canvas p-3">
          <p className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" /> {o.fulfilment === "DELIVERY" ? t("parts.shopOrders.codeDelivery") : t("parts.shopOrders.codePickup")}</p>
          {onHandover && (
            <Field label={t("shop.orders.paidHow", { total: o.total == null ? "" : money(o.total, cur) })}>
              <MethodChips value={method} onChange={setMethod} />
            </Field>
          )}
          {o.paymentTerms === "ACCOUNT" && <p className="text-xs text-muted-foreground">{t("shop.orders.onAccountNote")}</p>}
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label={t("parts.code.title")} className={`${inputCls} font-mono tracking-[0.3em]`} />
            <button type="button" disabled={action.busy !== null || code.length !== 6 || (onHandover && !method)} onClick={() => run("complete", () => completeShopOrder(o.id, code, method))} className={btnPrimary}>
              {action.busy === "complete" ? <Spinner /> : <Check />} {t("parts.action.handOver")}
            </button>
          </div>
        </div>
      )}

      {action.error && <ErrorNote message={action.error} />}

      {isOpenOrder(o.status) && (
        <div className="mt-auto flex flex-wrap gap-2">
          {pricing && (
            <button
              type="button"
              disabled={action.busy !== null || !allPriced || o.items.every((i) => !draft[i.id]?.available)}
              onClick={() =>
                run("quote", () =>
                  quoteShopOrder(o.id, {
                    items: o.items.map((i) => ({ id: i.id, available: draft[i.id]?.available ?? true, unitPrice: draft[i.id]?.available ? Number(draft[i.id].price) : null, partId: draft[i.id]?.partId ?? null })),
                    sellerNote: note.trim() || null,
                  })
                )
              }
              className={`${btnPrimary} ${btnSm}`}
            >
              {action.busy === "quote" ? <Spinner /> : <Check />} {o.items.every((i) => i.partId) ? t("parts.action.confirmOrder") : t("parts.action.sendQuote")}
            </button>
          )}
          {o.status === "CONFIRMED" && (
            <button type="button" disabled={action.busy !== null} onClick={() => run("ready", () => markShopOrderReady(o.id))} className={`${btnSecondary} ${btnSm}`}>
              {action.busy === "ready" ? <Spinner /> : <PackageCheck />} {o.fulfilment === "DELIVERY" ? t("parts.action.outForDelivery") : t("parts.action.readyToCollect")}
            </button>
          )}
          {o.status !== "READY" && (
            <button
              type="button"
              disabled={action.busy !== null}
              onClick={() => {
                const reason = window.prompt(t("parts.shopOrders.declineReason"));
                if (reason !== null) run("decline", () => declineShopOrder(o.id, reason.trim() || null));
              }}
              className={`${btnDanger} ${btnSm}`}
            >
              {action.busy === "decline" ? <Spinner /> : <X />} {t("parts.action.decline")}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
