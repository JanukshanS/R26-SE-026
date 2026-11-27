"use client";

/**
 * /parts: search the parts that shops on Kaduna list, by name, number or by
 * your car, at the shop's retail price, and find the shops. Buying happens
 * at the shop (or through your garage, which orders for the job).
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { useI18n, useT } from "@/lib/i18n";
import { colorFor, initials, listPublicCategories, listPublicShops, searchPublicParts, type PublicPart, type PublicShop } from "@/lib/publicApi";

import { ShopRow } from "./Home";
import { I, type IconName } from "./icons";

/** An icon for a category name, by keyword; parts shops name categories their own way. */
function catIcon(c: string): [IconName, string] {
  const s = c.toLowerCase();
  if (/brake|disc|pad/.test(s)) return ["disc", "t-rose"];
  if (/batter/.test(s)) return ["battery", "t-amber"];
  if (/tyre|tire|wheel/.test(s)) return ["tyre", "t-blue"];
  if (/elect|starter|altern|sensor|fuse/.test(s)) return ["plug", "t-violet"];
  if (/suspen|shock|steer/.test(s)) return ["layers", "t-green"];
  if (/light|lamp|bulb|body|mirror/.test(s)) return ["bulb", "t-amber"];
  if (/oil|filter|fluid|lubric/.test(s)) return ["drop", "t-blue"];
  if (/cool|radiat|engine|belt|pump/.test(s)) return ["thermo", "t-orange"];
  return ["package", "t-green"];
}

const fitText = (p: PublicPart, any: string) =>
  p.universal ? any : p.fitments.map((f) => `${f.make} ${f.model}${f.yearFrom || f.yearTo ? ` ${f.yearFrom ?? "…"}–${f.yearTo ?? "…"}` : ""}`).join(", ");

