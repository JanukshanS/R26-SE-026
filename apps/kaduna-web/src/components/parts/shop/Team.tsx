"use client";

/**
 * The people: staff the owner adds by email, each with a role (manager,
 * cashier, storekeeper), and the activity log of who did what.
 */
import { useState } from "react";
import { History, KeyRound, Search, UserPlus } from "lucide-react";

import { Avatar, Badge, Card, Chip, Empty, ErrorNote, Field, Loading, Panel, Spinner, btnPrimary, btnSecondary, inputCls, useAction, useDebounced, useLoad, useMoney, type Tone } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { STAFF_ROLES, addStaff, listActivity, listStaff, updateStaff, type Shop, type StaffMember, type StaffRole } from "@/lib/partsApi";

const ROLE_TONE: Record<StaffRole, Tone> = { MANAGER: "vio", CASHIER: "info", STOREKEEPER: "warn" };

export function Staff({ shop }: { shop: Shop }) {
  const t = useT();
  const { formatDate } = useI18n();
  const list = useLoad(listStaff, []);
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("shop.staff.intro", { shop: shop.name })}</p>
        <button type="button" onClick={() => setEditing("new")} className={btnPrimary}><UserPlus /> {t("shop.staff.add")}</button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {STAFF_ROLES.map((r) => (
          <Card key={r} className="p-4">
            <Badge tone={ROLE_TONE[r]} dot={false}>{t(`shop.role.${r}`)}</Badge>
            <p className="mt-2 text-xs text-muted-foreground">{t(`shop.role.${r}.can`)}</p>
          </Card>
        ))}
      </div>
      {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? (
        <Empty title={t("shop.staff.emptyTitle")} body={t("shop.staff.emptyBody")} />
      ) : (
        <Card className="p-0!">
          <ul className="divide-y divide-border text-sm">
            {list.data.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setEditing(s)} className={`flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-canvas ${s.active ? "" : "opacity-50"}`}>
                  <Avatar name={s.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.email}{s.phone && ` · ${s.phone}`}</span>
                  </span>
                  {s.hasPin && <KeyRound className="size-4 text-muted-foreground" aria-label={t("shop.staff.hasPin")} />}
                  <span className="hidden text-xs text-muted-foreground sm:block">{!s.active ? t("shop.staff.removed") : s.joined ? (s.lastSeenAt ? t("shop.staff.seen", { date: formatDate(s.lastSeenAt, { day: "numeric", month: "short" }) }) : t("shop.staff.joined")) : t("shop.staff.invited")}</span>
                  <Badge tone={ROLE_TONE[s.role]} dot={false}>{t(`shop.role.${s.role}`)}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <StaffPanel editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
    </div>
  );
}

function StaffPanel({ editing, onClose, onSaved }: { editing: StaffMember | "new" | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const action = useAction();
  const s = editing === "new" ? null : editing;
  const [role, setRole] = useState<StaffRole>("CASHIER");
  const key = editing === "new" ? "new" : editing?.id ?? "none";
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setRole(s?.role ?? "CASHIER");
  }

  async function submit(form: FormData) {
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim() || null;
    const ok = s
      ? await action.run("save", () => updateStaff(s.id, { name, phone, role }))
      : await action.run("save", () => addStaff({ email: String(form.get("email") ?? "").trim(), name, phone, role }));
    if (ok) onSaved();
  }

  return (
    <Panel open={editing !== null} onClose={onClose} title={s ? s.name : t("shop.staff.add")} description={s ? s.email : t("shop.staff.addBody")}>
      <form key={key} className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}>
        {!s && <Field label={t("garage.field.email")} hint={t("shop.staff.emailHint")}><input name="email" type="email" required maxLength={200} className={inputCls} /></Field>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("garage.field.name")}><input name="name" required maxLength={120} defaultValue={s?.name} className={inputCls} /></Field>
          <Field label={t("garage.field.phone")}><input name="phone" maxLength={40} defaultValue={s?.phone ?? ""} className={inputCls} /></Field>
        </div>
        <Field label={t("shop.staff.role")}>
          <div className="space-y-2">
            {STAFF_ROLES.map((r) => (
              <label key={r} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${role === r ? "border-primary bg-brand-soft" : "border-border bg-white"}`}>
                <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="mt-0.5 size-4 accent-primary" />
                <span><span className="block font-medium">{t(`shop.role.${r}`)}</span><span className="block text-xs text-muted-foreground">{t(`shop.role.${r}.can`)}</span></span>
              </label>
            ))}
          </div>
        </Field>
        {action.error && <ErrorNote message={action.error} />}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={action.busy !== null} className={btnPrimary}>{action.busy === "save" ? <Spinner /> : <UserPlus />} {s ? t("garage.action.save") : t("shop.staff.add")}</button>
          {s && (
            <button type="button" disabled={action.busy !== null} onClick={async () => (await action.run("active", () => updateStaff(s.id, { active: !s.active }))) && onSaved()} className={btnSecondary}>
              {action.busy === "active" && <Spinner />} {s.active ? t("shop.staff.remove") : t("shop.staff.restore")}
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}

const ACTIONS = ["sale", "cash", "stock", "catalogue", "purchase", "supplier", "account", "order", "staff"] as const;

export function Activity({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 300);
  const log = useLoad(() => listActivity({ action: kind || undefined, q: query || undefined, limit: 300 }), [kind, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={kind === ""} onClick={() => setKind("")}>{t("shop.activity.all")}</Chip>
        {ACTIONS.map((a) => <Chip key={a} on={kind === a} onClick={() => setKind(a)}>{t(`shop.activity.${a}`)}</Chip>)}
        <div className="relative ml-auto min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("shop.activity.search")} className={`${inputCls} pl-9`} />
        </div>
      </div>
      {log.error ? <ErrorNote message={log.error} onRetry={log.reload} /> : !log.data ? <Loading /> : log.data.length === 0 ? (
        <Empty title={t("shop.activity.none")} />
      ) : (
        <Card className="p-0!">
          <ul className="divide-y divide-border text-sm">
            {log.data.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block">{e.summary}</span>
                  <span className="block text-xs text-muted-foreground">{e.actorName} · {formatDate(e.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </span>
                {e.amount != null && e.amount !== 0 && <span className={`shrink-0 text-xs tabular-nums ${e.amount < 0 ? "text-bad" : "text-muted-foreground"}`}>{money(e.amount, shop.currency)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">{t("shop.activity.note")}</p>
    </div>
  );
}
