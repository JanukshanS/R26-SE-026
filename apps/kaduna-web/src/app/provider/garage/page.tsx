"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import Appointments from "@/components/garage/Appointments";
import Customers from "@/components/garage/Customers";
import GarageSettings from "@/components/garage/GarageSettings";
import GarageShell, { type GarageTab } from "@/components/garage/GarageShell";
import Inspections from "@/components/garage/Inspections";
import Inventory from "@/components/garage/Inventory";
import Invoices from "@/components/garage/Invoices";
import Jobs from "@/components/garage/Jobs";
import KadunaJobs from "@/components/garage/KadunaJobs";
import Overview from "@/components/garage/Overview";
import GarageParts from "@/components/parts/GarageParts";
import Reports from "@/components/garage/Reports";
import Staff from "@/components/garage/Staff";
import Suppliers from "@/components/garage/Suppliers";
import { Card, ErrorNote, Loading, useLoad } from "@/components/garage/ui";
import RequireAuth, { useAuth } from "@/lib/auth";
import { listAssignedIncidents } from "@/lib/dispatchApi";
import { GarageApiError, getGarage, type Garage } from "@/lib/garageApi";
import { useT } from "@/lib/i18n";

const TABS: GarageTab[] = ["overview", "kaduna", "appointments", "jobs", "inspections", "customers", "inventory", "parts", "suppliers", "invoices", "staff", "reports", "settings"];

/** The section lives in the URL hash (static export: no dynamic routes), so
 *  links, refresh and the back button all land on the same section. */
function useHashTab(): [GarageTab, (t: GarageTab) => void] {
  const [tab, setTab] = useState<GarageTab>("overview");
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1);
      setTab((TABS as string[]).includes(h) ? (h as GarageTab) : "overview");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = useCallback((next: GarageTab) => {
    if (window.location.hash === `#${next}`) setTab(next);
    else window.location.hash = next;
  }, []);
  return [tab, go];
}

/** Open Kaduna offers waiting for this provider, refreshed every 30 s for the sidebar badge. */
function useKadunaOffers(providerId: string | null) {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!providerId) return;
    let live = true;
    listAssignedIncidents(providerId, { status: "PROVIDER_ASSIGNED", limit: 20 }).then(
      (p) => live && setCount(p.incidents.length),
      () => {}
    );
    const id = setTimeout(() => setTick((n) => n + 1), 30_000);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [providerId, tick]);
  return [count, () => setTick((n) => n + 1)] as const;
}

function GaragePortal() {
  const t = useT();
  const providerId = useAuth().profile?.provider_id ?? null;
  const [tab, go] = useHashTab();
  const [jobId, setJobId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [offers, refreshOffers] = useKadunaOffers(providerId);
  // 403 means this account's provider link is missing or stale; that's a
  // state to explain, not an error to retry.
  const garage = useLoad(async () => {
    if (!providerId) return { garage: null, notLinked: false };
    try {
      return { garage: await getGarage(), notLinked: false };
    } catch (err) {
      if (err instanceof GarageApiError && err.status === 403) return { garage: null, notLinked: true };
      throw err;
    }
  }, [providerId]);

  const openJob = useCallback(
    (id: string | null) => {
      // One record panel at a time: a job opened from an invoice (or the
      // other way round) must not leave the first panel to reappear later.
      setJobId(id);
      if (id) {
        setInvoiceId(null);
        go("jobs");
      }
    },
    [go]
  );
  const openInvoice = useCallback(
    (id: string | null) => {
      setInvoiceId(id);
      if (id) {
        setJobId(null);
        go("invoices");
      }
    },
    [go]
  );

  const g = garage.data?.garage ?? null;
  const setGarage = (next: Garage) => garage.setData({ garage: next, notLinked: false });

  let body: React.ReactNode;
  if (!providerId) {
    body = (
      <Notice title={t("provider.notRegistered.title")} body={t("provider.notRegistered.body")}>
        <p className="mt-3 text-sm">
          {t("garage.mech.areYouMechanic")}{" "}
          <Link href="/workshop" className="font-medium text-primary hover:underline">{t("app.workshop.link")}</Link>
        </p>
      </Notice>
    );
  } else if (garage.error) {
    body = <ErrorNote message={garage.error} onRetry={garage.reload} />;
  } else if (!garage.data) {
    body = <Loading />;
  } else if (garage.data.notLinked) {
    body = <Notice title={t("provider.notRegistered.title")} body={t("provider.error.notLinked")} />;
  } else if (!g) {
    body = <GarageSettings garage={null} onSaved={setGarage} />;
  } else if (tab === "kaduna") {
    body = <KadunaJobs garage={g} providerId={providerId} onOpenJob={openJob} onOffersChanged={refreshOffers} />;
  } else if (tab === "appointments") {
    body = <Appointments garage={g} onOpenJob={openJob} />;
  } else if (tab === "inspections") {
    body = <Inspections garage={g} onOpenJob={openJob} />;
  } else if (tab === "parts") {
    body = <GarageParts garage={g} owner onOpenJob={openJob} />;
  } else if (tab === "suppliers") {
    body = <Suppliers garage={g} />;
  } else if (tab === "staff") {
    body = <Staff garage={g} />;
  } else if (tab === "reports") {
    body = <Reports garage={g} />;
  } else if (tab === "jobs") {
    body = <Jobs garage={g} openJobId={jobId} onOpenJob={openJob} onOpenInvoice={openInvoice} />;
  } else if (tab === "customers") {
    body = <Customers onOpenJob={openJob} />;
  } else if (tab === "inventory") {
    body = <Inventory garage={g} />;
  } else if (tab === "invoices") {
    body = <Invoices garage={g} openInvoiceId={invoiceId} onOpenInvoice={openInvoice} onOpenJob={openJob} />;
  } else if (tab === "settings") {
    body = <GarageSettings garage={g} onSaved={setGarage} />;
  } else {
    body = <Overview garage={g} providerId={providerId} kadunaOffers={offers} onOpenJob={openJob} onGo={go} />;
  }

  const shownTab: GarageTab = g ? tab : "settings";
  return (
    <GarageShell
      tab={shownTab}
      garageName={g?.name ?? null}
      showNav={g !== null}
      kadunaCount={offers}
      title={g ? (tab === "overview" ? t("garage.tab.dashboard") : t(`garage.tab.${tab}`)) : t("garage.title")}
      subtitle={g ? t(`garage.sub.${tab}`, { name: g.name }) : undefined}
    >
      {body}
    </GarageShell>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <Card className="max-w-2xl">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {children}
    </Card>
  );
}

export default function GaragePage() {
  return (
    <RequireAuth>
      <GaragePortal />
    </RequireAuth>
  );
}
