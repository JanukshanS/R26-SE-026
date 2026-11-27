"use client";

/**
 * Where parts come from. The reorder list groups low parts by their usual
 * supplier with a ready-to-send order message; each supplier shows what was
 * bought from them, and stock can be received against them.
 */
import { useState } from "react";
import { MessageCircle, Package, PackagePlus, Phone, Plus, ShoppingCart, Truck, Wallet } from "lucide-react";

import {
  adjustStock,
  createSupplier,
  getSupplier,
  listParts,
  listSuppliers,
  updateSupplier,
  type Garage,
  type Part,
  type SupplierInput,
  type SupplierRow,
} from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import {
  Badge,
  Card,
  CardHeader,
  Empty,
  ErrorNote,
  Field,
  Kpi,
  Loading,
  Panel,
  Spinner,
  btnPrimary,
  btnSecondary,
  btnSm,
  inputCls,
  num,
  text,
  useAction,
  useLoad,
  useMoney,
  useShortMoney,
} from "./ui";

/** Enough to get back comfortably above the reorder level. */
const suggestQty = (p: Part) => Math.max(1, Math.ceil(p.reorderLevel * 2 - p.stockQty));
const waNumber = (phone: string | null) => {
  const p = (phone ?? "").replace(/[^\d+]/g, "");
  return p.startsWith("+") ? p.slice(1) : p.startsWith("0") ? `94${p.slice(1)}` : p;
};

