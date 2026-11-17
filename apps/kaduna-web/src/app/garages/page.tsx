import type { Metadata } from "next";

import GaragesPage from "@/components/landing/GaragesPage";
import LandingShell from "@/components/landing/LandingShell";

export const metadata: Metadata = {
  title: "Garages on Kaduna.lk",
  description: "Garages across Sri Lanka that take online bookings: book a slot, follow the repair and approve the work on your phone.",
};

export default function Page() {
  return (
    <LandingShell page="garages">
      <GaragesPage />
    </LandingShell>
  );
}
