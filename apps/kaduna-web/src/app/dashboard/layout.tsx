import type { Metadata } from "next";
import RequireAuth from "@/lib/auth";
import ThemeClass from "./theme-class";

export const metadata: Metadata = {
  title: "Kaduna.lk — Geo-Intelligence Dashboard",
  description: "Traffic Impact Analysis & Hotspot Intelligence for Colombo District",
};

/* The root layout is light for the public landing; the ops dashboard stays on
   the dark theme via this scoped wrapper (tokens in globals.css are defined on
   the .dark selector, so an ancestor div is enough). */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <ThemeClass />
      <RequireAuth role="ops">{children}</RequireAuth>
    </div>
  );
}
