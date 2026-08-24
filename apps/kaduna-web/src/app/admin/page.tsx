import type { Metadata } from "next";

import RequireAuth from "@/lib/auth";

import AdminConsole from "./admin-console";

export const metadata: Metadata = {
  title: "Kaduna.lk — Administration",
  description: "User roles and provider verification.",
};

export default function AdminPage() {
  return (
    <RequireAuth role="ops">
      <AdminConsole />
    </RequireAuth>
  );
}
