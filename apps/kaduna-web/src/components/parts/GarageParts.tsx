"use client";

/**
 * The garage's side of parts shops (the parts-management service): finding
 * shops and adding them to "My sellers" (which opens a trade account there),
 * ordering parts for a job from a catalogue filtered to the job's car or as a
 * free-text request the shop prices, choosing delivery or who collects, and
 * following each order to the handover. Ordering is the owner's; mechanics
 * can follow.
 */
import { useEffect, useState } from "react";
import { Check, FileText, HardHat, PackageSearch, Phone, Plus, Search, ShoppingCart, Store, Trash2, Truck, UserRound, Wallet, X } from "lucide-react";

import {
  Badge,
  Card,
  CardHeader,
  Chip,
  Empty,
  ErrorNote,
  Field,
  LIVE_MS,
  Loading,
  Panel,
  Segmented,
  Spinner,
  btnDanger,
  btnPrimary,
  btnSecondary,
  btnSm,
  inputCls,
  useAction,
  useDebounced,
  useLiveLoad,
  useLoad,
  useMoney,
  vehicleLabel,
} from "@/components/garage/ui";
import type { Garage } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";
import {
  acceptPartOrder,
  cancelPartOrder,
  changePartOrderPickup,
  createPartOrder,
  getCatalogue,
  getPickupOptions,
  getStatement,
  isOpenOrder,
  linkShop,
  listPartOrders,
  listShops,
  unlinkShop,
  type AccountSummary,
  type DirectoryShop,
  type FulfilmentInput,
  type GarageOrder,
  type OrderVehicle,
  type PickupOptions,
} from "@/lib/partsApi";

import { HandoverCode, OrderStatusBadge, PaymentTermsBadge } from "./shared";

export type JobRef = { id: string; number: number; vehicle: OrderVehicle };

/** Quick while any order is still moving between the garage and the shop. */
const liveEvery = (d: GarageOrder[] | null) => (d?.some((o) => isOpenOrder(o.status)) ? LIVE_MS.active : LIVE_MS.idle);

// ─── The Parts tab ───────────────────────────────────────────────────────

export default function GarageParts({ garage, owner, onOpenJob }: { garage: Garage; owner: boolean; onOpenJob?: (id: string) => void }) {
  const t = useT();
  const [view, setView] = useState<"orders" | "sellers">("orders");
  const [ordering, setOrdering] = useState(false);
  const [openOnly, setOpenOnly] = useState(true);
  const orders = useLiveLoad(() => listPartOrders(openOnly ? { open: true } : {}), [openOnly], liveEvery);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={view}
          onChange={setView}
          label={t("parts.title")}
          options={[
            { value: "orders", label: <><ShoppingCart />{t("parts.garage.orders")}</> },
            { value: "sellers", label: <><Store />{t("parts.garage.sellers")}</> },
          ]}
        />
        {view === "orders" && (
          <>
            <Chip on={openOnly} onClick={() => setOpenOnly(true)}>{t("parts.filter.open")}</Chip>
            <Chip on={!openOnly} onClick={() => setOpenOnly(false)}>{t("parts.filter.all")}</Chip>
          </>
        )}
        {owner && view === "orders" && (
          <button type="button" onClick={() => setOrdering(true)} className={`${btnPrimary} ${btnSm} ml-auto`}>
            <Plus /> {t("parts.action.order")}
          </button>
        )}
      </div>

      {view === "sellers" ? (
        <ShopDirectory owner={owner} />
      ) : orders.error && !orders.data ? (
        <ErrorNote message={orders.error} onRetry={orders.reload} />
      ) : !orders.data ? (
        <Loading />
      ) : orders.data.length === 0 ? (
        <Empty
          title={openOnly ? t("parts.garage.noOpenOrders") : t("parts.garage.noOrders")}
          body={t("parts.garage.noOrdersBody")}
          action={owner ? <button type="button" onClick={() => setView("sellers")} className={btnSecondary}><Store /> {t("parts.garage.findSellers")}</button> : undefined}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {orders.data.map((o) => (
            <OrderCard key={o.id} order={o} garage={garage} owner={owner} onChanged={orders.reload} onOpenJob={onOpenJob} />
          ))}
        </div>
      )}

      {owner && <OrderPartsPanel garage={garage} job={null} open={ordering} onClose={() => setOrdering(false)} onPlaced={() => { setOrdering(false); orders.reload(); }} />}
    </div>
  );
}

