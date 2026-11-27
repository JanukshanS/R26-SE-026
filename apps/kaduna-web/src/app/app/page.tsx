"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Plus } from "lucide-react";

import Claims from "@/components/driver/Claims";
import DriverShell, { DRIVER_TABS, type DriverTab } from "@/components/driver/DriverShell";
import GarageVisits from "@/components/driver/GarageVisits";
import Overview from "@/components/driver/Overview";
import Profile from "@/components/driver/Profile";
import Requests from "@/components/driver/Requests";
import Services from "@/components/driver/Services";
import Vehicles, { VehiclePanel } from "@/components/driver/Vehicles";
import { isLive, useDriverData } from "@/components/driver/shared";
import Pickups from "@/components/parts/Pickups";
import { btnPrimary, btnSm } from "@/components/garage/ui";
import RequireAuth from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { vehicleTitle, type Vehicle } from "@/lib/vehicleApi";

/** Old links used #incidents for what is now #requests. */
const ALIASES: Record<string, DriverTab> = { incidents: "requests" };

/** The section lives in the URL hash (static export), so refresh and back land on it. */
function useHashTab(): [DriverTab, (t: DriverTab) => void] {
  const [tab, setTab] = useState<DriverTab>("overview");
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1).toLowerCase();
      setTab((DRIVER_TABS as string[]).includes(h) ? (h as DriverTab) : ALIASES[h] ?? "overview");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = useCallback((next: DriverTab) => {
    if (window.location.hash === `#${next}`) setTab(next);
    else window.location.hash = next;
    window.scrollTo({ top: 0 });
  }, []);
  return [tab, go];
}

function DriverPortal() {
  const t = useT();
  const [tab, go] = useHashTab();
  const data = useDriverData();
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);

  const onGo = useCallback(
    (next: DriverTab, vehicleId?: string) => {
      if (vehicleId) data.select(vehicleId);
      if (next === "vehicles" && vehicleId) {
        const v = data.vehicles.data?.find((x) => x.id === vehicleId);
        if (v) setEditing(v);
      }
      go(next);
    },
    [data, go]
  );

  const live = (data.incidents.data ?? []).filter(isLive).length;
  const v = data.selected;
  const scoped = tab === "services" || tab === "garage";

  const actions =
    tab === "vehicles" ? (
      <button type="button" onClick={() => setEditing("new")} className={`${btnPrimary} ${btnSm}`}>
        <Plus /> {t("me.vehicles.add")}
      </button>
    ) : tab === "garage" && v ? (
      <button type="button" onClick={() => setBookOpen(true)} className={`${btnPrimary} ${btnSm}`}>
        <CalendarPlus /> {t("me.garage.book")}
      </button>
    ) : tab === "services" && v ? (
      <button type="button" onClick={() => setLogOpen(true)} className={`${btnPrimary} ${btnSm}`}>
        <Plus /> {t("me.services.log")}
      </button>
    ) : undefined;

  let body: React.ReactNode;
  switch (tab) {
    case "vehicles":
      body = <Vehicles data={data} onGo={onGo} onEdit={setEditing} />;
      break;
    case "garage":
      body = <GarageVisits data={data} bookOpen={bookOpen} onBookOpen={setBookOpen} />;
      break;
    case "services":
      body = <Services data={data} logOpen={logOpen} onLogOpen={setLogOpen} />;
      break;
    case "pickups":
      body = <Pickups as="VEHICLE_OWNER" />;
      break;
    case "requests":
      body = <Requests data={data} />;
      break;
    case "claims":
      body = <Claims data={data} />;
      break;
    case "profile":
      body = <Profile data={data} />;
      break;
    default:
      body = (
        <Overview
          data={data}
          onGo={onGo}
          onAddVehicle={() => setEditing("new")}
          onBook={() => {
            setBookOpen(true);
            go("garage");
          }}
        />
      );
  }

  return (
    <DriverShell
      tab={tab}
      name={data.profile.data?.name ?? null}
      liveCount={live}
      title={tab === "overview" ? t("me.tab.dashboard") : t(`me.tab.${tab}`)}
      subtitle={scoped && v ? `${vehicleTitle(v)} · ${v.plateNumber}` : t(`me.sub.${tab}`)}
      actions={actions}
      vehicles={data.vehicles.data}
      selected={v}
      onSelect={data.select}
    >
      {body}
      <VehiclePanel data={data} editing={editing} onClose={() => setEditing(null)} />
    </DriverShell>
  );
}

export default function DriverPortalPage() {
  return (
    <RequireAuth>
      <DriverPortal />
    </RequireAuth>
  );
}
