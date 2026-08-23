import type { Metadata } from "next";

import PortalShell, { EmptyCard } from "@/components/portal/PortalShell";
import RequireAuth from "@/lib/auth";

export const metadata: Metadata = {
  title: "Kaduna.lk — Administration",
  description: "User roles and provider verification.",
};

export default function AdminPage() {
  return (
    <RequireAuth role="ops">
      <PortalShell title="Administration">
        <div className="grid gap-4 sm:grid-cols-2">
          <EmptyCard
            title="User roles"
            body="Promote a driver to provider or operator. Role changes go through the admin_set_role RPC — wiring lands in a later phase."
          />
          <EmptyCard
            title="Provider verification"
            body="Review provider registrations and mark them verified. Nothing to review yet."
          />
        </div>
      </PortalShell>
    </RequireAuth>
  );
}
