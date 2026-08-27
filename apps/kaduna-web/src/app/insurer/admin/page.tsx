"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { CompaniesTab } from "@/components/insurer/admin/CompaniesTab";
import { UsersTab } from "@/components/insurer/admin/UsersTab";

const TAB_LABELS = ["Companies", "Users"] as const;
type Tab = (typeof TAB_LABELS)[number];
const TABS = [
  { label: "Dashboard", href: "/insurer" },
  ...TAB_LABELS.map((label) => ({ label, href: `#${label.toLowerCase()}` })),
];

export default function InsurerAdminPage() {
  const [tab, setTab] = useState<Tab>("Companies");

  useEffect(() => {
    const sync = () => {
      const want = window.location.hash.replace("#", "").toLowerCase();
      setTab(TAB_LABELS.find((t) => t.toLowerCase() === want) ?? "Companies");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <PortalShell title="Insurer Admin" tabs={TABS} active={tab} fullWidth>
      {tab === "Companies" ? <CompaniesTab /> : <UsersTab />}
    </PortalShell>
  );
}
