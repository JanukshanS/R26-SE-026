"use client";

/**
 * The inspection work queue. Every vehicle in the workshop with where its
 * inspection stands: not started, in progress, waiting for the customer, or
 * approved work to add to the job. Tapping one opens the checklist itself,
 * so a mechanic can work through inspections without opening job cards.
 */
import { useState } from "react";
import { CheckCheck, ClipboardCheck, ClipboardList, ExternalLink, Hourglass, ListPlus, Wrench } from "lucide-react";

import { getInspectionBoard, getJobCard, isFinished, type Garage, type InspectionBoardRow, type Role } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import InspectionTab from "./Inspection";
import { MechanicChip } from "./JobExtras";
import {
  Badge,
  Chip,
  Empty,
  ErrorNote,
  JobStatusBadge,
  Kpi,
  Loading,
  Panel,
  Progress,
  Segmented,
  btnPrimary,
  btnSecondary,
  btnSm,
  useLoad,
  vehicleName,
  type Tone,
} from "./ui";

type Stage = "todo" | "draft" | "waiting" | "approved" | "done";
type Filter = Stage | "all";

/** Where a job's inspection stands, most actionable first. */
function stageOf(r: InspectionBoardRow): Stage {
  const i = r.inspection;
  if (!i) return "todo";
  if (i.status === "DRAFT") return "draft";
  if (i.approvedToAdd > 0) return "approved";
  if (i.pendingApproval > 0) return "waiting";
  return "done";
}

const STAGE_TONE: Record<Stage, Tone> = { todo: "info", draft: "brand", waiting: "warn", approved: "ok", done: "gray" };
const ORDER: Stage[] = ["approved", "draft", "todo", "waiting", "done"];

export default function Inspections({ garage, role = "OWNER", onOpenJob }: { garage: Garage; role?: Role; onOpenJob: (id: string) => void }) {
  const t = useT();
  const owner = role === "OWNER";
  const [mine, setMine] = useState(!owner);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const board = useLoad(() => getInspectionBoard({ mine: (!owner && mine) || undefined }), [mine, owner]);

  const rows = (board.data ?? []).filter((r) => !isFinished(r.job.status) || r.inspection);
  const count = (s: Stage) => rows.filter((r) => stageOf(r) === s).length;
  const shown = rows
    .filter((r) => filter === "all" || stageOf(r) === filter)
    .sort((a, b) => ORDER.indexOf(stageOf(a)) - ORDER.indexOf(stageOf(b)) || b.job.number - a.job.number);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi tone="info" icon={ClipboardList} value={count("todo")} label={t("garage.inspq.todo")} />
        <Kpi tone="brand" icon={Wrench} value={count("draft")} label={t("garage.inspq.draft")} />
        <Kpi tone="warn" icon={Hourglass} value={count("waiting")} label={t("garage.inspq.waiting")} />
        <Kpi tone="ok" icon={ListPlus} value={count("approved")} label={t("garage.inspq.approved")} delta={count("approved") ? t("garage.inspq.approvedHint") : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto">
          <Segmented
            value={filter}
            onChange={setFilter}
            label={t("garage.inspq.filter")}
            options={(["all", "todo", "draft", "waiting", "approved", "done"] as Filter[]).map((f) => ({
              value: f,
              label: `${t(`garage.inspq.f.${f}`)} · ${f === "all" ? rows.length : count(f)}`,
            }))}
          />
        </div>
        {!owner && (
          <Chip on={mine} onClick={() => setMine((m) => !m)}>
            <Wrench className="size-3.5" />
            {t("garage.mech.mine")}
          </Chip>
        )}
      </div>

      {board.error ? (
        <ErrorNote message={board.error} onRetry={board.reload} />
      ) : !board.data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty title={t("garage.inspq.emptyTitle")} body={filter === "all" ? t("garage.inspq.emptyBody") : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => (
            <InspectionCard key={r.job.id} row={r} onOpen={() => setOpenId(r.job.id)} />
          ))}
        </div>
      )}

      <InspectionPanel
        garage={garage}
        jobId={openId}
        owner={owner}
        onClose={() => {
          setOpenId(null);
          board.reload();
        }}
        onOpenJob={(id) => {
          setOpenId(null);
          onOpenJob(id);
        }}
      />
    </div>
  );
}

