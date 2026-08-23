import type { Metadata } from "next";
import RequireAuth from "@/lib/auth";

export const metadata: Metadata = {
  title: "Kaduna.lk — Operations",
  description: "Traffic impact analysis and hotspot intelligence for Colombo District.",
};

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth role="ops">{children}</RequireAuth>;
}
