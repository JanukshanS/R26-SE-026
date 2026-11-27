"use client";

/**
 * The mechanic's workspace. A mechanic signs in with their own Kaduna account;
 * the first time, they enter the invite code the garage owner gave them. After
 * that this is their phone-friendly view of the garage: their jobs (status,
 * lines, inspections, timeline) and the day's bookings. Money, customers'
 * records and settings stay with the owner at /provider/garage.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ClipboardCheck, KeyRound, PackageSearch, Wrench } from "lucide-react";

import Appointments from "@/components/garage/Appointments";
import GarageShell, { type GarageTab } from "@/components/garage/GarageShell";
import Inspections from "@/components/garage/Inspections";
import Jobs from "@/components/garage/Jobs";
import { Card, ErrorNote, Field, Kpi, Loading, Spinner, btnPrimary, inputCls, useAction, useLoad } from "@/components/garage/ui";
import RequireAuth from "@/lib/auth";
import Pickups from "@/components/parts/Pickups";
import { getMe, joinGarage, listAppointments, listJobCards, type Garage } from "@/lib/garageApi";
import { useT } from "@/lib/i18n";

type MechanicTab = Extract<GarageTab, "jobs" | "inspections" | "appointments" | "pickups">;
const NAV = [{ group: "mine", tabs: ["jobs", "inspections", "appointments", "pickups"] as GarageTab[] }];
const MECHANIC_TABS: MechanicTab[] = ["jobs", "inspections", "appointments", "pickups"];

function useHashTab(): [MechanicTab, (t: MechanicTab) => void] {
  const [tab, setTab] = useState<MechanicTab>("jobs");
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1) as MechanicTab;
      setTab(MECHANIC_TABS.includes(h) ? h : "jobs");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = useCallback((next: MechanicTab) => {
    if (window.location.hash === `#${next}`) setTab(next);
    else window.location.hash = next;
  }, []);
  return [tab, go];
}

function Workshop() {
  const t = useT();
  const me = useLoad(getMe, []);

  if (me.error) return <Centered><ErrorNote message={me.error} onRetry={me.reload} /></Centered>;
  if (!me.data) return <Centered><Loading /></Centered>;
  if (me.data.role === "OWNER") {
    return (
      <Centered>
        <Card>
          <h1 className="font-display text-xl font-bold">{t("garage.mech.ownerTitle")}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("garage.mech.ownerBody")}</p>
          <Link href="/provider/garage" className={`${btnPrimary} mt-4`}>
            <Wrench /> {t("garage.mech.openGarage")}
          </Link>
        </Card>
      </Centered>
    );
  }
  if (me.data.role !== "MECHANIC" || !me.data.garage) return <Join onJoined={me.reload} />;
  return <MechanicHome garage={me.data.garage} name={me.data.staff?.name ?? ""} />;
}

function MechanicHome({ garage, name }: { garage: Garage; name: string }) {
  const t = useT();
  const [tab, go] = useHashTab();
  const [jobId, setJobId] = useState<string | null>(null);
  const openJob = useCallback(
    (id: string | null) => {
      setJobId(id);
      if (id) go("jobs");
    },
    [go]
  );

  return (
    <GarageShell
      tab={tab}
      garageName={garage.name}
      showNav
      nav={NAV}
      product={t("garage.mech.product")}
      here="/workshop"
      title={tab === "jobs" ? t("garage.mech.myWork") : tab === "inspections" ? t("garage.tab.inspections") : tab === "pickups" ? t("garage.tab.pickups") : t("garage.mech.schedule")}
      subtitle={t("garage.mech.subtitle", { name: name.split(" ")[0] ?? name, garage: garage.name })}
    >
      {tab === "jobs" ? (
        <div className="space-y-6">
          <Today onOpenJob={openJob} />
          <Jobs garage={garage} role="MECHANIC" openJobId={jobId} onOpenJob={openJob} />
        </div>
      ) : tab === "inspections" ? (
        <Inspections garage={garage} role="MECHANIC" onOpenJob={openJob} />
      ) : tab === "pickups" ? (
        <Pickups as="MECHANIC" emptyBody={t("parts.pickup.emptyBodyMechanic", { garage: garage.name })} />
      ) : (
        <Appointments role="MECHANIC" onOpenJob={openJob} />
      )}
    </GarageShell>
  );
}

/** At a glance: my open work, what's blocked on parts, what's ready, and today's bookings. */
function Today({ onOpenJob }: { onOpenJob: (id: string) => void }) {
  const t = useT();
  const data = useLoad(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    const [jobs, appts] = await Promise.all([
      listJobCards({ mine: true, active: true, limit: 200 }),
      listAppointments({ from: start.toISOString(), to: end.toISOString() }),
    ]);
    return { jobs: jobs.items, appts: appts.filter((a) => a.status === "BOOKED" || a.status === "CONFIRMED") };
  }, []);
  const jobs = data.data?.jobs ?? [];
  const next = jobs.find((j) => j.status === "IN_PROGRESS") ?? jobs.find((j) => j.status === "OPEN");
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Kpi tone="brand" icon={Wrench} value={jobs.filter((j) => j.status === "OPEN" || j.status === "IN_PROGRESS").length} label={t("garage.mech.onMyBench")} delta={next ? <button type="button" className="underline" onClick={() => onOpenJob(next.id)}>{t("garage.mech.continue", { n: next.number })}</button> : undefined} />
      <Kpi tone="warn" icon={PackageSearch} value={jobs.filter((j) => j.status === "WAITING_PARTS").length} label={t("garage.status.WAITING_PARTS")} />
      <Kpi tone="ok" icon={ClipboardCheck} value={jobs.filter((j) => j.status === "READY").length} label={t("garage.status.READY")} />
      <Kpi tone="info" icon={CalendarDays} value={data.data?.appts.length ?? "—"} label={t("garage.mech.bookingsToday")} />
    </div>
  );
}

function Join({ onJoined }: { onJoined: () => void }) {
  const t = useT();
  const action = useAction();
  return (
    <Centered>
      <Card>
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <KeyRound className="size-6" strokeWidth={1.75} />
        </span>
        <h1 className="font-display text-xl font-bold">{t("garage.mech.joinTitle")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("garage.mech.joinBody")}</p>
        <form
          className="mt-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
            if (await action.run("join", () => joinGarage(code))) onJoined();
          }}
        >
          <Field label={t("garage.mech.code")}>
            <input
              name="code"
              required
              minLength={6}
              maxLength={12}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              placeholder="ABCD2345"
              className={`${inputCls} text-center font-mono text-xl uppercase tracking-[0.3em]`}
            />
          </Field>
          {action.error && <ErrorNote message={action.error} />}
          <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} w-full`}>
            {action.busy && <Spinner />} {t("garage.mech.join")}
          </button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">{t("garage.mech.joinHelp")}</p>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-canvas p-4"><div className="w-full max-w-md">{children}</div></main>;
}

export default function WorkshopPage() {
  return (
    <RequireAuth>
      <Workshop />
    </RequireAuth>
  );
}
