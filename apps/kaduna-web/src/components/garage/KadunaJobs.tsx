"use client";

import { useState } from "react";
import { Check, ClipboardList, MapPin, Navigation, Siren, Star, Timer, Wallet, X } from "lucide-react";

import {
  enumLabel,
  getProvider,
  haversineKm,
  listAssignedIncidents,
  respondToJob,
  updateProviderStatus,
  type AssignedIncident,
  type ProviderRecord,
} from "@/lib/dispatchApi";
import { createJobCardFromDispatch, type Garage } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import {
  Badge,
  Card,
  CardHeader,
  Empty,
  ErrorNote,
  Kpi,
  Loading,
  Segmented,
  Spinner,
  btnPrimary,
  btnSecondary,
  btnSm,
  btnSoft,
  useAction,
  useLoad,
} from "./ui";

type View = "new" | "active" | "done";

const STEPS = ["PROVIDER_ASSIGNED", "EN_ROUTE", "ON_SCENE", "RESOLVED"];

export default function KadunaJobs({
  garage,
  providerId,
  onOpenJob,
  onOffersChanged,
}: {
  garage: Garage;
  providerId: string;
  onOpenJob: (id: string) => void;
  onOffersChanged: () => void;
}) {
  const t = useT();
  const [view, setView] = useState<View>("new");
  const action = useAction();
  const provider = useLoad(() => getProvider(providerId), [providerId]);
  const data = useLoad(async () => {
    const [offers, enRoute, onScene, resolved] = await Promise.all(
      ["PROVIDER_ASSIGNED", "EN_ROUTE", "ON_SCENE", "RESOLVED"].map((status) => listAssignedIncidents(providerId, { status, limit: 20 }))
    );
    return {
      offers: offers!.incidents,
      active: [...enRoute!.incidents, ...onScene!.incidents],
      resolved: resolved!.incidents,
    };
  }, [providerId]);

  async function respond(i: AssignedIncident, accepted: boolean) {
    const res = await action.run(`${accepted ? "ok" : "no"}-${i.id}`, () => respondToJob({ incidentId: i.id, providerId, accepted }));
    if (res) {
      data.reload();
      onOffersChanged();
    }
  }

  async function bringIn(i: AssignedIncident) {
    const job = await action.run(`in-${i.id}`, () => createJobCardFromDispatch(i.id));
    if (job) onOpenJob(job.id);
  }

  async function toggleOnline(p: ProviderRecord) {
    const next = p.status === "AVAILABLE" ? "OFFLINE" : "AVAILABLE";
    const updated = await action.run("status", () => updateProviderStatus(p.id, next));
    if (updated) provider.setData(updated);
  }

  const p = provider.data;
  const d = data.data;
  const now = new Date();
  const doneThisMonth = (d?.resolved ?? []).filter((i) => {
    const at = new Date(i.resolvedAt ?? i.updatedAt);
    return at.getMonth() === now.getMonth() && at.getFullYear() === now.getFullYear();
  }).length;
  const list = d ? (view === "new" ? d.offers : view === "active" ? d.active : d.resolved) : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi tone="bad" icon={Siren} value={d?.offers.length ?? "–"} label={t("garage.kj.newRequests")} delta={t("garage.kj.respondFast")} />
        <Kpi tone="brand" icon={Navigation} value={d?.active.length ?? "–"} label={t("garage.kj.active")} delta={t("garage.kj.activeHint")} />
        <Kpi tone="ok" icon={Timer} value={doneThisMonth} label={t("garage.kj.doneMonth")} delta={t("garage.kj.doneHint")} />
        <Kpi
          tone="vio"
          icon={Star}
          value={p?.averageRating != null ? `${p.averageRating.toFixed(1)} ★` : "–"}
          label={t("garage.kj.rating")}
          delta={p ? t("garage.kj.jobsTotal", { n: p.totalJobs }) : undefined}
        />
      </div>

      {action.error && <ErrorNote message={action.error} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={view}
              onChange={setView}
              label={t("garage.kaduna.title")}
              options={[
                { value: "new", label: `${t("garage.kj.tabNew")} · ${d?.offers.length ?? 0}` },
                { value: "active", label: `${t("garage.kj.tabActive")} · ${d?.active.length ?? 0}` },
                { value: "done", label: t("garage.kj.tabDone") },
              ]}
            />
            <button type="button" onClick={data.reload} className={`${btnSecondary} ${btnSm}`}>
              {data.loading && <Spinner />} {t("garage.kj.refresh")}
            </button>
          </div>

          {data.error ? (
            <ErrorNote message={data.error} onRetry={data.reload} />
          ) : !d ? (
            <Loading className="p-4!" />
          ) : list.length === 0 ? (
            <Empty
              title={view === "new" ? t("garage.kj.emptyNew") : view === "active" ? t("garage.kj.emptyActive") : t("garage.kj.emptyDone")}
              body={view === "new" ? (p?.status === "AVAILABLE" ? t("garage.kj.emptyNewOnline") : t("garage.kj.emptyNewOffline")) : undefined}
            />
          ) : (
            <ul className="space-y-4">
              {list.map((i) => (
                <IncidentCard
                  key={i.id}
                  incident={i}
                  provider={p}
                  busy={action.busy}
                  onAccept={() => respond(i, true)}
                  onDecline={() => respond(i, false)}
                  onBringIn={() => bringIn(i)}
                />
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t("garage.kj.availability")} sub={t("garage.kj.availabilitySub")} />
            {provider.error ? (
              <ErrorNote message={provider.error} onRetry={provider.reload} />
            ) : !p ? (
              <Loading className="p-4!" />
            ) : (
              <>
                <div className="flex items-center gap-4 rounded-2xl border border-border p-4">
                  <span className={`grid size-11 place-items-center rounded-xl ${p.status === "AVAILABLE" ? "bg-ok-soft text-ok" : "bg-muted text-muted-foreground"}`}>
                    <Siren className="size-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{p.status === "AVAILABLE" ? t("garage.kj.online") : p.status === "BUSY" ? t("garage.kj.busy") : t("garage.kj.offline")}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.name}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.status === "AVAILABLE"}
                    aria-label={t("garage.kj.toggle")}
                    disabled={action.busy === "status" || p.status === "BUSY"}
                    onClick={() => toggleOnline(p)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-60 ${p.status === "AVAILABLE" ? "bg-ok" : "bg-[#e3dcd1]"}`}
                  >
                    <span className={`absolute top-1 size-5 rounded-full bg-white transition-all ${p.status === "AVAILABLE" ? "left-6" : "left-1"}`} />
                  </button>
                </div>
                {p.capabilities.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {p.capabilities.map((c) => (
                      <Badge key={c} tone="gray" dot={false}>
                        {enumLabel(c)}
                      </Badge>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>

          <Card>
            <CardHeader title={t("garage.kj.howTitle")} />
            <ol className="space-y-4 text-sm">
              {[
                [Siren, "garage.kj.how1"],
                [Check, "garage.kj.how2"],
                [ClipboardList, "garage.kj.how3"],
                [Wallet, "garage.kj.how4"],
              ].map(([Icon, key], n) => {
                const I = Icon as typeof Siren;
                return (
                  <li key={key as string} className="flex gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-primary">
                      <I className="size-4" />
                    </span>
                    <span className="pt-1.5 text-muted-foreground">
                      <b className="font-semibold text-foreground">{n + 1}.</b> {t(key as string, { garage: garage.name })}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function IncidentCard({
  incident: i,
  provider,
  busy,
  onAccept,
  onDecline,
  onBringIn,
}: {
  incident: AssignedIncident;
  provider: ProviderRecord | null;
  busy: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onBringIn: () => void;
}) {
  const t = useT();
  const { formatDate } = useI18n();
  const service = i.triageResponse?.predictedServiceType;
  const vehicle = [i.vehicleMake, i.vehicleModel, i.vehicleYear].filter(Boolean).join(" ");
  const km = provider ? haversineKm(provider, i) : null;
  const offer = i.status === "PROVIDER_ASSIGNED";
  const step = STEPS.indexOf(i.status);

  return (
    <li className={`rounded-2xl p-5 ${offer ? "border-2 border-primary bg-brand-soft/40" : "border border-border"}`}>
      <div className="flex items-start gap-4">
        <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${offer ? "bg-bad text-white" : "bg-brand-soft text-primary"}`}>
          <Siren className="size-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold">{service ? enumLabel(service) : t("garage.kaduna.defaultService")}</h3>
            <Badge tone="vio" dot={false}>Kaduna</Badge>
            {i.triageResponse?.tier && <Badge tone={/HIGH|CRIT/i.test(i.triageResponse.tier) ? "bad" : "gray"}>{enumLabel(i.triageResponse.tier)}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[vehicle, i.registrationNo].filter(Boolean).join(" · ") || t("garage.vehicle.unknown")}
          </p>
          {i.description && <p className="mt-2 line-clamp-2 text-[13px] text-muted-foreground">{i.description}</p>}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
            {km != null && Number.isFinite(km) && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4" /> {t("garage.kj.away", { km: km.toFixed(1) })}
              </span>
            )}
            <span>{formatDate(i.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
        {!offer && <Badge tone={i.status === "RESOLVED" ? "ok" : "brand"}>{enumLabel(i.status)}</Badge>}
      </div>

      {!offer && step >= 0 && i.status !== "RESOLVED" && (
        <div className="mt-4">
          <div className="flex gap-1.5">
            {STEPS.map((s, n) => (
              <span key={s} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            {STEPS.map((s, n) => (
              <span key={s} className={n === step ? "font-medium text-primary" : ""}>
                {t(`garage.kj.step.${s}`)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/70 pt-4">
        {offer ? (
          <>
            <button type="button" disabled={busy !== null} onClick={onDecline} className={`${btnSecondary} ${btnSm}`}>
              {busy === `no-${i.id}` ? <Spinner /> : <X />} {t("garage.kj.decline")}
            </button>
            <button type="button" disabled={busy !== null} onClick={onAccept} className={`${btnPrimary} ${btnSm}`}>
              {busy === `ok-${i.id}` ? <Spinner /> : <Check />} {t("garage.kj.accept")}
            </button>
          </>
        ) : (
          <>
            {(i.status === "ON_SCENE" || i.status === "RESOLVED") && (
              <button type="button" disabled={busy !== null} onClick={onBringIn} className={`${btnSoft} ${btnSm}`}>
                {busy === `in-${i.id}` ? <Spinner /> : <ClipboardList />} {t("garage.kaduna.open")}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