// ─── A job's part orders (inside the job panel) ─────────────────────────

export function JobPartOrders({ garage, job, owner, locked }: { garage: Garage; job: JobRef; owner: boolean; locked: boolean }) {
  const t = useT();
  const [ordering, setOrdering] = useState(false);
  const orders = useLiveLoad(() => listPartOrders({ jobCardId: job.id }), [job.id], liveEvery);

  return (
    <Card className="p-5">
      <CardHeader
        title={t("parts.job.title")}
        sub={t("parts.job.sub")}
        action={
          owner && !locked ? (
            <button type="button" onClick={() => setOrdering(true)} className={`${btnSecondary} ${btnSm}`}>
              <ShoppingCart /> {t("parts.action.order")}
            </button>
          ) : undefined
        }
      />
      {orders.error && !orders.data ? (
        <ErrorNote message={orders.error} onRetry={orders.reload} />
      ) : !orders.data ? (
        <p className="text-sm text-muted-foreground"><Spinner /> {t("garage.loading")}</p>
      ) : orders.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("parts.job.none")}</p>
      ) : (
        <div className="space-y-3">
          {orders.data.map((o) => (
            <OrderCard key={o.id} order={o} garage={garage} owner={owner} onChanged={orders.reload} compact />
          ))}
        </div>
      )}
      {owner && <OrderPartsPanel garage={garage} job={job} open={ordering} onClose={() => setOrdering(false)} onPlaced={() => { setOrdering(false); orders.reload(); }} />}
    </Card>
  );
}

// ─── One order ───────────────────────────────────────────────────────────

function collectorText(o: GarageOrder, t: (k: string, v?: Record<string, string | number>) => string) {
  if (o.fulfilment === "DELIVERY") return t("parts.collector.delivery", { address: o.deliveryAddress ?? "—" });
  if (o.pickupBy === "MECHANIC") return t("parts.collector.mechanic", { name: o.pickupStaff?.name ?? "—" });
  return t("parts.collector.owner", { plate: o.job?.vehicle?.plate ?? "—" });
}

