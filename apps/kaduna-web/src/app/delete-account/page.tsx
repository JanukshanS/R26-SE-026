import type { Metadata } from "next";
import Link from "next/link";

/* Public account-deletion page. Google Play asks for a login-free URL where
   users can request deletion of their account and data without the app, so
   like /privacy it is a plain static route with no session or client code,
   kept in English and in step with the retention section of that policy. */

export const metadata: Metadata = {
  title: "Delete your account — Kaduna.lk",
  description:
    "How to delete your Kaduna.lk account and the data linked to it.",
};

const CONTACT = "hello@kaduna.lk";

const deleted = [
  "Your account and sign-in details, including the link to Google sign-in if you used it.",
  "Your profile: name, email address, phone number, NIC number and driving licence number.",
  "Your vehicles, insurance details, service records and odometer readings.",
  "Roadside assistance requests, trip recordings and OBD-II engine data.",
  "Accident photos, videos and documents stored with your claims, except where your insurer must keep them (see below).",
  "For service providers: your provider profile, the services you offer, your service area, location and job history.",
];

const kept = [
  "Claim records your insurer needs to settle a claim and meet its legal record-keeping obligations. These stay with that insurer only for as long as it must keep them.",
  "Data we are legally required to retain, for example for an open fraud investigation, only for as long as the law requires.",
  "Aggregated statistics, such as road-safety hotspot maps, that cannot identify you.",
  "Server logs, which are deleted on their normal schedule, typically within 90 days.",
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 marker:text-primary">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-background text-foreground [--radius:0.9rem]">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-display text-xl font-bold tracking-tight">
            Kaduna<span className="text-primary">.lk</span>
          </Link>
          <Link
            href="/"
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-sm font-medium text-primary">Account</p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Delete your Kaduna.lk account
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          This page explains how to delete your account in the Kaduna.lk app,
          for both drivers and service providers, and what happens to your
          data when you do.
        </p>

        <div className="mt-14 space-y-14">
          <Section title="How to request deletion">
            <ol className="list-decimal space-y-3 pl-5 marker:font-semibold marker:text-primary">
              <li>
                Email{" "}
                <a
                  href={`mailto:${CONTACT}?subject=Delete%20my%20account`}
                  className="text-primary underline"
                >
                  {CONTACT}
                </a>{" "}
                from the email address registered to your Kaduna.lk account.
              </li>
              <li>
                Use the subject <strong>“Delete my account”</strong> and include
                the name on the account. If it is a service provider account,
                please say so.
              </li>
              <li>
                We confirm your request within 7 days, delete your account and
                data within 30 days, and email you when it is done.
              </li>
            </ol>
            <p>
              We only act on requests sent from the account&apos;s own email
              address, so nobody else can delete your account.
            </p>
          </Section>

          <Section title="What we delete">
            <List items={deleted} />
          </Section>

          <Section title="What may be kept">
            <List items={kept} />
          </Section>

          <Section title="Deleting some data without closing your account">
            <p>
              You can remove individual vehicles, and the records attached to
              them, in the app at any time. For anything else, email{" "}
              <a href={`mailto:${CONTACT}`} className="text-primary underline">
                {CONTACT}
              </a>{" "}
              and tell us what you would like deleted. See our{" "}
              <Link href="/privacy" className="text-primary underline">
                Privacy Policy
              </Link>{" "}
              for more on how we handle your data.
            </p>
          </Section>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-muted-foreground">
          <p>© 2026 Kaduna.lk</p>
          <Link href="/" className="hover:text-foreground">
            kaduna.lk
          </Link>
        </div>
      </footer>
    </div>
  );
}
