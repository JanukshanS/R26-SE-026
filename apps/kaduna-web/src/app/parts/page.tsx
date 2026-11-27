import type { Metadata } from "next";

import PartsPage from "@/components/landing/PartsPage";
import LandingShell from "@/components/landing/LandingShell";

export const metadata: Metadata = {
  title: "Car parts on Kaduna.lk",
  description: "Find car parts from shops on Kaduna.lk by name, part number or the car they fit, with the shop's price and whether it's in stock.",
};

export default function Page() {
  return (
    <LandingShell page="parts">
      <PartsPage />
    </LandingShell>
  );
}