export function OrderCard({ order: o, garage, owner, onChanged, onOpenJob, compact = false }: { order: GarageOrder; garage: Garage; owner: boolean; onChanged: () => void; onOpenJob?: (id: string) => void; compact?: boolean }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  const [changing, setChanging] = useState(false);
  const open = isOpenOrder(o.status);

  async function run(key: string, fn: () => Promise<unknown>) {
    if (await action.run(key, fn)) onChanged();
  }

  return (
    <div className={`rounded-2xl border border-border bg-white ${compact ? "p-4" : "p-5"}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold">
            {o.shop.name} <span className="font-normal text-muted-foreground">· {t("parts.order.number", { n: o.number })}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(o.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {!compact && o.job && (
              <>
                {" · "}
                {onOpenJob ? (
                  <button type="button" onClick={() => onOpenJob(o.job!.id)} className="font-medium text-primary hover:underline">{t("garage.job.title", { n: o.job.number ?? "" })}</button>
                ) : (
                  t("garage.job.title", { n: o.job.number ?? "" })
                )}
                {o.job.vehicle?.plate && ` · ${o.job.vehicle.plate}`}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {o.paymentTerms && <PaymentTermsBadge terms={o.paymentTerms} paid={Boolean(o.paidAt)} />}
          <OrderStatusBadge status={o.status} delivery={o.fulfilment === "DELIVERY"} />
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border text-sm">
        {o.items.map((i) => (
          <li key={i.id} className={`flex items-center gap-2 py-2 ${i.available ? "" : "text-muted-foreground line-through"}`}>
            <span className="min-w-0 flex-1 truncate">
              {i.description}
              {i.partNumber && <span className="ml-1 font-mono text-xs text-muted-foreground">{i.partNumber}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">× {i.quantity}</span>
            <span className="w-28 shrink-0 text-right tabular-nums">
              {!i.available ? t("parts.item.unavailable") : i.unitPrice == null ? <span className="text-xs text-muted-foreground">{t("parts.item.awaitingPrice")}</span> : money(i.lineTotal ?? 0, o.shop.currency)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-sm">
        <span className="text-muted-foreground">{t("parts.order.total")}</span>
        <span className="font-semibold tabular-nums">{o.total == null ? t("parts.item.awaitingPrice") : money(o.total, o.shop.currency)}</span>
      </div>

      <p className="mt-3 flex items-start gap-2 text-sm">
        {o.fulfilment === "DELIVERY" ? <Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : o.pickupBy === "MECHANIC" ? <HardHat className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <span>{collectorText(o, t)}</span>
      </p>
      {o.sellerNote && <p className="mt-2 rounded-xl bg-canvas px-3 py-2 text-sm"><span className="font-medium">{o.shop.name}:</span> {o.sellerNote}</p>}
      {o.status === "QUOTED" && <p className="mt-2 text-sm font-medium text-warn">{t("parts.order.quoteWaiting")}</p>}
      {o.status === "COMPLETED" && o.job && <p className="mt-2 text-xs text-muted-foreground">{o.addedToJob ? t("parts.order.onJob") : t("parts.order.notOnJob")}</p>}

      {open && (o.status === "CONFIRMED" || o.status === "READY") && (
        <div className="mt-3">
          <HandoverCode
            code={o.handoverCode}
            hint={o.fulfilment === "DELIVERY" ? t("parts.code.hintDelivery") : o.pickupBy === "MECHANIC" ? t("parts.code.hintMechanic", { name: o.pickupStaff?.name ?? "" }) : t("parts.code.hintOwner")}
          />
        </div>
      )}

      {action.error && <div className="mt-3"><ErrorNote message={action.error} /></div>}

      {owner && open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {o.status === "QUOTED" && (
            <button type="button" disabled={action.busy !== null} onClick={() => run("accept", () => acceptPartOrder(o.id))} className={`${btnPrimary} ${btnSm}`}>
              {action.busy === "accept" ? <Spinner /> : <Check />} {t("parts.action.acceptQuote", { total: o.total == null ? "" : money(o.total, o.shop.currency) })}
            </button>
          )}
          <button type="button" disabled={action.busy !== null} onClick={() => setChanging(true)} className={`${btnSecondary} ${btnSm}`}>
            <Truck /> {t("parts.action.changeCollector")}
          </button>
          <button type="button" disabled={action.busy !== null} onClick={() => window.confirm(t("parts.order.confirmCancel")) && run("cancel", () => cancelPartOrder(o.id))} className={`${btnDanger} ${btnSm}`}>
            {action.busy === "cancel" ? <Spinner /> : <X />} {t("parts.action.cancel")}
          </button>
        </div>
      )}

      {owner && <ChangeCollectorPanel garage={garage} order={o} open={changing} onClose={() => setChanging(false)} onSaved={() => { setChanging(false); onChanged(); }} />}
    </div>
  );
}

// ─── Delivery or pickup, and who collects ───────────────────────────────

type Choice = { kind: "DELIVERY" | "MECHANIC" | "VEHICLE_OWNER"; staffId: string; address: string };

const toInput = (c: Choice): FulfilmentInput =>
  c.kind === "DELIVERY"
    ? { fulfilment: "DELIVERY", deliveryAddress: c.address.trim() || null }
    : c.kind === "MECHANIC"
      ? { fulfilment: "PICKUP", pickupBy: "MECHANIC", pickupStaffId: c.staffId || null }
      : { fulfilment: "PICKUP", pickupBy: "VEHICLE_OWNER" };

function CollectorPicker({ value, onChange, options, delivers, hasJob }: { value: Choice; onChange: (c: Choice) => void; options: PickupOptions | null; delivers: boolean; hasJob: boolean }) {
  const t = useT();
  const joined = (options?.mechanics ?? []).filter((m) => m.joined);
  const owner = options?.vehicleOwner ?? null;
  const ownerBlocked = !hasJob || !owner || owner.registered === false;
  const ownerHint = !hasJob
    ? t("parts.collect.ownerNeedsJob")
    : !owner
      ? t("parts.collect.ownerNoPlate")
      : owner.registered === false
        ? t("parts.collect.ownerNotRegistered", { plate: owner.plate })
        : owner.registered === null
          ? t("parts.collect.ownerUnknown", { plate: owner.plate })
          : t("parts.collect.ownerRegistered", { plate: owner.plate });

  const opt = (kind: Choice["kind"], icon: React.ReactNode, title: string, body: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={value.kind === kind}
      onClick={() => onChange({ ...value, kind })}
      className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${value.kind === kind ? "border-primary bg-brand-soft/60" : "border-border bg-white hover:bg-canvas"}`}
    >
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${value.kind === kind ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </button>
  );

  return (
    <div className="space-y-2">
      {opt("DELIVERY", <Truck className="size-4" />, t("parts.collect.delivery"), delivers ? t("parts.collect.deliveryBody") : t("parts.collect.noDelivery"), !delivers)}
      {value.kind === "DELIVERY" && delivers && (
        <Field label={t("parts.collect.address")} className="pl-12">
          <input value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} className={inputCls} maxLength={500} />
        </Field>
      )}
      {opt("MECHANIC", <HardHat className="size-4" />, t("parts.collect.mechanic"), joined.length ? t("parts.collect.mechanicBody") : t("parts.collect.noMechanics"), joined.length === 0)}
      {value.kind === "MECHANIC" && joined.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-12">
          {joined.map((m) => (
            <Chip key={m.id} on={value.staffId === m.id} onClick={() => onChange({ ...value, staffId: m.id })}>{m.name}</Chip>
          ))}
        </div>
      )}
      {opt("VEHICLE_OWNER", <UserRound className="size-4" />, t("parts.collect.owner"), ownerHint, ownerBlocked)}
    </div>
  );
}

