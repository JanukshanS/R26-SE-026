import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">Kaduna.lk</h1>
      <p className="text-muted-foreground">Landing page under construction.</p>
      <Link href="/dashboard" className="underline">
        Open the Geo-Intelligence Dashboard
      </Link>
    </main>
  );
}
