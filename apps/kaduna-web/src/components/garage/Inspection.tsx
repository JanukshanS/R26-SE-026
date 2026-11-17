"use client";

/**
 * The digital inspection on a job card. The mechanic marks each point OK /
 * needs attention / urgent, adds a note and a price for recommended work, and
 * sends the report; the customer approves or declines each priced item on
 * their tracking link. Approved work goes onto the job with one tap.
 */
import { useState } from "react";
import { CheckCheck, CheckCircle2, ClipboardCheck, Plus, Send, ThumbsDown, ThumbsUp, X } from "lucide-react";

import {
  addInspectionItem,
  addInspectionItemToJob,
  getInspection,
  markInspectionRestOk,
  removeInspectionItem,
  sendInspection,
  startInspection,
  updateInspection,
  updateInspectionItem,
  type Approval,
  type CheckResult,
  type Garage,
  type Inspection,
  type InspectionItem,
  type InspectionItemPatch,
  type JobCard,
} from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import { Badge, Card, Empty, ErrorNote, Field, Loading, Progress, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, num, useAction, useLoad, useMoney, type Tone } from "./ui";

const RESULT_TONE: Record<CheckResult, Tone> = { OK: "ok", ATTENTION: "warn", URGENT: "bad", NOT_CHECKED: "gray" };
const APPROVAL_TONE: Record<Approval, Tone> = { PENDING: "warn", APPROVED: "ok", DECLINED: "gray" };
const MARKS: CheckResult[] = ["OK", "ATTENTION", "URGENT"];

export default function InspectionTab({
  garage,
  job,
  locked,
  onJobChanged,
}: {
  garage: Garage;
  job: JobCard;
  /** The job is closed or cancelled: show the report, change nothing. */
  locked: boolean;
  onJobChanged: (job: JobCard) => void;
}) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const inspection = useLoad(() => getInspection(job.id), [job.id]);
  const action = useAction();
  const ins = inspection.data;

  async function apply(key: string, fn: () => Promise<Inspection>) {
    const next = await action.run(key, fn);
    if (next) inspection.setData(next);
    return Boolean(next);
  }
  const patch = (item: InspectionItem, input: InspectionItemPatch) => apply(item.id, () => updateInspectionItem(job.id, item.id, input));

  if (inspection.error) return <ErrorNote message={inspection.error} onRetry={inspection.reload} />;
  if (inspection.loading && !ins) return <Loading />;

  if (!ins) {
    return locked ? (
      <Empty title={t("garage.insp.noneTitle")} />
    ) : (
      <Empty
        title={t("garage.insp.startTitle")}
        body={t("garage.insp.startBody")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" disabled={action.busy !== null} onClick={() => apply("start", () => startInspection(job.id, "STANDARD"))} className={btnPrimary}>
              {action.busy === "start" ? <Spinner /> : <ClipboardCheck />} {t("garage.insp.startStandard")}
            </button>
            <button type="button" disabled={action.busy !== null} onClick={() => apply("blank", () => startInspection(job.id, "BLANK"))} className={btnSecondary}>
              {t("garage.insp.startBlank")}
            </button>
            {action.error && <div className="w-full"><ErrorNote message={action.error} /></div>}
          </div>
        }
      />
    );
  }

  const checked = ins.items.filter((i) => i.result !== "NOT_CHECKED").length;
  const pending = ins.items.filter((i) => i.approval === "PENDING");
  const approved = ins.items.filter((i) => i.approval === "APPROVED");
  const declined = ins.items.filter((i) => i.approval === "DECLINED");
  const toAsk = ins.items.filter((i) => i.approval == null && (i.estimate ?? 0) > 0 && (i.result === "ATTENTION" || i.result === "URGENT"));
  const categories = [...new Set(ins.items.map((i) => i.category))];
  const sum = (items: InspectionItem[]) => items.reduce((s, i) => s + (i.estimate ?? 0), 0);

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-[min(100%,16rem)] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg font-semibold">{t("garage.insp.title")}</h3>
              {ins.status === "SENT" ? (
                <Badge tone="info">{t("garage.insp.sentOn", { date: formatDate(ins.sentAt!, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}</Badge>
              ) : (
                <Badge tone="gray">{t("garage.insp.draft")}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("garage.insp.progress", { checked, total: ins.items.length })}</p>
            <Progress value={ins.items.length ? (checked / ins.items.length) * 100 : 0} tone="ok" className="mt-2 max-w-sm" />
          </div>
          {!locked && checked > 0 && checked < ins.items.length && (
            <button
              type="button"
              disabled={action.busy !== null}
              onClick={() => apply("restOk", () => markInspectionRestOk(job.id))}
              className={btnSecondary}
              title={t("garage.insp.restOkHint")}
            >
              {action.busy === "restOk" ? <Spinner /> : <CheckCheck />} {t("garage.insp.restOk", { n: ins.items.length - checked })}
            </button>
          )}
          {!locked && (
            <button
              type="button"
              disabled={action.busy !== null || checked === 0}
              onClick={() => apply("send", () => sendInspection(job.id))}
              className={ins.status === "SENT" && toAsk.length === 0 ? btnSecondary : btnPrimary}
              title={checked === 0 ? t("garage.insp.checkFirst") : undefined}
            >
              {action.busy === "send" ? <Spinner /> : <Send />} {ins.status === "SENT" ? t("garage.insp.resend") : t("garage.insp.send")}
            </button>
          )}
        </div>

        {(pending.length > 0 || approved.length > 0 || declined.length > 0 || toAsk.length > 0) && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Tally tone="warn" label={ins.status === "SENT" ? t("garage.insp.waiting") : t("garage.insp.toSend")} n={ins.status === "SENT" ? pending.length + toAsk.length : toAsk.length} value={money(sum(ins.status === "SENT" ? [...pending, ...toAsk] : toAsk), garage.currency)} />
            <Tally tone="ok" label={t("garage.insp.approved")} n={approved.length} value={money(sum(approved), garage.currency)} />
            <Tally tone="gray" label={t("garage.insp.declined")} n={declined.length} value={money(sum(declined), garage.currency)} />
          </div>
        )}
        {ins.status === "SENT" && toAsk.length > 0 && !locked && <p className="mt-3 text-xs text-warn">{t("garage.insp.unsentChanges", { n: toAsk.length })}</p>}

        <Summary key={ins.id} value={ins.summary} locked={locked} busy={action.busy === "summary"} onSave={(summary) => apply("summary", () => updateInspection(job.id, { summary }))} />
      </Card>

      {action.error && <ErrorNote message={action.error} />}

      {categories.map((category) => (
        <Card key={category} className="p-0 sm:p-0">
          <h4 className="border-b border-border px-5 py-3 text-sm font-semibold">{category}</h4>
          <ul>
            {ins.items
              .filter((i) => i.category === category)
              .map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  garage={garage}
                  locked={locked}
                  busy={action.busy === item.id || action.busy === `job-${item.id}` || action.busy === `rm-${item.id}`}
                  onPatch={(input) => patch(item, input)}
                  onRemove={() => apply(`rm-${item.id}`, () => removeInspectionItem(job.id, item.id))}
                  onAddToJob={async () => {
                    const next = await action.run(`job-${item.id}`, () => addInspectionItemToJob(job.id, item.id));
                    if (next) {
                      onJobChanged(next);
                      inspection.reload();
                    }
                  }}
                />
              ))}
          </ul>
        </Card>
      ))}

      {!locked && <AddItem categories={categories} busy={action.busy === "add"} onAdd={(input) => apply("add", () => addInspectionItem(job.id, input))} />}
    </div>
  );
}

