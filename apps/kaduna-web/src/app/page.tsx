import Home from "@/components/landing/Home";
import LandingShell from "@/components/landing/LandingShell";

/** The public home page (design: design/landing/index.html). */
export default function HomePage() {
  return (
    <LandingShell page="home">
      <Home />
    </LandingShell>
  );
}