export default function Suppliers({ garage }: { garage: Garage }) {
  const t = useT();
  const short = useShortMoney();
  const { formatDate } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const suppliers = useLoad(() => listSuppliers({ includeInactive: true }), []);
  const parts = useLoad(() => listParts({ limit: 200 }).then((p) => p.items), []);
  const action = useAction();

  const rows = suppliers.data ?? [];
  const low = (parts.data ?? []).filter((p) => p.lowStock);
  const groups = new Map<string | null, Part[]>();
  for (const p of low) groups.set(p.supplierId, [...(groups.get(p.supplierId) ?? []), p]);
  const byId = new Map(rows.map((s) => [s.id, s]));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi tone="brand" icon={Truck} value={rows.filter((s) => s.active).length} label={t("garage.sup.active")} />
        <Kpi tone="info" icon={Wallet} value={short(rows.reduce((s, r) => s + r.totalSpend, 0), garage.currency)} label={t("garage.sup.totalSpend")} />
        <Kpi tone="vio" icon={Package} value={(parts.data ?? []).filter((p) => p.supplierId).length} label={t("garage.sup.linkedParts")} delta={t("garage.sup.ofParts", { n: (parts.data ?? []).length })} />
        <Kpi tone={low.length ? "warn" : "ok"} icon={ShoppingCart} value={low.length} label={t("garage.sup.toReorder")} />
      </div>

      {low.length > 0 && (
        <Card>
          <CardHeader title={t("garage.sup.reorderTitle")} sub={t("garage.sup.reorderSub")} />
          <div className="grid gap-4 lg:grid-cols-2">
            {[...groups.entries()].map(([supplierId, items]) => {
              const s = supplierId ? byId.get(supplierId) : null;
              const message = t("garage.sup.orderMessage", {
                garage: garage.name,
                lines: items.map((p) => `• ${p.name} (${p.sku}) × ${suggestQty(p)}`).join("\n"),
              });
              return (
                <div key={supplierId ?? "none"} className="rounded-2xl border border-border p-4">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 font-semibold">{s?.name ?? t("garage.sup.noSupplier")}</p>
                    {s?.phone && (
                      <>
                        <a href={`tel:${s.phone}`} aria-label={t("garage.field.phone")} className={`${btnSecondary} ${btnSm}`}>
                          <Phone />
                        </a>
                        <a href={`https://wa.me/${waNumber(s.phone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className={`${btnPrimary} ${btnSm}`}>
                          <MessageCircle /> {t("garage.sup.sendOrder")}
                        </a>
                      </>
                    )}
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {items.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{p.name} <span className="font-mono text-xs text-muted-foreground">{p.sku}</span></span>
                        <Badge tone={p.stockQty <= 0 ? "bad" : "warn"}>{p.stockQty} / {p.reorderLevel}</Badge>
                        <span className="w-14 text-right text-xs font-semibold tabular-nums">+{suggestQty(p)}</span>
                      </li>
                    ))}
                  </ul>
                  {!s && <p className="mt-2 text-xs text-muted-foreground">{t("garage.sup.linkHint")}</p>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="p-0 sm:p-0">
        <div className="flex items-center gap-3 px-6 pb-2 pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">{t("garage.sup.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("garage.sup.sub")}</p>
          </div>
          <button type="button" onClick={() => setAdding(true)} className={btnPrimary}>
            <Plus /> {t("garage.sup.add")}
          </button>
        </div>
        {suppliers.error ? (
          <div className="p-6"><ErrorNote message={suppliers.error} onRetry={suppliers.reload} /></div>
        ) : !suppliers.data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <div className="p-6"><Empty title={t("garage.sup.emptyTitle")} body={t("garage.sup.emptyBody")} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 pb-3 pt-3 font-medium">{t("garage.field.name")}</th>
                  <th className="hidden px-3 pb-3 pt-3 font-medium md:table-cell">{t("garage.sup.contact")}</th>
                  <th className="px-3 pb-3 pt-3 text-right font-medium">{t("garage.sup.parts")}</th>
                  <th className="px-3 pb-3 pt-3 text-right font-medium">{t("garage.sup.spend")}</th>
                  <th className="hidden px-6 pb-3 pt-3 font-medium sm:table-cell">{t("garage.sup.lastPurchase")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} onClick={() => setOpenId(s.id)} className={`cursor-pointer border-t border-border hover:bg-canvas/60 ${s.active ? "" : "opacity-50"}`}>
                    <td className="px-6 py-3.5">
                      <button type="button" className="font-medium hover:underline" onClick={() => setOpenId(s.id)}>{s.name}</button>
                      {!s.active && <span className="ml-2"><Badge tone="gray">{t("garage.parts.inactive")}</Badge></span>}
                    </td>
                    <td className="hidden px-3 py-3.5 text-muted-foreground md:table-cell">{[s.contactName, s.phone].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums">{s.partCount ?? 0}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right font-medium tabular-nums">{short(s.totalSpend, garage.currency)}</td>
                    <td className="hidden px-6 py-3.5 text-muted-foreground sm:table-cell">{s.lastPurchaseAt ? formatDate(s.lastPurchaseAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Panel open={adding} onClose={() => setAdding(false)} title={t("garage.sup.add")}>
        <SupplierForm
          busy={action.busy === "add"}
          error={action.error}
          onSubmit={async (input) => {
            const created = await action.run("add", () => createSupplier(input));
            if (created) {
              setAdding(false);
              suppliers.reload();
            }
          }}
        />
      </Panel>

      <SupplierPanel
        garage={garage}
        supplierId={openId}
        allParts={parts.data ?? []}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          suppliers.reload();
          parts.reload();
        }}
      />
    </div>
  );
}

function SupplierPanel({
  garage,
  supplierId,
  allParts,
  onClose,
  onChanged,
}: {
  garage: Garage;
  supplierId: string | null;
  allParts: Part[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const detail = useLoad(() => (supplierId ? getSupplier(supplierId) : Promise.resolve(null)), [supplierId]);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const s = detail.data && detail.data.id === supplierId ? detail.data : null;

  return (
    <Panel
      wide
      open={supplierId !== null}
      onClose={() => {
        setEditing(false);
        onClose();
      }}
      title={s?.name ?? t("garage.loading")}
      description={s ? <span className="text-xs text-muted-foreground">{[s.contactName, s.phone, s.email].filter(Boolean).join(" · ")}</span> : undefined}
    >
      {detail.error ? (
        <ErrorNote message={detail.error} onRetry={detail.reload} />
      ) : !s ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi tone="info" icon={Wallet} value={money(s.totalSpend, garage.currency)} label={t("garage.sup.spend")} />
            <Kpi tone="vio" icon={Package} value={s.parts.length} label={t("garage.sup.parts")} />
            <Kpi tone="brand" icon={PackagePlus} value={s.purchases.length} label={t("garage.sup.deliveries")} />
          </div>

          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="flex-1 font-semibold">{t("garage.sup.details")}</h3>
              <button type="button" onClick={() => setEditing((e) => !e)} className={`${btnSecondary} ${btnSm}`}>{t("garage.action.edit")}</button>
              <button
                type="button"
                disabled={action.busy !== null}
                onClick={async () => {
                  const next = await action.run("toggle", () => updateSupplier(s.id, { active: !s.active }));
                  if (next) {
                    detail.reload();
                    onChanged();
                  }
                }}
                className={`${btnSecondary} ${btnSm}`}
              >
                {s.active ? t("garage.sup.deactivate") : t("garage.sup.activate")}
              </button>
            </div>
            {editing ? (
              <div className="mt-4">
                <SupplierForm
                  supplier={s}
                  busy={action.busy === "edit"}
                  error={action.error}
                  onSubmit={async (input) => {
                    const next = await action.run("edit", () => updateSupplier(s.id, input));
                    if (next) {
                      setEditing(false);
                      detail.reload();
                      onChanged();
                    }
                  }}
                />
              </div>
            ) : (
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <Detail label={t("garage.sup.contact")} value={s.contactName} />
                <Detail label={t("garage.field.phone")} value={s.phone} />
                <Detail label={t("garage.field.email")} value={s.email} />
                <Detail label={t("garage.field.address")} value={s.address} />
                {s.notes && <div className="sm:col-span-2"><Detail label={t("garage.field.notes")} value={s.notes} /></div>}
              </dl>
            )}
          </Card>

          <ReceiveStock
            garage={garage}
            parts={allParts.filter((p) => p.active)}
            preferred={s.parts.map((p) => p.id)}
            busy={action.busy === "receive"}
            onReceive={async (partId, quantity, unitCost, note) => {
              const ok = await action.run("receive", () => adjustStock(partId, { quantityChange: quantity, reason: "PURCHASE", supplierId: s.id, unitCost, note }));
              if (ok) {
                detail.reload();
                onChanged();
              }
              return Boolean(ok);
            }}
          />
          {action.error && !editing && <ErrorNote message={action.error} />}

          <Card className="p-5">
            <h3 className="mb-3 font-semibold">{t("garage.sup.theirParts")}</h3>
            {s.parts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("garage.sup.noParts")}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {s.parts.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-2.5">
                    <span className="min-w-0 flex-1 truncate">{p.name} <span className="font-mono text-xs text-muted-foreground">{p.sku}</span></span>
                    <span className="text-xs text-muted-foreground tabular-nums">{money(p.unitCost, garage.currency)}</span>
                    <Badge tone={p.lowStock ? "warn" : "ok"}>{p.stockQty}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 font-semibold">{t("garage.sup.history")}</h3>
            {s.purchases.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("garage.sup.noPurchases")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-medium">{t("garage.sup.date")}</th>
                      <th className="pb-2 font-medium">{t("garage.sup.part")}</th>
                      <th className="pb-2 text-right font-medium">{t("garage.field.qty")}</th>
                      <th className="pb-2 text-right font-medium">{t("garage.invoice.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.purchases.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="py-2.5 text-muted-foreground">{formatDate(m.createdAt, { day: "numeric", month: "short", year: "numeric" })}</td>
                        <td className="py-2.5">{m.partName}{m.note && <span className="block text-xs text-muted-foreground">{m.note}</span>}</td>
                        <td className="py-2.5 text-right tabular-nums">{m.quantityChange}</td>
                        <td className="whitespace-nowrap py-2.5 text-right font-medium tabular-nums">{m.unitCost != null ? money(m.quantityChange * m.unitCost, garage.currency) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Panel>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-line font-medium">{value || "—"}</dd>
    </div>
  );
}

function ReceiveStock({
  garage,
  parts,
  preferred,
  busy,
  onReceive,
}: {
  garage: Garage;
  parts: Part[];
  preferred: string[];
  busy: boolean;
  onReceive: (partId: string, quantity: number, unitCost: number | null, note: string | null) => Promise<boolean>;
}) {
  const t = useT();
  const money = useMoney();
  const [partId, setPartId] = useState("");
  const part = parts.find((p) => p.id === partId);
  const ordered = [...parts].sort((a, b) => Number(preferred.includes(b.id)) - Number(preferred.includes(a.id)) || a.name.localeCompare(b.name));
  return (
    <Card className="p-5">
      <h3 className="font-semibold">{t("garage.sup.receive")}</h3>
      <p className="text-xs text-muted-foreground">{t("garage.sup.receiveSub")}</p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-6"
        onSubmit={async (e) => {
          e.preventDefault();
          const el = e.currentTarget;
          const form = new FormData(el);
          const qty = num(form.get("qty"));
          if (!partId || !qty) return;
          if (await onReceive(partId, qty, num(form.get("unitCost")), text(form.get("note")))) {
            el.reset();
            setPartId("");
          }
        }}
      >
        <Field label={t("garage.sup.part")} className="sm:col-span-6">
          <select value={partId} onChange={(e) => setPartId(e.target.value)} required className={inputCls}>
            <option value="">{t("garage.sup.choosePart")}</option>
            {ordered.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}){preferred.includes(p.id) ? " ★" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("garage.field.qty")} className="sm:col-span-2">
          <input name="qty" type="number" min={0.01} step="0.01" required className={inputCls} />
        </Field>
        <Field label={t("garage.sup.unitCost")} hint={part ? t("garage.sup.lastCost", { cost: money(part.unitCost, garage.currency) }) : undefined} className="sm:col-span-2">
          <input name="unitCost" type="number" min={0} step="0.01" placeholder={part ? String(part.unitCost) : ""} key={partId} className={inputCls} />
        </Field>
        <Field label={t("garage.sup.reference")} className="sm:col-span-2">
          <input name="note" maxLength={240} placeholder={t("garage.sup.referencePlaceholder")} className={inputCls} />
        </Field>
        <div className="sm:col-span-6">
          <button type="submit" disabled={busy || !partId} className={btnPrimary}>
            {busy ? <Spinner /> : <PackagePlus />} {t("garage.sup.receiveSubmit")}
          </button>
        </div>
      </form>
    </Card>
  );
}

function SupplierForm({ supplier, busy, error, onSubmit }: { supplier?: SupplierRow | SupplierInput; busy: boolean; error: string | null; onSubmit: (input: SupplierInput) => void }) {
  const t = useT();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        onSubmit({
          name: text(form.get("name")) ?? "",
          contactName: text(form.get("contactName")),
          phone: text(form.get("phone")),
          email: text(form.get("email")),
          address: text(form.get("address")),
          notes: text(form.get("notes")),
        });
      }}
    >
      <Card className="space-y-3 p-5">
        <Field label={t("garage.field.name")}>
          <input name="name" required maxLength={160} defaultValue={supplier?.name} className={inputCls} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("garage.sup.contact")}>
            <input name="contactName" maxLength={120} defaultValue={supplier?.contactName ?? ""} className={inputCls} />
          </Field>
          <Field label={t("garage.field.phone")}>
            <input name="phone" type="tel" maxLength={40} defaultValue={supplier?.phone ?? ""} className={inputCls} />
          </Field>
        </div>
        <Field label={t("garage.field.email")}>
          <input name="email" type="email" maxLength={200} defaultValue={supplier?.email ?? ""} className={inputCls} />
        </Field>
        <Field label={t("garage.field.address")}>
          <input name="address" maxLength={500} defaultValue={supplier?.address ?? ""} className={inputCls} />
        </Field>
        <Field label={t("garage.field.notes")}>
          <textarea name="notes" rows={2} maxLength={2000} defaultValue={supplier?.notes ?? ""} className={inputCls} />
        </Field>
      </Card>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
        {busy && <Spinner />} {t("garage.action.save")}
      </button>
    </form>
  );
}