export default function PartsPage() {
  const t = useT();
  const { formatNumber } = useI18n();
  const [q, setQ] = useState("");
  const [car, setCar] = useState({ make: "", model: "", year: "" });
  const [category, setCategory] = useState("");
  const [shopId, setShopId] = useState("");
  const [parts, setParts] = useState<PublicPart[] | null>(null);
  const [cats, setCats] = useState<{ category: string; parts: number }[]>([]);
  const [shops, setShops] = useState<PublicShop[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setShopId(new URLSearchParams(window.location.search).get("shop") ?? "");
    listPublicCategories().then(setCats, () => {});
    listPublicShops().then(setShops, () => setShops([]));
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      searchPublicParts({ q: q.trim() || undefined, make: car.make.trim() || undefined, model: car.model.trim() || undefined, year: Number(car.year) || undefined, category: category || undefined, shopId: shopId || undefined }).then(
        (r) => { setParts(r); setFailed(false); },
        () => { setParts([]); setFailed(true); }
      );
    }, 300);
    return () => clearTimeout(id);
  }, [q, car, category, shopId]);

  const shop = shops?.find((s) => s.id === shopId);
  const filtered = Boolean(q || car.make || car.model || category || shopId);
  const money = (n: number, cur: string) => `${cur} ${formatNumber(n, { maximumFractionDigits: 0 })}`;

  return (
    <>
      <section className="phero" aria-labelledby="m-title">
        <span className="dots" aria-hidden="true" />
        <div className="wrap phero-row">
          <div>
            <div className="crumb"><Link href="/">{t("home.crumb.home")}</Link><I n="arrow" /><span>{t("home.nav.parts")}</span></div>
            <h1 id="m-title">{t("home.parts.title1")} <em>{t("home.parts.title2")}</em></h1>
            <p className="lead">{t("home.parts.lead")}</p>
            <label className="bigsearch"><I n="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("home.parts.search")} aria-label={t("home.parts.search")} /></label>
            <div className="carbar" role="group" aria-label={t("home.parts.yourCar")}>
              <span><I n="car" />{t("home.parts.yourCar")}</span>
              <input value={car.make} onChange={(e) => setCar({ ...car, make: e.target.value })} placeholder={t("home.parts.make")} aria-label={t("home.parts.make")} />
              <input value={car.model} onChange={(e) => setCar({ ...car, model: e.target.value })} placeholder={t("home.parts.model")} aria-label={t("home.parts.model")} />
              <input value={car.year} onChange={(e) => setCar({ ...car, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder={t("home.parts.year")} inputMode="numeric" aria-label={t("home.parts.year")} />
            </div>
          </div>
          <div className="pstat">
            <div><span className="si t-violet"><I n="car" /></span><span><b>{t("home.parts.p1")}</b><span>{t("home.parts.p1Sub")}</span></span></div>
            <div><span className="si t-green"><I n="store" /></span><span><b>{t("home.parts.p2")}</b><span>{t("home.parts.p2Sub")}</span></span></div>
            <div><span className="si t-orange"><I n="wrench" /></span><span><b>{t("home.parts.p3")}</b><span>{t("home.parts.p3Sub")}</span></span></div>
          </div>
        </div>
      </section>

      {cats.length > 0 && (
        <section className="psec tight" aria-labelledby="mc-title">
          <div className="wrap">
            <div className="count-row"><h2 id="mc-title">{t("home.parts.categories")}</h2></div>
            <div className="cats">
              {cats.slice(0, 8).map((c) => {
                const [icon, tint] = catIcon(c.category);
                return (
                  <button key={c.category} className={`cat ${category === c.category ? "on" : ""}`} type="button" aria-pressed={category === c.category} onClick={() => setCategory(category === c.category ? "" : c.category)}>
                    <span className={`ci2 ${tint}`}><I n={icon} /></span>
                    <span><b>{c.category}</b><small>{t("home.dir.parts", { count: c.parts })}</small></span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="psec alt" aria-labelledby="mp-title">
        <div className="wrap">
          <div className="count-row">
            <h2 id="mp-title">{parts === null ? t("home.dir.loading") : filtered ? t("home.parts.results", { count: parts.length }) : t("home.parts.listed")}</h2>
            <span className="chips-inline">
              {shop && <button type="button" className="fchip" aria-pressed="true" onClick={() => setShopId("")}>{shop.name} ✕</button>}
              {category && <button type="button" className="fchip" aria-pressed="true" onClick={() => setCategory("")}>{category} ✕</button>}
              <span>{t("home.parts.priceNote")}</span>
            </span>
          </div>
          <div className="pgrid">
            {parts !== null && parts.length === 0 && <p className="empty2">{failed ? t("home.dir.offline") : filtered ? t("home.parts.none") : t("home.parts.noneYet")}</p>}
            {(parts ?? []).map((p) => {
              const [icon, tint] = catIcon(p.category ?? p.name);
              const c = colorFor(p.shop.name);
              return (
                <article key={p.id} className="pd">
                  <div className="img">
                    <span className={`cond ${p.inStock ? "g" : "r"}`}>{p.inStock ? t("home.parts.inStock") : t("home.parts.ask")}</span>
                    <span className={`big ${tint}`}><I n={icon} /></span>
                  </div>
                  <div className="pb">
                    <h3>{p.name}</h3>
                    <span className="fits">{[p.brand, p.oemNumber ?? p.partNumber].filter(Boolean).join(" · ")}</span>
                    <span className="fits">{t("home.parts.fits", { cars: fitText(p, t("home.parts.anyCar")) || "—" })}</span>
                    <div className="seller"><i style={{ background: c }}>{initials(p.shop.name)}</i><span><b>{p.shop.name}</b>{p.shop.city && ` · ${p.shop.city}`}</span></div>
                  </div>
                  <div className="pf">
                    <span className="price">{money(p.price, p.shop.currency)}<small>{t("home.parts.perUnit", { unit: p.unit })}</small></span>
                    {p.shop.phone ? <a className="btn btn-primary" href={`tel:${p.shop.phone}`}><I n="phone" />{t("home.dir.call")}</a> : <button type="button" className="btn btn-ghost" onClick={() => setShopId(p.shop.id)}>{t("home.parts.shopParts")}</button>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="psec" aria-labelledby="ms-title">
        <div className="wrap">
          <div className="count-row"><h2 id="ms-title">{t("home.parts.shopsTitle")}</h2><span>{t("home.parts.shopsNote")}</span></div>
          {shops === null ? (
            <p className="empty">{t("home.dir.loading")}</p>
          ) : shops.length === 0 ? (
            <p className="empty">{t("home.dir.noShops")}</p>
          ) : (
            <div className="dlist two">{shops.map((s) => <ShopRow key={s.id} s={s} />)}</div>
          )}
        </div>
      </section>

      <section className="psec" style={{ paddingTop: 0 }} aria-labelledby="mh-title">
        <div className="wrap">
          <div className="section-head center"><span className="eyebrow">{t("home.parts.howEyebrow")}</span><h2 id="mh-title">{t("home.parts.howTitle")}</h2><p>{t("home.parts.howLead")}</p></div>
          <div className="flow3">
            <div className="f3"><h3>{t("home.parts.h1")}</h3><p>{t("home.parts.h1Body")}</p></div>
            <div className="f3"><h3>{t("home.parts.h2")}</h3><p>{t("home.parts.h2Body")}</p></div>
            <div className="f3"><h3>{t("home.parts.h3")}</h3><p>{t("home.parts.h3Body")}</p></div>
          </div>
        </div>
      </section>

      <section className="psec" style={{ paddingTop: 0 }} aria-label={t("home.parts.sellLabel")}>
        <div className="wrap">
          <div className="band">
            <div><h2>{t("home.parts.sellTitle")}</h2><p>{t("home.parts.sellBody")}</p></div>
            <div className="acts2"><Link className="btn btn-primary" href="/seller">{t("home.parts.sellCta")} <I n="arrow" /></Link></div>
          </div>
        </div>
      </section>
    </>
  );
}