function ChangeCollectorPanel({ garage, order, open, onClose, onSaved }: { garage: Garage; order: GarageOrder; open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const action = useAction();
  const options = useLoad(() => (open ? getPickupOptions(order.job?.id) : Promise.resolve(null)), [open, order.job?.id]);
  const [choice, setChoice] = useState<Choice>({ kind: "DELIVERY", staffId: "", address: garage.address ?? "" });

  useEffect(() => {
    if (!open) return;
    setChoice({
      kind: order.fulfilment === "DELIVERY" ? "DELIVERY" : order.pickupBy === "MECHANIC" ? "MECHANIC" : "VEHICLE_OWNER",
      staffId: order.pickupStaff?.id ?? "",
      address: order.deliveryAddress ?? garage.address ?? "",
    });
    // Keyed on updatedAt: a background refresh with no real change must not reset the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id, order.updatedAt, garage.address]);

  return (
    <Panel open={open} onClose={onClose} title={t("parts.action.changeCollector")} description={`${order.shop.name} · ${t("parts.order.number", { n: order.number })}`}>
      {options.error && <ErrorNote message={options.error} />}
      {/* The shop's delivery setting is re-checked by the server. */}
      <CollectorPicker value={choice} onChange={setChoice} options={options.data} delivers hasJob={order.job !== null} />
      {action.error && <ErrorNote message={action.error} />}
      <button type="button" disabled={action.busy !== null} onClick={async () => (await action.run("save", () => changePartOrderPickup(order.id, toInput(choice)))) && onSaved()} className={`${btnPrimary} w-full`}>
        {action.busy === "save" && <Spinner />} {t("garage.action.save")}
      </button>
    </Panel>
  );
}

/** "On account: LKR 40,000 left" or why not, for the order form and shop cards. */
function AccountLine({ account, currency }: { account: AccountSummary; currency: string }) {
  const t = useT();
  const money = useMoney();
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1"><Wallet className="size-3.5" />{account.available != null ? t("parts.account.available", { amount: money(account.available, currency) }) : account.onHold ? t("parts.account.onHold") : account.creditLimit > 0 ? t("parts.account.overLimit") : t("parts.account.cashOnly")}</span>
      {account.balance !== 0 && <span>{t("parts.account.owed", { amount: money(account.balance, currency) })}</span>}
    </p>
  );
}

// ─── Ordering ────────────────────────────────────────────────────────────

type Line = { key: string; partId: string | null; description: string; partNumber: string | null; quantity: number; price: number | null };

export function OrderPartsPanel({ garage, job, open, onClose, onPlaced }: { garage: Garage; job: JobRef | null; open: boolean; onClose: () => void; onPlaced: (o: GarageOrder) => void }) {
  const t = useT();
  const money = useMoney();
  const action = useAction();
  const shops = useLoad(() => (open ? listShops({ linked: true }) : Promise.resolve(null)), [open]);
  const options = useLoad(() => (open ? getPickupOptions(job?.id) : Promise.resolve(null)), [open, job?.id]);
  const [shopId, setShopId] = useState("");
  const [search, setSearch] = useState("");
  const [fitsOnly, setFitsOnly] = useState(true);
  const q = useDebounced(search);
  const cat = useLoad(() => (shopId ? getCatalogue(shopId, { q: q || undefined, jobCardId: job && fitsOnly ? job.id : undefined }) : Promise.resolve(null)), [shopId, q, job?.id, fitsOnly]);
  const [lines, setLines] = useState<Line[]>([]);
  const [free, setFree] = useState({ description: "", partNumber: "", quantity: "1" });
  const [choice, setChoice] = useState<Choice>({ kind: "DELIVERY", staffId: "", address: garage.address ?? "" });
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setLines([]);
    setSearch("");
    setNote("");
    setFitsOnly(true);
    setFree({ description: "", partNumber: "", quantity: "1" });
    setChoice({ kind: "DELIVERY", staffId: "", address: garage.address ?? "" });
    action.setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (shops.data && !shops.data.some((s) => s.id === shopId)) setShopId(shops.data[0]?.id ?? "");
  }, [shops.data, shopId]);
  const shop: DirectoryShop | null = shops.data?.find((s) => s.id === shopId) ?? null;
  useEffect(() => {
    if (shop && !shop.delivers) setChoice((c) => (c.kind === "DELIVERY" ? { ...c, kind: "MECHANIC" } : c));
  }, [shop]);

  const add = (line: Omit<Line, "key">) => setLines((ls) => [...ls, { ...line, key: `${Date.now()}-${ls.length}` }]);
  const known = lines.every((l) => l.price != null);
  const total = lines.reduce((s, l) => s + (l.price ?? 0) * l.quantity, 0);
  const currency = shop?.currency ?? "LKR";
  const v = cat.data?.vehicle;

  async function place() {
    const order = await action.run("place", () =>
      createPartOrder({
        shopId,
        jobCardId: job?.id ?? null,
        note: note.trim() || null,
        ...toInput(choice),
        items: lines.map((l) => (l.partId ? { partId: l.partId, quantity: l.quantity } : { description: l.description, partNumber: l.partNumber, quantity: l.quantity })),
      })
    );
    if (order) onPlaced(order);
  }

  return (
    <Panel wide open={open} onClose={onClose} title={t("parts.action.order")} description={job ? `${t("garage.job.title", { n: job.number })} · ${vehicleLabel(job.vehicle, t("garage.vehicle.unknown"))}` : t("parts.order.noJob")}>
      {shops.error ? (
        <ErrorNote message={shops.error} onRetry={shops.reload} />
      ) : !shops.data ? (
        <Loading />
      ) : shops.data.length === 0 ? (
        <Empty title={t("parts.order.noSellersTitle")} body={t("parts.order.noSellersBody")} />
      ) : (
        <>
          <Card className="space-y-4 p-5">
            <Field label={t("parts.order.shop")}>
              <select value={shopId} onChange={(e) => { setShopId(e.target.value); setLines([]); }} className={inputCls}>
                {shops.data.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>
                ))}
              </select>
            </Field>
            {shop?.account && <AccountLine account={shop.account} currency={currency} />}

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{t("parts.order.fromCatalogue")}</p>
                {job && (job.vehicle?.make || job.vehicle?.model) && (
                  <Chip on={fitsOnly} onClick={() => setFitsOnly(!fitsOnly)}>{t("parts.order.fitsOnly", { vehicle: [job.vehicle?.make, job.vehicle?.model, job.vehicle?.year].filter(Boolean).join(" ") })}</Chip>
                )}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("parts.order.searchCatalogue")} className={`${inputCls} pl-9`} />
              </div>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-border">
                {cat.error ? (
                  <p className="p-3 text-sm text-bad">{cat.error}</p>
                ) : !cat.data ? (
                  <p className="p-3 text-sm text-muted-foreground"><Spinner /> {t("garage.loading")}</p>
                ) : cat.data.parts.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">{v ? t("parts.order.noneFit") : q ? t("parts.order.noMatch") : t("parts.order.emptyCatalogue")}</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {cat.data.parts.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}{p.brand && <span className="font-normal text-muted-foreground"> · {p.brand}</span>}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[p.oemNumber ?? p.partNumber, p.universal ? t("parts.fit.universal") : p.fitments.map((f) => `${f.make} ${f.model}${f.yearFrom || f.yearTo ? ` ${f.yearFrom ?? ""}–${f.yearTo ?? ""}` : ""}`).join(", ")].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block tabular-nums">{money(p.price, currency)}</span>
                          <span className={`block text-xs ${p.stockQty > 0 ? "text-ok" : "text-bad"}`}>{p.stockQty > 0 ? t("parts.stock.n", { n: p.stockQty }) : t("parts.stock.out")}</span>
                        </span>
                        <button type="button" onClick={() => add({ partId: p.id, description: p.name, partNumber: p.oemNumber ?? p.partNumber, quantity: 1, price: p.price })} className={`${btnSecondary} ${btnSm}`} aria-label={t("parts.action.add")}>
                          <Plus />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("parts.order.notListed")}</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_9rem_5rem_auto]">
                <input value={free.description} onChange={(e) => setFree({ ...free, description: e.target.value })} placeholder={t("parts.order.describePart")} maxLength={200} className={inputCls} />
                <input value={free.partNumber} onChange={(e) => setFree({ ...free, partNumber: e.target.value })} placeholder={t("parts.field.partNumber")} maxLength={80} className={`${inputCls} font-mono`} />
                <input value={free.quantity} onChange={(e) => setFree({ ...free, quantity: e.target.value })} type="number" min={1} step="any" aria-label={t("garage.field.qty")} className={inputCls} />
                <button
                  type="button"
                  disabled={!free.description.trim() || !(Number(free.quantity) > 0)}
                  onClick={() => {
                    add({ partId: null, description: free.description.trim(), partNumber: free.partNumber.trim() || null, quantity: Number(free.quantity), price: null });
                    setFree({ description: "", partNumber: "", quantity: "1" });
                  }}
                  className={btnSecondary}
                >
                  <Plus /> {t("parts.action.add")}
                </button>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title={t("parts.order.lines")} sub={lines.length ? undefined : t("parts.order.linesEmpty")} />
            {lines.length > 0 && (
              <>
                <ul className="divide-y divide-border text-sm">
                  {lines.map((l) => (
                    <li key={l.key} className="flex items-center gap-2 py-2">
                      <span className="min-w-0 flex-1 truncate">
                        {l.description}
                        {l.partNumber && <span className="ml-1 font-mono text-xs text-muted-foreground">{l.partNumber}</span>}
                        {!l.partId && <> <Badge tone="warn" dot={false}>{t("parts.item.toQuote")}</Badge></>}
                      </span>
                      <input type="number" min={1} step="any" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: Number(e.target.value) || 1 } : x)))} aria-label={t("garage.field.qty")} className={`${inputCls} w-20! py-1.5!`} />
                      <span className="w-28 shrink-0 text-right tabular-nums">{l.price == null ? "—" : money(l.price * l.quantity, currency)}</span>
                      <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t("garage.action.remove")} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-bad-soft hover:text-bad">
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm">
                  <span className="text-muted-foreground">{known ? t("parts.order.total") : t("parts.order.totalSoFar")}</span>
                  <span className="font-semibold tabular-nums">{money(total, currency)}</span>
                </div>
                {!known && <p className="mt-1 text-xs text-muted-foreground">{t("parts.order.quoteNote")}</p>}
              </>
            )}
          </Card>

          <Card className="space-y-3 p-5">
            <CardHeader title={t("parts.collect.title")} sub={t("parts.collect.sub")} />
            {options.error && <ErrorNote message={options.error} />}
            <CollectorPicker value={choice} onChange={setChoice} options={options.data} delivers={shop?.delivers ?? true} hasJob={job !== null} />
            {shop?.deliveryNote && choice.kind === "DELIVERY" && <p className="text-xs text-muted-foreground">{shop.name}: {shop.deliveryNote}</p>}
            <Field label={t("parts.order.note")}>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className={inputCls} placeholder={t("parts.order.notePlaceholder")} />
            </Field>
          </Card>

          {action.error && <ErrorNote message={action.error} />}
          <button type="button" disabled={action.busy !== null || lines.length === 0 || !shopId || (choice.kind === "MECHANIC" && !choice.staffId)} onClick={place} className={`${btnPrimary} w-full`}>
            {action.busy === "place" ? <Spinner /> : <ShoppingCart />} {known ? t("parts.action.place") : t("parts.action.requestQuote")}
          </button>
        </>
      )}
    </Panel>
  );
}

