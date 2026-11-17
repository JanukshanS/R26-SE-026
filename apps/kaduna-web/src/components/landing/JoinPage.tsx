"use client";

/**
 * /join: how each kind of business gets onto Kaduna, with the real steps and
 * links (no application form: each one signs up and sets up itself).
 */
import Link from "next/link";

import { useT } from "@/lib/i18n";

import { I, type IconName } from "./icons";
import { APK } from "./LandingShell";

type Who = { id: string; icon: IconName; tint: string; key: string; steps: number; cta: { href: string; key: string; download?: boolean } };

const WHO: Who[] = [
  { id: "providers", icon: "truck", tint: "t-orange", key: "providers", steps: 3, cta: { href: APK, key: "getApp", download: true } },
  { id: "garages", icon: "wrench", tint: "t-violet", key: "garages", steps: 3, cta: { href: "/provider/garage", key: "openGarage" } },
  { id: "mechanics", icon: "users", tint: "t-blue", key: "mechanics", steps: 3, cta: { href: "/workshop", key: "openWorkshop" } },
  { id: "parts", icon: "store", tint: "t-green", key: "parts", steps: 3, cta: { href: "/seller", key: "openShop" } },
];

export default function JoinPage() {
  const t = useT();
  return (
    <>
      <section className="phero" aria-labelledby="c-title">
        <span className="dots" aria-hidden="true" />
        <div className="wrap phero-row">
          <div>
            <div className="crumb"><Link href="/">{t("home.crumb.home")}</Link><I n="arrow" /><span>{t("home.nav.join")}</span></div>
            <h1 id="c-title">{t("home.join.title1")} <em>{t("home.join.title2")}</em></h1>
            <p className="lead">{t("home.join.lead")}</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 28 }}>
              <a className="btn btn-primary" href="#who">{t("home.join.findYours")} <I n="arrow" /></a>
              <a className="btn btn-ghost" href="mailto:hello@kaduna.lk">{t("home.join.talk")}</a>
            </div>
          </div>
          <div className="pstat">
            <div><span className="si t-orange"><I n="users" /></span><span><b>{t("home.join.p1")}</b><span>{t("home.join.p1Sub")}</span></span></div>
            <div><span className="si t-green"><I n="pin" /></span><span><b>{t("home.join.p2")}</b><span>{t("home.join.p2Sub")}</span></span></div>
            <div><span className="si t-blue"><I n="user" /></span><span><b>{t("home.join.p3")}</b><span>{t("home.join.p3Sub")}</span></span></div>
          </div>
        </div>
      </section>

      <section className="psec tight" id="who" aria-labelledby="cw-title">
        <div className="wrap">
          <div className="section-head"><span className="eyebrow">{t("home.join.whoEyebrow")}</span><h2 id="cw-title">{t("home.join.whoTitle")}</h2></div>
          <div className="who">
            {WHO.map((w) => (
              <div key={w.id} id={w.id} className="wc">
                <span className={`wi ${w.tint}`}><I n={w.icon} /></span>
                <h3>{t(`home.join.${w.key}`)}</h3>
                <p>{t(`home.join.${w.key}Body`)}</p>
                <span className="lbl2">{t("home.join.getStarted")}</span>
                <ol className="wsteps">
                  {Array.from({ length: w.steps }, (_, i) => (
                    <li key={i}><span>{i + 1}</span>{t(`home.join.${w.key}S${i + 1}`)}</li>
                  ))}
                </ol>
                {w.cta.download ? (
                  <a className="btn btn-primary btn-sm" href={w.cta.href} download>{t(`home.join.${w.cta.key}`)} <I n="arrow" /></a>
                ) : (
                  <Link className="btn btn-primary btn-sm" href={w.cta.href}>{t(`home.join.${w.cta.key}`)} <I n="arrow" /></Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="gos" aria-labelledby="cp-title" style={{ paddingBlock: 96 }}>
        <div className="wrap">
          <div className="section-head center">
            <span className="ai-badge"><I n="users" />{t("home.join.howEyebrow")}</span>
            <h2 id="cp-title" style={{ color: "var(--panel-ink)" }}>{t("home.join.howTitle")}</h2>
          </div>
          <div className="prom">
            {(["pin", "file", "key", "board"] as IconName[]).map((n, i) => (
              <div key={n} className="pr"><I n={n} /><h3>{t(`home.join.h${i + 1}`)}</h3><p>{t(`home.join.h${i + 1}Body`)}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="psec" aria-labelledby="ca-title">
        <div className="wrap">
          <div className="band">
            <div><h2 id="ca-title">{t("home.join.driverTitle")}</h2><p>{t("home.join.driverBody")}</p></div>
            <div className="acts2"><Link className="btn btn-ghost" href="/signin">{t("home.join.signIn")}</Link><a className="btn btn-primary" href={APK} download>{t("home.join.getApp")} <I n="arrow" /></a></div>
          </div>
        </div>
      </section>
    </>
  );
}
