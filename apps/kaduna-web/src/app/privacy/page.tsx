import type { Metadata } from "next";
import Link from "next/link";

/* Public privacy policy. Google Play requires a non-PDF, login-free page that
   applies to this app specifically, so it is a plain static route with no
   session or client code. It stays English-only: a translated legal text is
   a second policy to keep in step, and only one version can be authoritative. */

export const metadata: Metadata = {
  title: "Privacy Policy — Kaduna.lk",
  description:
    "How the Kaduna.lk app and website collect, use, share and protect your data.",
};

const LAST_UPDATED = "23 October 2026";
const CONTACT = "hello@kaduna.lk";

const sections = [
  { id: "who", title: "Who we are" },
  { id: "collect", title: "Data we collect" },
  { id: "permissions", title: "Device permissions" },
  { id: "use", title: "How we use your data" },
  { id: "share", title: "Who we share it with" },
  { id: "storage", title: "Storage and security" },
  { id: "retention", title: "How long we keep it" },
  { id: "rights", title: "Your rights and choices" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact us" },
];

const permissions = [
  {
    name: "Location (while using the app)",
    why: "To send a provider to where you are, to stamp accident photos and the time you called your insurer, and to show you on the map. We never track your location in the background.",
  },
  {
    name: "Camera",
    why: "To photograph accident scenes, your driving licence and the other party's documents, and to record claim videos.",
  },
  {
    name: "Microphone",
    why: "To record sound with scene and sobriety-check videos.",
  },
  {
    name: "Bluetooth",
    why: "Only to connect to an OBD-II adapter plugged into your car. Bluetooth is not used to find your location.",
  },
  {
    name: "Notifications",
    why: "To show the progress of a claim upload and remind you if one has not finished.",
  },
  {
    name: "Foreground service",
    why: "To finish uploading claim photos and videos if you leave the app mid-upload. A notification stays visible while it runs.",
  },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
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

export default function PrivacyPage() {
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
        <p className="text-sm font-medium text-primary">Legal</p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated {LAST_UPDATED}
        </p>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          This policy explains what the Kaduna.lk Android app and the kaduna.lk
          website collect about you, why, who sees it and what you can do about
          it. We do not sell your data and the app shows no advertising.
        </p>

        <nav
          aria-label="On this page"
          className="mt-10 rounded-[var(--radius)] border border-border bg-accent/40 p-5"
        >
          <p className="text-sm font-semibold">On this page</p>
          <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-sm text-muted-foreground sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="hover:text-foreground">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-14 space-y-14">
          <Section id="who" title="1. Who we are">
            <p>
              Kaduna.lk is a roadside-assistance and accident-claim platform
              for drivers in Sri Lanka. It connects drivers with tow trucks,
              mechanics, fuel delivery and locksmiths, predicts when vehicle
              parts need attention, and helps drivers prepare insurance claims.
              Kaduna.lk is currently in beta.
            </p>
            <p>
              This policy covers the Kaduna.lk mobile app (package{" "}
              <code className="font-mono text-sm">com.kaduna.app</code>), the
              kaduna.lk website, and the web portals used by service providers
              and insurers. Kaduna.lk is the controller of the personal data
              described here. You can reach us at{" "}
              <a href={`mailto:${CONTACT}`} className="text-primary underline">
                {CONTACT}
              </a>
              .
            </p>
          </Section>

          <Section id="collect" title="2. Data we collect">
            <p>
              We only collect what a feature needs, and most of it only when
              you use that feature.
            </p>

            <h3 className="pt-2 font-semibold text-foreground">Your account</h3>
            <List
              items={[
                "Name, email address, phone number and whether you are a driver or a service provider.",
                "Your password, which is stored only as a secure hash by our authentication provider. If you sign in with Google, we receive your name, email address and Google account identifier.",
                "Optional profile details such as your NIC number and driving licence number.",
              ]}
            />

            <h3 className="pt-2 font-semibold text-foreground">Your vehicles</h3>
            <List
              items={[
                "Make, model, year, colour, plate number and a nickname for each vehicle you add.",
                "Insurance details you enter: insurer, policy number and policy expiry month.",
                "Service records and odometer readings you add.",
              ]}
            />

            <h3 className="pt-2 font-semibold text-foreground">
              Roadside assistance requests
            </h3>
            <List
              items={[
                "Your precise location when you ask for help.",
                "Your answers about what is wrong with the vehicle (warning lights, sounds, smells, smoke and similar) and the service you need.",
                "The status and history of each request, including which provider handled it.",
              ]}
            />

            <h3 className="pt-2 font-semibold text-foreground">
              Vehicle health and trips
            </h3>
            <p>
              If you connect an OBD-II adapter, or start a trip recording, the
              app collects:
            </p>
            <List
              items={[
                "Engine data such as speed, RPM, coolant temperature, engine load, fuel trims and battery voltage, and any diagnostic trouble codes the car reports.",
                "Motion readings from your phone's accelerometer and gyroscope during a trip, which we use to estimate braking, cornering and other driving patterns that wear vehicle parts.",
                "Trip start and end times. Trip recordings do not include your GPS location.",
              ]}
            />

            <h3 className="pt-2 font-semibold text-foreground">
              Accident and insurance claims
            </h3>
            <p>When you report an accident, the app collects what you capture:</p>
            <List
              items={[
                "Photos and videos of the scene and the vehicles, each with the time and GPS location it was taken.",
                "Photos of your driving licence (front and back) and a selfie to match it.",
                "A short video sobriety check, if your insurer requests one.",
                "Details of the other party, including photos of their driving licence and vehicle revenue licence.",
                "Your name, NIC number, licence number and policy number, and the time and location at which you called your insurer.",
              ]}
            />
            <p>
              The other party&apos;s details are collected by you, on your
              device, so that your insurer can process the claim. Please only
              capture them where you have a lawful reason to do so.
            </p>

            <h3 className="pt-2 font-semibold text-foreground">
              Service providers
            </h3>
            <List
              items={[
                "Business or personal name, phone number, the services you offer and your service area.",
                "Your location while you are available for or working on a job, so drivers can be matched with and see the nearest provider.",
                "Job history and the outcome of each job.",
              ]}
            />

            <h3 className="pt-2 font-semibold text-foreground">
              Technical data
            </h3>
            <List
              items={[
                "A sign-in session token stored on your device so you stay signed in.",
                "Request logs kept by our hosting providers (such as IP address, time and the address requested) for security and troubleshooting.",
              ]}
            />
            <p>
              We do not use advertising identifiers, third-party analytics or
              tracking cookies. The website uses browser storage only to keep
              you signed in, remember your language and save your progress
              through a claim.
            </p>
          </Section>

          <Section id="permissions" title="3. Device permissions">
            <p>
              The app asks for each permission at the moment a feature needs
              it. You can refuse or revoke any of them in your phone&apos;s
              settings; the related feature will stop working but the rest of
              the app will not.
            </p>
            <div className="overflow-hidden rounded-[var(--radius)] border border-border">
              <dl className="divide-y divide-border">
                {permissions.map((p) => (
                  <div key={p.name} className="grid gap-1 p-4 sm:grid-cols-[11rem_1fr] sm:gap-4">
                    <dt className="font-semibold text-foreground">{p.name}</dt>
                    <dd className="text-sm">{p.why}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Section>

          <Section id="use" title="4. How we use your data">
            <List
              items={[
                "To create and secure your account and keep you signed in.",
                "To diagnose a breakdown, choose the right type of help and dispatch the nearest suitable provider.",
                "To predict when vehicle components are likely to need service and to suggest maintenance and parts.",
                "To assemble an accident claim and deliver it to the insurer you choose, including checks that photos were taken at the time and place reported.",
                "To show road-safety hotspots and service demand. These maps are built from aggregated incident data and do not identify individual drivers.",
                "To send you notifications about your claim uploads.",
                "To prevent fraud and abuse, and to meet our legal obligations.",
                "To improve our diagnosis and prediction models, using de-identified or aggregated data wherever possible.",
              ]}
            />
            <p>
              We process your data because it is needed to provide the service
              you asked for, because you have given consent (for example, by
              granting a permission), to meet legal obligations, or for our
              legitimate interests in keeping the service safe and working.
            </p>
          </Section>

          <Section id="share" title="5. Who we share it with">
            <p>
              <strong>We do not sell your personal data</strong>, and we do not
              share it with advertisers or data brokers. We share it only as
              follows:
            </p>
            <List
              items={[
                <>
                  <strong>Service providers you are matched with</strong> —
                  the tow operator, mechanic or other provider who takes your
                  request sees your name, phone number, location, vehicle and
                  the problem you described. Drivers see the assigned
                  provider&apos;s name, phone number and location while the
                  job is active.
                </>,
                <>
                  <strong>Your insurer</strong> — when you submit a claim, the
                  insurer you select receives the claim photos, videos,
                  documents and details you captured. Each insurer sees only
                  the claims sent to it.
                </>,
                <>
                  <strong>Infrastructure providers</strong> who process data
                  on our behalf and only under our instructions: Supabase
                  (accounts, database and server functions), Cloudflare R2
                  (storage of claim photos and videos), and our cloud hosting
                  providers.
                </>,
                <>
                  <strong>Google</strong> — if you choose Google sign-in, and
                  for maps shown in the app and website. Map display may send
                  your approximate map view to Google.
                </>,
                <>
                  <strong>OpenStreetMap routing (OSRM)</strong> — to draw the
                  driving route between you and your provider, the start and
                  end coordinates are sent to the public OSRM routing service.
                </>,
                <>
                  <strong>Authorities</strong> — when required by law, court
                  order, or to protect someone&apos;s life or safety.
                </>,
                <>
                  <strong>A successor</strong> — if Kaduna.lk is merged or
                  transferred, in which case this policy continues to apply.
                </>,
              ]}
            />
          </Section>

          <Section id="storage" title="6. Storage and security">
            <List
              items={[
                "All data is sent over encrypted connections (HTTPS/TLS).",
                "Database access is restricted by row-level security, so each account can only read its own records, and each insurer only its own claims.",
                "Claim media is uploaded directly to private storage through short-lived, single-use links.",
                "Claim photos and videos are kept on your device until they have uploaded, and are removed from the app's storage when you clear a claim.",
              ]}
            />
            <p>
              Our providers may store data on servers outside Sri Lanka. Where
              that happens we rely on providers that apply recognised security
              and data-protection safeguards. No system is perfectly secure,
              but we work to protect your data and will notify you and the
              relevant authority of a breach where the law requires.
            </p>
          </Section>

          <Section id="retention" title="7. How long we keep it">
            <List
              items={[
                "Account, vehicle and service-record data: for as long as your account is open.",
                "Roadside requests and trip data: for as long as your account is open, so your vehicle's health history stays accurate.",
                "Claim records: for as long as your insurer needs them to settle the claim and meet its legal record-keeping obligations.",
                "Server logs: for a limited period, typically no more than 90 days.",
              ]}
            />
            <p>
              When you delete your account we delete or anonymise your personal
              data within 30 days, except claim records your insurer must keep
              and data we are legally required to retain.
            </p>
          </Section>

          <Section id="rights" title="8. Your rights and choices">
            <p>
              Under Sri Lanka&apos;s Personal Data Protection Act, No. 9 of
              2022, and similar laws, you can:
            </p>
            <List
              items={[
                "Ask for a copy of the personal data we hold about you.",
                "Correct inaccurate data. Most of it — your profile, vehicles and service records — you can edit in the app.",
                "Ask us to delete your account and data.",
                "Withdraw consent, for example by revoking a device permission.",
                "Object to or ask us to restrict certain processing.",
                "Complain to the Data Protection Authority of Sri Lanka.",
              ]}
            />
            <p id="delete-account" className="scroll-mt-24">
              <strong>Deleting your account:</strong> email{" "}
              <a
                href={`mailto:${CONTACT}?subject=Delete%20my%20Kaduna.lk%20account`}
                className="text-primary underline"
              >
                {CONTACT}
              </a>{" "}
              from the address registered to your account with the subject
              “Delete my account”. We will confirm the request and complete it
              within 30 days. You can remove individual vehicles in the app at
              any time.
            </p>
          </Section>

          <Section id="children" title="9. Children">
            <p>
              Kaduna.lk is meant for licensed drivers and working service
              providers. It is not directed at children, and we do not
              knowingly collect data from anyone under 18. If you believe a
              child has given us data, contact us and we will delete it.
            </p>
          </Section>

          <Section id="changes" title="10. Changes to this policy">
            <p>
              We will update this page when our practices change and revise the
              date at the top. If a change is significant, we will also tell
              you in the app before it takes effect.
            </p>
          </Section>

          <Section id="contact" title="11. Contact us">
            <p>
              For any question about this policy or your data, email{" "}
              <a href={`mailto:${CONTACT}`} className="text-primary underline">
                {CONTACT}
              </a>
              . We aim to reply within 7 days.
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