function InspectionCard({ row, onOpen }: { row: InspectionBoardRow; onOpen: () => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const { job, inspection: i } = row;
  const stage = stageOf(row);
  const action = stage === "todo" ? t("garage.inspq.start") : stage === "draft" ? t("garage.inspq.continue") : stage === "approved" ? t("garage.inspq.addWork") : t("garage.inspq.view");
  return (
    <article className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_4px_20px_rgba(41,31,24,.05)]">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">#{job.number}</span>
        <JobStatusBadge status={job.status} />
        <span className="ml-auto">
          <Badge tone={STAGE_TONE[stage]}>{t(`garage.inspq.stage.${stage}`)}</Badge>
        </span>
      </div>
      <p className="mt-3 font-display text-base font-semibold">{vehicleName(job.vehicle, t("garage.vehicle.unknown"))}</p>
      <p className="text-xs text-muted-foreground">
        {job.vehicle?.plate && <span className="font-mono">{job.vehicle.plate}</span>}
        {job.customer && ` · ${job.customer.name}`}
      </p>
      {job.complaint && <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{job.complaint}</p>}

      {i && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("garage.insp.progress", { checked: i.checked, total: i.total })}</span>
            {i.sentAt && <span>{formatDate(i.sentAt, { day: "numeric", month: "short" })}</span>}
          </div>
          <Progress value={i.total ? (i.checked / i.total) * 100 : 0} tone="ok" className="mt-1.5" />
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {i.urgent > 0 && <Badge tone="bad">{t("track.urgentCount", { n: i.urgent })}</Badge>}
            {i.attention > 0 && <Badge tone="warn">{t("track.attentionCount", { n: i.attention })}</Badge>}
            {i.pendingApproval > 0 && <Badge tone="warn" dot={false}>{t("garage.inspq.pendingN", { n: i.pendingApproval })}</Badge>}
            {i.approvedToAdd > 0 && <Badge tone="ok" dot={false}>{t("garage.inspq.approvedN", { n: i.approvedToAdd })}</Badge>}
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-4">
        {job.mechanic ? <MechanicChip name={job.mechanic.name} /> : <span className="text-xs text-muted-foreground">{t("garage.staff.unassigned")}</span>}
        <button type="button" onClick={onOpen} className={`${stage === "done" || stage === "waiting" ? btnSecondary : btnPrimary} ${btnSm} ml-auto`}>
          {stage === "todo" ? <ClipboardCheck /> : stage === "approved" ? <CheckCheck /> : null} {action}
        </button>
      </div>
    </article>
  );
}

function InspectionPanel({
  garage,
  jobId,
  owner,
  onClose,
  onOpenJob,
}: {
  garage: Garage;
  jobId: string | null;
  owner: boolean;
  onClose: () => void;
  onOpenJob: (id: string) => void;
}) {
  const t = useT();
  const job = useLoad(() => (jobId ? getJobCard(jobId) : Promise.resolve(null)), [jobId]);
  const j = job.data && job.data.id === jobId ? job.data : null;
  return (
    <Panel
      wide
      open={jobId !== null}
      onClose={onClose}
      title={j ? `${t("garage.insp.title")} · ${vehicleName(j.vehicle, t("garage.vehicle.unknown"))}` : t("garage.loading")}
      description={
        j ? (
          <>
            <span className="font-mono text-xs">#{j.number}</span>
            {j.vehicle?.plate && <span className="font-mono text-xs">{j.vehicle.plate}</span>}
            <JobStatusBadge status={j.status} />
            <button type="button" onClick={() => onOpenJob(j.id)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <ExternalLink className="size-3.5" /> {t("garage.inspq.openJob")}
            </button>
          </>
        ) : undefined
      }
    >
      {job.error ? (
        <ErrorNote message={job.error} onRetry={job.reload} />
      ) : !j ? (
        <Loading />
      ) : (
        <>
          {j.complaint && (
            <div className="rounded-2xl bg-white px-5 py-4 text-sm">
              <p className="text-xs font-medium text-muted-foreground">{t("garage.field.complaint")}</p>
              <p className="mt-1 whitespace-pre-line">{j.complaint}</p>
            </div>
          )}
          <InspectionTab garage={garage} job={j} locked={isFinished(j.status)} onJobChanged={(next) => job.setData(next)} />
          {!owner && <p className="text-center text-xs text-muted-foreground">{t("garage.inspq.mechanicHint")}</p>}
        </>
      )}
    </Panel>
  );
}
