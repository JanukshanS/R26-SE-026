"use client";

/**
 * The garage's mechanics. Adding one gives an invite code; the mechanic signs
 * in at /workshop with their own Kaduna account and enters it. Each card shows
 * their open work and this month's output from the report.
 */
import { useState } from "react";
import { BadgeCheck, ClipboardList, Copy, HardHat, KeyRound, MessageCircle, Plus, Power, Timer, UserPlus } from "lucide-react";

import { createStaff, getReport, listJobCards, listStaff, resetStaffInvite, updateStaff, type Garage, type StaffMember } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  Empty,
  ErrorNote,
  Field,
  Kpi,
  Loading,
  Panel,
  Progress,
  Spinner,
  btnPrimary,
  btnSecondary,
  btnSm,
  inputCls,
  text,
  toneFor,
  useAction,
  useLoad,
  useMoney,
} from "./ui";

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

export default function Staff({ garage }: { garage: Garage }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const staff = useLoad(listStaff, []);
  const work = useLoad(async () => {
    const [jobs, report] = await Promise.all([listJobCards({ active: true, limit: 200 }), getReport(monthStart())]);
    return { jobs: jobs.items, report };
  }, []);
  const action = useAction();

  const members = staff.data ?? [];
  const active = members.filter((m) => m.active);
  const openFor = (id: string) => (work.data?.jobs ?? []).filter((j) => j.mechanic?.id === id).length;
  const monthFor = (id: string) => work.data?.report.mechanics.find((m) => m.mechanicId === id);
  const unassigned = (work.data?.jobs ?? []).filter((j) => !j.mechanic).length;
  const busiest = Math.max(1, ...active.map((m) => openFor(m.id)));

  const replace = (next: StaffMember) => staff.setData(members.map((m) => (m.id === next.id ? next : m)));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi tone="brand" icon={HardHat} value={active.length} label={t("garage.staff.active")} />
        <Kpi tone="ok" icon={BadgeCheck} value={active.filter((m) => m.joined).length} label={t("garage.staff.signedIn")} delta={active.some((m) => !m.joined) ? t("garage.staff.pendingInvites", { n: active.filter((m) => !m.joined).length }) : undefined} />
        <Kpi tone="info" icon={ClipboardList} value={(work.data?.jobs ?? []).length} label={t("garage.staff.openJobs")} delta={unassigned ? t("garage.staff.unassignedJobs", { n: unassigned }) : undefined} />
        <Kpi tone="vio" icon={Timer} value={work.data?.report.jobs.closed ?? "—"} label={t("garage.staff.closedMonth")} />
      </div>

      <Card>
        <CardHeader
          title={t("garage.staff.title")}
          sub={t("garage.staff.sub")}
          action={
            <button type="button" onClick={() => setAdding(true)} className={btnPrimary}>
              <UserPlus /> {t("garage.staff.add")}
            </button>
          }
        />
        {staff.error ? (
          <ErrorNote message={staff.error} onRetry={staff.reload} />
        ) : !staff.data ? (
          <Loading />
        ) : members.length === 0 ? (
          <Empty title={t("garage.staff.emptyTitle")} body={t("garage.staff.emptyBody")} action={<button type="button" onClick={() => setAdding(true)} className={btnPrimary}><Plus /> {t("garage.staff.add")}</button>} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {members.map((m) => {
              const open = openFor(m.id);
              const month = monthFor(m.id);
              return (
                <article key={m.id} className={`rounded-2xl border border-border p-5 ${m.active ? "" : "opacity-60"}`}>
                  <div className="flex items-start gap-3">
                    <Avatar name={m.name} tone={toneFor(m.name)} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-base font-semibold">{m.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{m.phone ?? t("garage.job.noPhone")}</p>
                      <div className="mt-1.5">
                        {!m.active ? (
                          <Badge tone="gray">{t("garage.staff.off")}</Badge>
                        ) : m.joined ? (
                          <Badge tone="ok">{t("garage.staff.joinedOn", { date: formatDate(m.joinedAt!, { day: "numeric", month: "short" }) })}</Badge>
                        ) : (
                          <Badge tone="warn">{t("garage.staff.invited")}</Badge>
                        )}
                      </div>
                    </div>
                    <button type="button" onClick={() => setEditing(m)} className={`${btnSecondary} ${btnSm}`}>
                      {t("garage.action.edit")}
                    </button>
                  </div>

                  {m.active && !m.joined && m.inviteCode && <Invite member={m} garage={garage} />}

                  {m.active && (
                    <div className="mt-4 space-y-3 border-t border-border pt-4 text-sm">
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{t("garage.staff.workload")}</span>
                          <span className="font-semibold text-foreground">{t("garage.staff.jobsOpen", { n: open })}</span>
                        </div>
                        <Progress value={(open / busiest) * 100} tone={open > 4 ? "warn" : "brand"} className="mt-1.5" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-canvas px-3 py-2">
                          <p className="text-[11px] text-muted-foreground">{t("garage.staff.closedMonth")}</p>
                          <p className="font-semibold tabular-nums">{month?.jobsClosed ?? 0}</p>
                        </div>
                        <div className="rounded-xl bg-canvas px-3 py-2">
                          <p className="text-[11px] text-muted-foreground">{t("garage.staff.labourMonth")}</p>
                          <p className="truncate font-semibold tabular-nums">{money(month?.labour ?? 0, garage.currency)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="flex flex-wrap items-center gap-4">
        <span className="grid size-11 place-items-center rounded-2xl bg-info-soft text-info"><KeyRound className="size-5" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">{t("garage.staff.howTitle")}</p>
          <p className="text-muted-foreground">{t("garage.staff.howBody", { url: typeof window === "undefined" ? "/workshop" : `${window.location.origin}/workshop` })}</p>
        </div>
      </Card>

      <Panel open={adding} onClose={() => setAdding(false)} title={t("garage.staff.add")} description={t("garage.staff.addBody")}>
        <StaffForm
          busy={action.busy === "add"}
          error={action.error}
          onSubmit={async (input) => {
            const created = await action.run("add", () => createStaff({ name: input.name!, phone: input.phone }));
            if (created) {
              staff.setData([...members, created]);
              setAdding(false);
            }
          }}
        />
      </Panel>

      <Panel open={editing !== null} onClose={() => setEditing(null)} title={editing?.name ?? ""}>
        {editing && (
          <div className="space-y-5">
            <StaffForm
              member={editing}
              busy={action.busy === "edit"}
              error={action.error}
              onSubmit={async (input) => {
                const next = await action.run("edit", () => updateStaff(editing.id, input));
                if (next) {
                  replace(next);
                  setEditing(null);
                }
              }}
            />
            <Card className="space-y-3 p-5">
              <button
                type="button"
                disabled={action.busy !== null}
                onClick={async () => {
                  const next = await action.run("toggle", () => updateStaff(editing.id, { active: !editing.active }));
                  if (next) {
                    replace(next);
                    setEditing(next);
                  }
                }}
                className={`${btnSecondary} w-full`}
              >
                {action.busy === "toggle" ? <Spinner /> : <Power />} {editing.active ? t("garage.staff.switchOff") : t("garage.staff.switchOn")}
              </button>
              <p className="text-xs text-muted-foreground">{t("garage.staff.switchHint")}</p>
              <button
                type="button"
                disabled={action.busy !== null}
                onClick={async () => {
                  if (editing.joined && !window.confirm(t("garage.staff.newCodeConfirm"))) return;
                  const next = await action.run("invite", () => resetStaffInvite(editing.id));
                  if (next) {
                    replace(next);
                    setEditing(next);
                  }
                }}
                className={`${btnSecondary} w-full`}
              >
                {action.busy === "invite" ? <Spinner /> : <KeyRound />} {t("garage.staff.newCode")}
              </button>
              {editing.inviteCode && <Invite member={editing} garage={garage} />}
            </Card>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Invite({ member, garage }: { member: StaffMember; garage: Garage }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "/workshop" : `${window.location.origin}/workshop`;
  const message = t("garage.staff.inviteMessage", { name: member.name.split(" ")[0] ?? member.name, garage: garage.name, url, code: member.inviteCode ?? "" });
  const phone = (member.phone ?? "").replace(/[^\d+]/g, "");
  const waPhone = phone.startsWith("+") ? phone.slice(1) : phone.startsWith("0") ? `94${phone.slice(1)}` : phone;
  return (
    <div className="mt-4 rounded-xl bg-warn-soft p-3">
      <p className="text-xs text-warn">{t("garage.staff.inviteCode")}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 font-mono text-lg font-bold tracking-[0.2em]">{member.inviteCode}</code>
        <button
          type="button"
          aria-label={t("garage.share.copy")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(member.inviteCode ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* the code is on screen to read out */
            }
          }}
          className={`${btnSecondary} ${btnSm}`}
        >
          <Copy /> {copied ? t("garage.share.copied") : ""}
        </button>
        <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" className={`${btnSecondary} ${btnSm}`}>
          <MessageCircle />
        </a>
      </div>
    </div>
  );
}

function StaffForm({
  member,
  busy,
  error,
  onSubmit,
}: {
  member?: StaffMember;
  busy: boolean;
  error: string | null;
  onSubmit: (input: { name?: string; phone: string | null }) => void;
}) {
  const t = useT();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        onSubmit({ name: text(form.get("name")) ?? undefined, phone: text(form.get("phone")) });
      }}
    >
      <Card className="space-y-3 p-5">
        <Field label={t("garage.field.name")}>
          <input name="name" required maxLength={120} defaultValue={member?.name} className={inputCls} />
        </Field>
        <Field label={t("garage.field.phone")} hint={t("garage.staff.phoneHint")}>
          <input name="phone" type="tel" maxLength={40} defaultValue={member?.phone ?? ""} className={inputCls} />
        </Field>
      </Card>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
        {busy && <Spinner />} {member ? t("garage.action.save") : t("garage.staff.addSubmit")}
      </button>
    </form>
  );
}
