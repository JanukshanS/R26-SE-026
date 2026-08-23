"use client";

import PortalShell, { EmptyCard } from "@/components/portal/PortalShell";
import RequireAuth, { useAuth } from "@/lib/auth";

const TABS = [
  { label: "Job queue", href: "/provider" },
  { label: "Availability", href: "/provider" },
  { label: "History", href: "/provider" },
];

/* Client because the body branches on profile.provider_id, which only exists
   once the session's profile has loaded. */
function ProviderBody() {
  const { profile } = useAuth();

  if (!profile?.provider_id) {
    return (
      <EmptyCard
        title="You're not registered as a provider yet"
        body="Registration happens in the mobile app for now — download Kaduna.lk, switch to provider mode and complete your details. This console unlocks once your provider account is linked."
      />
    );
  }

  return (
    <EmptyCard
      title="No jobs waiting"
      body="Dispatch offers will appear here when a nearby driver needs the service you provide."
    />
  );
}

export default function ProviderPortalPage() {
  return (
    <RequireAuth>
      <PortalShell title="Provider Console" tabs={TABS} active="Job queue">
        <ProviderBody />
      </PortalShell>
    </RequireAuth>
  );
}
