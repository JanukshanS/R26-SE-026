"use client";

/** /garages: every garage on Kaduna that takes online bookings and chose to be listed. */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { colorFor, initials, listPublicGarages, type PublicGarage } from "@/lib/publicApi";

import { I } from "./icons";

export default function GaragesPage() {
  const t = useT();
  const [garages, setGarages] = useState<PublicGarage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [service, setService] = useState("");

  useEffect(() => {
    listPublicGarages().then(setGarages, () => { setGarages([]); setFailed(true); });
  }, []);

  // Filter chips from what garages actually offer, most common first.
  const services = useMemo(() => {
    const count = new Map<string, number>();
    for (const g of garages ?? []) for (const s of g.services) count.set(s, (count.get(s) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([s]) => s);
  }, [garages]);

  const shown = (garages ?? []).filter(
    (g) => (!service || g.services.includes(service)) && [g.name, g.address, ...g.services].join(" ").toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <>
      <section className="phero" aria-labelledby="g-title">
        <span className="dots" aria-hidden="true" />
        <div className="wrap phero-row">
          <div>
            <div className="crumb"><Link href="/">{t("home.crumb.home")}</Link><I n="arrow" /><span>{t("home.nav.garages")}</span></div>
            <h1 id="g-title">{t("home.garages.title1")} <em>{t("home.garages.title2")}</em></h1>
            <p className="lead">{t("home.garages.lead")}</p>
            <label className="bigsearch"><I n="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("home.garages.search")} aria-label={t("home.garages.search")} /></label>
            {services.length > 0 && (
              <div className="fchips" role="group" aria-label={t("home.garages.filter")}>
                <button className="fchip" type="button" aria-pressed={service === ""} onClick={() => setService("")}>{t("home.garages.all")}</button>
                {services.map((s) => (
                  <button key={s} className="fchip" type="button" aria-pressed={service === s} onClick={() => setService(service === s ? "" : s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
          <div className="pstat">
            <div><span className="si t-orange"><I n="clock" /></span><span><b>{t("home.garages.p1")}</b><span>{t("home.garages.p1Sub")}</span></span></div>
            <div><span className="si t-blue"><I n="pulse" /></span><span><b>{t("home.garages.p2")}</b><span>{t("home.garages.p2Sub")}</span></span></div>
            <div><span className="si t-green"><I n="file" /></span><span><b>{t("home.garages.p3")}</b><span>{t("home.garages.p3Sub")}</span></span></div>
          </div>
        </div>
      </section>

      <section className="psec tight" aria-label={t("home.garages.list")}>
        <div className="wrap">
          <div className="count-row">
            <h2>{garages === null ? t("home.dir.loading") : t("home.garages.count", { count: shown.length })}</h2>
            <span>{t("home.garages.countNote")}</span>
          </div>
          <div className="ggrid">
            {garages !== null && shown.length === 0 && <p className="empty2">{failed ? t("home.dir.offline") : garages.length ? t("home.dir.noMatch") : t("home.dir.noGarages")}</p>}
            {shown.map((g) => {
              const c = g.brandColor ?? colorFor(g.name);
              return (
                <article key={g.id} className="gc" style={{ "--c": c } as React.CSSProperties}>
                  <div className="cover">
                    <span className="stt">{t("home.dir.booking")}</span>
                    {g.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="lg2" src={g.logoUrl} alt="" />
                    ) : (
                      <span className="lg2">{initials(g.name)}</span>
                    )}
                  </div>
                  <div className="gb">
                    <h3>{g.name}</h3>
                    {g.address && <div className="meta"><span>{g.address}</span></div>}
                    {g.services.length > 0 && <div className="tg">{g.services.slice(0, 5).map((s) => <span key={s}>{s}</span>)}</div>}
                    {g.note && <p className="gnote">{g.note}</p>}
                    <div className="perks">
                      <span><I n="clock" />{t("home.garages.perkBook")}</span>
                      <span><I n="pulse" />{t("home.garages.perkFollow")}</span>
                    </div>
                  </div>
                  <div className="gact">
                    {g.phone ? <a className="btn btn-ghost" href={`tel:${g.phone}`}><I n="phone" />{t("home.dir.call")}</a> : <span />}
                    <Link className="btn btn-primary" href={`/book?g=${encodeURIComponent(g.bookingToken)}`}>{t("home.dir.book")}</Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="psec alt" aria-labelledby="gw-title">
        <div className="wrap">
          <div className="section-head center"><span className="eyebrow">{t("home.garages.whyEyebrow")}</span><h2 id="gw-title">{t("home.garages.whyTitle")}</h2></div>
          <div className="why">
            <div className="wy"><span className="wi t-orange"><I n="file" /></span><h3>{t("home.garages.w1")}</h3><p>{t("home.garages.w1Body")}</p></div>
            <div className="wy"><span className="wi t-blue"><I n="pulse" /></span><h3>{t("home.garages.w2")}</h3><p>{t("home.garages.w2Body")}</p></div>
            <div className="wy"><span className="wi t-green"><I n="car" /></span><h3>{t("home.garages.w3")}</h3><p>{t("home.garages.w3Body")}</p></div>
          </div>
        </div>
      </section>

      <section className="psec" aria-label={t("home.garages.ownersLabel")}>
        <div className="wrap">
          <div className="band">
            <div><h2>{t("home.garages.ownTitle")}</h2><p>{t("home.garages.ownBody")}</p></div>
            <div className="acts2"><Link className="btn btn-ghost" href="/#garage-os">{t("home.garages.seeSystem")}</Link><Link className="btn btn-primary" href="/join#garages">{t("home.garages.joinCta")} <I n="arrow" /></Link></div>
          </div>
        </div>
      </section>
    </>
  );
}