function Tally({ tone, label, n, value }: { tone: Tone; label: string; n: number; value: string }) {
  return (
    <div className="rounded-xl bg-canvas px-3.5 py-2.5">
      <Badge tone={tone}>{label} · {n}</Badge>
      <p className="mt-1.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Summary({ value, locked, busy, onSave }: { value: string | null; locked: boolean; busy: boolean; onSave: (v: string | null) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value ?? "");
  if (locked) return value ? <p className="mt-4 whitespace-pre-line text-sm">{value}</p> : null;
  const dirty = draft.trim() !== (value ?? "");
  return (
    <div className="mt-4 space-y-2">
      <Field label={t("garage.insp.summary")} hint={t("garage.insp.summaryHint")}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={2000} className={inputCls} />
      </Field>
      {dirty && (
        <button type="button" disabled={busy} onClick={() => onSave(draft.trim() || null)} className={`${btnSecondary} ${btnSm}`}>
          {busy && <Spinner />} {t("garage.action.save")}
        </button>
      )}
    </div>
  );
}

function ItemRow({
  item,
  garage,
  locked,
  busy,
  onPatch,
  onRemove,
  onAddToJob,
}: {
  item: InspectionItem;
  garage: Garage;
  locked: boolean;
  busy: boolean;
  onPatch: (input: InspectionItemPatch) => Promise<boolean>;
  onRemove: () => void;
  onAddToJob: () => void;
}) {
  const t = useT();
  const money = useMoney();
  const needsWork = item.result === "ATTENTION" || item.result === "URGENT";
  const [note, setNote] = useState(item.note ?? "");
  const [estimate, setEstimate] = useState(item.estimate != null ? String(item.estimate) : "");

  const saveNote = () => {
    if (note.trim() !== (item.note ?? "")) onPatch({ note: note.trim() || null });
  };
  const saveEstimate = () => {
    const next = num(estimate);
    if (next !== item.estimate) onPatch({ estimate: next });
  };

  return (
    <li className="border-b border-border px-5 py-3.5 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-40 flex-1 text-sm font-medium">{item.name}</span>
        {locked ? (
          <Badge tone={RESULT_TONE[item.result]}>{t(`garage.insp.result.${item.result}`)}</Badge>
        ) : (
          <div role="radiogroup" aria-label={item.name} className="inline-flex gap-1">
            {MARKS.map((r) => {
              const on = item.result === r;
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={busy || Boolean(item.jobItemId)}
                  onClick={() => onPatch({ result: on ? "NOT_CHECKED" : r })}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                    on
                      ? r === "OK"
                        ? "border-ok bg-ok text-white"
                        : r === "ATTENTION"
                          ? "border-warn bg-warn text-white"
                          : "border-bad bg-bad text-white"
                      : "border-border bg-white text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`garage.insp.result.${r}`)}
                </button>
              );
            })}
          </div>
        )}
        {busy && <Spinner />}
        {!locked && !item.jobItemId && item.approval == null && (
          <button type="button" aria-label={t("garage.action.remove")} onClick={onRemove} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-bad-soft hover:text-bad">
            <X className="size-4" />
          </button>
        )}
      </div>

      {(needsWork || item.note) && (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_160px]">
          {locked ? (
            item.note && <p className="text-[13px] text-muted-foreground">{item.note}</p>
          ) : (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              maxLength={1000}
              placeholder={t("garage.insp.notePlaceholder")}
              aria-label={t("garage.insp.note")}
              className={`${inputCls} py-2 text-[13px]`}
            />
          )}
          {needsWork &&
            (locked || item.jobItemId ? (
              <p className="text-right text-sm font-semibold tabular-nums">{item.estimate != null ? money(item.estimate, garage.currency) : "—"}</p>
            ) : (
              <input
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                onBlur={saveEstimate}
                type="number"
                min={0}
                step="0.01"
                placeholder={t("garage.insp.estimate")}
                aria-label={t("garage.insp.estimate")}
                className={`${inputCls} py-2 text-right text-[13px] tabular-nums`}
              />
            ))}
        </div>
      )}

      {item.approval && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Badge tone={APPROVAL_TONE[item.approval]}>{t(`garage.insp.approval.${item.approval}`)}</Badge>
          {item.jobItemId ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
              <CheckCircle2 className="size-3.5" /> {t("garage.insp.onJob")}
            </span>
          ) : (
            !locked && (
              <>
                {item.approval === "APPROVED" && (
                  <button type="button" disabled={busy} onClick={onAddToJob} className={`${btnPrimary} ${btnSm}`}>
                    <Plus /> {t("garage.insp.addToJob")}
                  </button>
                )}
                {item.approval !== "APPROVED" && (
                  <button type="button" disabled={busy} onClick={() => onPatch({ approval: "APPROVED" })} className={`${btnSecondary} ${btnSm}`} title={t("garage.insp.recordHint")}>
                    <ThumbsUp /> {t("garage.insp.markApproved")}
                  </button>
                )}
                {item.approval !== "DECLINED" && (
                  <button type="button" disabled={busy} onClick={() => onPatch({ approval: "DECLINED" })} className={`${btnSecondary} ${btnSm}`} title={t("garage.insp.recordHint")}>
                    <ThumbsDown /> {t("garage.insp.markDeclined")}
                  </button>
                )}
              </>
            )
          )}
        </div>
      )}
    </li>
  );
}

function AddItem({ categories, busy, onAdd }: { categories: string[]; busy: boolean; onAdd: (input: { category: string; name: string }) => Promise<boolean> }) {
  const t = useT();
  const other = t("garage.insp.otherCategory");
  const options = categories.includes(other) ? categories : [...categories, other];
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const el = e.currentTarget;
        const form = new FormData(el);
        const name = String(form.get("name") ?? "").trim();
        if (!name) return;
        if (await onAdd({ category: String(form.get("category") || other), name })) el.reset();
      }}
    >
      <Field label={t("garage.insp.addPoint")} className="min-w-48 flex-1">
        <input name="name" required maxLength={120} placeholder={t("garage.insp.addPlaceholder")} className={inputCls} />
      </Field>
      <Field label={t("garage.insp.category")}>
        <select name="category" defaultValue={options[0]} className={inputCls}>
          {options.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <button type="submit" disabled={busy} className={btnSecondary}>
        {busy ? <Spinner /> : <Plus />} {t("garage.action.add")}
      </button>
    </form>
  );
}
