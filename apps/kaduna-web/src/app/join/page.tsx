import type { Metadata } from "next";

import JoinPage from "@/components/landing/JoinPage";
import LandingShell from "@/components/landing/LandingShell";

export const metadata: Metadata = {
  title: "Join Kaduna.lk",
  description: "Roadside providers, garages, mechanics and parts shops: how to get onto Kaduna.lk.",
};

export default function Page() {
  return (
    <LandingShell page="join">
      <JoinPage />
    </LandingShell>
  );
}
