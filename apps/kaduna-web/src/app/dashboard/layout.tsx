import type { Metadata } from "next";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "Kaduna.lk — Geo-Intelligence Dashboard",
  description: "Traffic Impact Analysis & Hotspot Intelligence for Colombo District",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