// ─── Finding shops ───────────────────────────────────────────────────────

function ShopDirectory({ owner }: { owner: boolean }) {
  const t = useT();
  const money = useMoney();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const list = useLoad(() => listShops({ q: q || undefined }), [q]);
  const action = useAction();
  const [viewing, setViewing] = useState<DirectoryShop | null>(null);
  const [statementOf, setStatementOf] = useState<DirectoryShop | null>(null);

  async function toggle(s: DirectoryShop) {
    const linked = s.account?.linked;
    if (await action.run<unknown>(s.id, () => (linked ? unlinkShop(s.id) : linkShop(s.id)))) list.reload();
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("parts.garage.searchSellers")} className={`${inputCls} pl-9`} />
      </div>
      {action.error && <ErrorNote message={action.error} />}
      {list.error ? (
        <ErrorNote message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <Empty title={q ? t("parts.garage.noSellerMatch") : t("parts.garage.noSellers")} body={t("parts.garage.noSellersBody")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.data.map((s) => {
            const mine = Boolean(s.account?.linked);
            return (
              <Card key={s.id} as="article" className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary"><Store className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display font-semibold">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{[s.city, s.address].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  {mine && <Badge tone="ok">{t("parts.garage.mySeller")}</Badge>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge tone={s.delivers ? "info" : "gray"} dot={false}>{s.delivers ? t("parts.seller.delivers") : t("parts.seller.pickupOnly")}</Badge>
                  <Badge tone="gray" dot={false}>{t("parts.seller.listings", { count: s.partCount })}</Badge>
                  {mine && s.account!.creditLimit > 0 && <Badge tone="vio" dot={false}>{t("parts.account.creditBadge", { amount: money(s.account!.creditLimit, s.currency), days: s.account!.paymentDays })}</Badge>}
                </div>
                {mine && <div className="mt-2"><AccountLine account={s.account!} currency={s.currency} /></div>}
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <button type="button" onClick={() => setViewing(s)} className={`${btnSecondary} ${btnSm}`}><PackageSearch /> {t("parts.action.viewCatalogue")}</button>
                  {mine && <button type="button" onClick={() => setStatementOf(s)} className={`${btnSecondary} ${btnSm}`}><FileText /> {t("parts.account.statement")}</button>}
                  {s.phone && <a href={`tel:${s.phone}`} className={`${btnSecondary} ${btnSm}`} aria-label={t("garage.field.phone")}><Phone /></a>}
                  {owner && (
                    <button type="button" disabled={action.busy !== null} onClick={() => toggle(s)} className={`${mine ? btnSecondary : btnPrimary} ${btnSm} ml-auto`}>
                      {action.busy === s.id ? <Spinner /> : mine ? <X /> : <Plus />} {mine ? t("parts.action.removeSeller") : t("parts.action.addSeller")}
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <CataloguePanel shop={viewing} onClose={() => setViewing(null)} />
      <StatementPanel shop={statementOf} onClose={() => setStatementOf(null)} />
    </div>
  );
}

function CataloguePanel({ shop, onClose }: { shop: DirectoryShop | null; onClose: () => void }) {
  const t = useT();
  const money = useMoney();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const cat = useLoad(() => (shop ? getCatalogue(shop.id, { q: q || undefined }) : Promise.resolve(null)), [shop?.id, q]);
  return (
    <Panel open={shop !== null} onClose={onClose} title={shop?.name ?? ""} description={shop ? [shop.city, shop.phone].filter(Boolean).join(" · ") : undefined}>
      {shop?.deliveryNote && <p className="text-sm text-muted-foreground">{shop.deliveryNote}</p>}
      {shop?.openingHours && <p className="text-sm text-muted-foreground">{shop.openingHours}</p>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("parts.order.searchCatalogue")} className={`${inputCls} pl-9`} />
      </div>
      {cat.error ? (
        <ErrorNote message={cat.error} onRetry={cat.reload} />
      ) : !cat.data ? (
        <Loading />
      ) : cat.data.parts.length === 0 ? (
        <Empty title={q ? t("parts.order.noMatch") : t("parts.order.emptyCatalogue")} />
      ) : (
        <Card className="p-0!">
          <ul className="divide-y divide-border text-sm">
            {cat.data.parts.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[p.brand, p.oemNumber ?? p.partNumber, p.universal ? t("parts.fit.universal") : p.fitments.map((f) => `${f.make} ${f.model}`).join(", ")].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block tabular-nums">{money(p.price, shop?.currency)}</span>
                  <span className={`block text-xs ${p.stockQty > 0 ? "text-ok" : "text-bad"}`}>{p.stockQty > 0 ? t("parts.stock.n", { n: p.stockQty }) : t("parts.stock.out")}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Panel>
  );
}

function StatementPanel({ shop, onClose }: { shop: DirectoryShop | null; onClose: () => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const st = useLoad(() => (shop ? getStatement(shop.id) : Promise.resolve(null)), [shop?.id]);
  return (
    <Panel open={shop !== null} onClose={onClose} title={t("parts.account.statementWith", { shop: shop?.name ?? "" })}>
      {st.error ? (
        <ErrorNote message={st.error} onRetry={st.reload} />
      ) : !st.data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4"><p className="text-xs text-muted-foreground">{t("parts.account.owedLabel")}</p><p className="mt-1 font-display text-lg font-bold tabular-nums">{money(st.data.balance, shop?.currency)}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground">{t("parts.account.overdueLabel")}</p><p className={`mt-1 font-display text-lg font-bold tabular-nums ${st.data.overdue > 0 ? "text-bad" : ""}`}>{money(st.data.overdue, shop?.currency)}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground">{t("parts.account.limitLabel")}</p><p className="mt-1 font-display text-lg font-bold tabular-nums">{st.data.creditLimit > 0 ? money(st.data.creditLimit, shop?.currency) : "—"}</p></Card>
          </div>
          {st.data.entries.length === 0 ? (
            <Empty title={t("parts.account.noEntries")} />
          ) : (
            <Card className="p-0!">
              <ul className="divide-y divide-border text-sm">
                {st.data.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t(`parts.entry.${e.kind}`)}{e.order && ` · ${t("parts.order.number", { n: e.order.number })}`}</span>
                      <span className="block truncate text-xs text-muted-foreground">{formatDate(e.createdAt, { day: "numeric", month: "short", year: "numeric" })}{e.note && ` · ${e.note}`}{e.reference && ` · ${e.reference}`}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block tabular-nums ${e.amount < 0 ? "text-ok" : ""}`}>{money(e.amount, shop?.currency)}</span>
                      <span className="block text-xs tabular-nums text-muted-foreground">{money(e.balance, shop?.currency)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Panel>
  );
}
