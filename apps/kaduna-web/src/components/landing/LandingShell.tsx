"use client";

/**
 * The frame of the public site: emergency bar, SOS button, navigation and
 * footer, around /, /garages, /parts and /join. Styles: landing.css (.kl).
 */
import Link from "next/link";

import LanguagePicker from "@/components/LanguagePicker";
import SignInLink from "@/components/SignInLink";
import { useT } from "@/lib/i18n";

import { I, IconSprite } from "./icons";
import "./landing.css";
import { BrandLogo } from "@/components/brand/BrandLogo";

export type LandingPage = "home" | "garages" | "parts" | "join";

export const APK = "/downloads/kaduna-beta.apk";
export const EMERGENCY = [
  { n: "1990", key: "ambulance" },
  { n: "119", key: "police" },
  { n: "110", key: "fire" },
] as const;

export default function LandingShell({ page, children }: { page: LandingPage; children: React.ReactNode }) {
  const t = useT();
  const nav: { href: string; key: string; page?: LandingPage }[] = [
    { href: "/garages", key: "garages", page: "garages" },
    { href: "/parts", key: "parts", page: "parts" },
    { href: "/#how", key: "how" },
    { href: "/join", key: "join", page: "join" },
  ];

  return (
    <div className="kl">
      <IconSprite />

      <div className="ebar" role="region" aria-label={t("home.sos.title")}>
        <div className="wrap">
          <strong><I n="alert" />{t("home.sos.callFirst")}</strong>
          <span className="nums">
            {EMERGENCY.map((e) => (
              <a key={e.n} href={`tel:${e.n}`}><b>{e.n}</b>{t(`home.sos.${e.key}`)}</a>
            ))}
          </span>
        </div>
      </div>
      <details className="fab">
        <summary aria-label={t("home.sos.title")}>SOS</summary>
        <div className="fab-panel">
          <h4>{t("home.sos.title")}</h4>
          {EMERGENCY.map((e) => (
            <a key={e.n} className="n" href={`tel:${e.n}`}><b>{e.n}</b><span>{t(`home.sos.${e.key}`)}</span><small>{t(`home.sos.${e.key}Note`)}</small></a>
          ))}
          <Link className="k" href="/#get-help">{t("home.sos.brokenDown")}</Link>
        </div>
      </details>

      <header className="nav">
        <div className="wrap nav-row">
          <Link className="logo" href="/" aria-label="Kaduna.lk"><BrandLogo height={44} /></Link>
          <nav className="nav-links" aria-label={t("home.nav.label")}>
            {nav.map((l) => (
              <Link key={l.key} href={l.href} className={l.page && l.page === page ? "on" : undefined} aria-current={l.page === page ? "page" : undefined}>
                {t(`home.nav.${l.key}`)}
              </Link>
            ))}
          </nav>
          <div className="nav-cta">
            <span className="lang"><LanguagePicker /></span>
            <SignInLink className="login" />
            <Link className="btn btn-primary btn-sm" href="/#get-help">{t("home.nav.getHelp")}</Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer>
        <div className="wrap">
          <div className="foot">
            <div>
              <Link className="logo" href="/" aria-label="Kaduna.lk"><BrandLogo height={56} /></Link>
              <p>{t("home.foot.about")}</p>
              <a className="btn btn-ghost btn-sm foot-app" href={APK} download><I n="phone" />{t("home.foot.getApp")}</a>
            </div>
            <div>
              <h6>{t("home.foot.drivers")}</h6>
              <ul>
                <li><Link href="/#get-help">{t("home.foot.requestHelp")}</Link></li>
                <li><Link href="/garages">{t("home.foot.findGarage")}</Link></li>
                <li><Link href="/parts">{t("home.foot.findParts")}</Link></li>
                <li><Link href="/#how">{t("home.nav.how")}</Link></li>
              </ul>
            </div>
            <div>
              <h6>{t("home.foot.business")}</h6>
              <ul>
                <li><Link href="/join">{t("home.foot.join")}</Link></li>
                <li><Link href="/#garage-os">{t("home.foot.garageSystem")}</Link></li>
                <li><Link href="/join#parts">{t("home.foot.partsSystem")}</Link></li>
                <li><Link href="/signin">{t("home.foot.signIn")}</Link></li>
              </ul>
            </div>
            <div>
              <h6>{t("home.foot.company")}</h6>
              <ul>
                <li><a href="mailto:hello@kaduna.lk">hello@kaduna.lk</a></li>
                <li><Link href="/privacy">{t("home.foot.privacy")}</Link></li>
                <li><Link href="/delete-account">{t("home.foot.deleteAccount")}</Link></li>
              </ul>
            </div>
          </div>
          <div className="foot-b">
            <span>© {new Date().getFullYear()} Kaduna.lk</span>
            <span className="foot-sos">
              {t("home.sos.footer")} {EMERGENCY.map((e, i) => (
                <span key={e.n}>{i > 0 && " · "}<b>{e.n}</b> {t(`home.sos.${e.key}`)}</span>
              ))}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
