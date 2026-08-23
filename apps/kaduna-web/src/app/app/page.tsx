import type { Metadata } from "next";

import PortalShell, { EmptyCard } from "@/components/portal/PortalShell";
import RequireAuth from "@/lib/auth";

export const metadata: Metadata = {
  title: "Kaduna.lk — My Kaduna",
  description: "Your vehicles, incidents and claims.",
};

const TABS = [
  { label: "Overview", href: "/app" },
  { label: "Vehicles", href: "/app" },
  { label: "Incidents", href: "/app" },
  { label: "Claims", href: "/app" },
];

const STATS = [
  { label: "Vehicles", value: "—" },
  { label: "Open incidents", value: "—" },
  { label: "Claims in progress", value: "—" },
];

export default function DriverPortalPage() {
  return (
    <RequireAuth>
      <PortalShell title="My Kaduna" tabs={TABS} active="Overview">
        <div className="grid gap-4 sm:grid-cols-3">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="font-display mt-2 text-3xl font-bold tracking-tight">
                {s.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <EmptyCard
            title="Nothing here yet"
            body="Your vehicles, incidents and claims will appear here. Add a vehicle or report a breakdown in the mobile app and it will show up on this page."
          />
        </div>
      </PortalShell>
    </RequireAuth>
  );
}
