"use client";

/**
 * The home page (design/landing/index.html, home view). Requesting help
 * happens right here (HelpFlow), the directory shows real garages and shops,
 * and the app previews are labelled examples. No invented figures.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n";
import { colorFor, initials, listPublicGarages, listPublicShops, type PublicGarage, type PublicShop } from "@/lib/publicApi";

import HelpFlow from "./HelpFlow";
import { I, type IconName } from "./icons";

export default function Home() {
  return (
    <>
      <Hero />
      <HelpFlow />
      <Stats />
      <Services />
      <HowItWorks />
      <Network />
      <Directory />
      <GarageSystem />
      <AlsoOnKaduna />
      <JoinBand />
    </>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────

function Hero() {
  const t = useT();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <span className="dots" aria-hidden="true" />
      <span className="spark" style={{ width: 10, height: 10, background: "var(--brand)", left: "47%", top: "12%" }} aria-hidden="true" />
      <span className="spark" style={{ width: 8, height: 8, background: "var(--live)", left: "50%", bottom: "16%" }} aria-hidden="true" />
      <span className="spark" style={{ width: 8, height: 8, background: "#f43f5e", left: "2%", bottom: "34%" }} aria-hidden="true" />
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <span className="pill"><span className="ld" />{t("home.hero.pill")}</span>
          <h1 id="hero-title">
            {t("home.hero.title1")}{" "}
            <span className="circled">
              {t("home.hero.titleCircled")}
              <svg viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true"><path d="M18 46C14 22 70 6 118 8c48 2 78 16 74 36-4 22-64 32-114 30C34 72 8 60 16 40c6-14 30-24 60-28" /></svg>
            </span>{" "}
            {t("home.hero.title2")}
          </h1>
          <p>{t("home.hero.lead")}</p>
          <div className="hero-ctas">
            <a className="hcta bd" href="#get-help" onClick={() => goHelp("problem")}>
              <span className="hi"><I n="car" /></span>
              <span><b>{t("home.hero.brokeDown")}</b><small>{t("home.hero.brokeDownSub")}</small></span>
            </a>
            <a className="hcta ac" href="#get-help" onClick={() => goHelp("accident")}>
              <span className="hi"><I n="alert" /></span>
              <span><b>{t("home.hero.accident")}</b><small>{t("home.hero.accidentSub")}</small></span>
            </a>
          </div>
          <div className="req-note">
            <span className="avatars" aria-hidden="true">
              <span style={{ background: "#e8601c" }}><I n="truck" /></span>
              <span style={{ background: "#14a37a" }}><I n="wrench" /></span>
              <span style={{ background: "#6d5ae6" }}><I n="store" /></span>
            </span>
            <span>{t("home.hero.note")}</span>
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/** The wizard listens for this, so the hero buttons can open it on a given step. */
function goHelp(step: "problem" | "accident") {
  window.dispatchEvent(new CustomEvent("kl-help", { detail: step }));
}

function HeroVisual() {
  const t = useT();
  return (
    <div className="hero-visual" aria-label={t("home.hero.preview")}>
      <div className="halo" aria-hidden="true" />
      <div className="phone phone-back" aria-hidden="true">
        <div className="screen">
          <div className="notch" />
          <div className="status"><span>9:41</span><span>5G</span></div>
          <div className="rq">
            <div><span className="sub">{t("home.phone.hi")}</span><h4>{t("home.help.what")}</h4></div>
            <div className="tiles">
              {(["truck", "wrench", "battery", "fuel", "tyre", "key"] as IconName[]).map((n, i) => (
                <div key={n} className={`tile ${i === 0 ? "on" : ""}`}><span className="ic"><I n={n} /></span>{t(`home.phone.tile.${n}`)}</div>
              ))}
            </div>
            <div className="describe">
              <span className="q">{t("home.phone.quote")}</span>
              <div className="ai-chip"><I n="spark" /><span><b>{t("home.phone.aiTitle")}</b> {t("home.phone.aiBody")}</span></div>
            </div>
            <div className="go">{t("home.phone.send")}</div>
          </div>
        </div>
      </div>
      <div className="phone phone-front" aria-hidden="true">
        <div className="screen">
          <div className="notch" />
          <div className="status"><span>9:47</span><span>5G</span></div>
          <div className="th"><h4>{t("home.phone.onTheWay")}</h4><span className="tag">{t("home.phone.live")}</span></div>
          <div className="pmap">
            <TrackingMap />
            <div className="eta">{t("home.phone.status")}<b>{t("home.phone.enRoute")}</b>{t("home.phone.nearby")}</div>
          </div>
          <div className="sheet">
            <div className="drv">
              <span className="av">NP</span>
              <span className="meta"><b>{t("home.phone.provider")}</b>{t("home.phone.providerType")}</span>
              <span className="plate"><i>WP</i><span>LK-3390</span></span>
            </div>
            <div className="steps"><i className="done" /><i className="now" /><i /><i /></div>
            <div className="steps-l"><span>{t("home.phone.s1")}</span><span>{t("home.phone.s2")}</span><span>{t("home.phone.s3")}</span><span>{t("home.phone.s4")}</span></div>
            <div className="acts"><span><I n="chat" />{t("home.phone.message")}</span><span className="p"><I n="phone" />{t("home.phone.call")}</span></div>
          </div>
          <div className="tabbar"><I n="home" className="on" /><I n="clock" /><I n="car" /><I n="user" /></div>
        </div>
      </div>
      <div className="float f-ok" aria-hidden="true">
        <span className="ck"><I n="check" /></span>
        <span>{t("home.float.accepted")}<small>{t("home.float.acceptedSub")}</small></span>
      </div>
      <div className="float f-ai" aria-hidden="true">
        <div className="t"><span className="bd"><I n="spark" /></span>{t("home.float.triage")}</div>
        <div className="big">{t("home.float.fault")}</div>
        <div className="row"><span>{t("home.float.send")}</span><b>{t("home.float.flatbed")}</b></div>
      </div>
      <div className="float f-log" aria-hidden="true">
        <h5>{t("home.float.log")} <span>{t("home.float.example")}</span></h5>
        <div className="lg done"><time>09:41</time><span>{t("home.float.l1")}</span></div>
        <div className="lg ai"><time>09:41</time><span>{t("home.float.l2")}</span></div>
        <div className="lg done"><time>09:42</time><span>{t("home.float.l3")}</span></div>
        <div className="lg now"><time>09:47</time><span>{t("home.float.l4")}</span></div>
      </div>
    </div>
  );
}

function TrackingMap() {
  return (
    <svg viewBox="0 0 276 262" preserveAspectRatio="xMidYMid slice">
      <rect width="276" height="262" fill="var(--map)" />
      <path d="M0 0 H34 C 40 60, 28 120, 38 180 S 30 240, 36 262 H0Z" fill="var(--map-water)" />
      <g fill="var(--map-block)">
        <rect x="66" y="10" width="36" height="34" rx="5" /><rect x="66" y="60" width="36" height="46" rx="5" /><rect x="66" y="124" width="36" height="52" rx="5" /><rect x="66" y="192" width="36" height="60" rx="5" />
        <rect x="124" y="10" width="40" height="34" rx="5" /><rect x="124" y="124" width="40" height="52" rx="5" /><rect x="124" y="192" width="40" height="60" rx="5" />
        <rect x="184" y="124" width="80" height="52" rx="5" /><rect x="184" y="192" width="80" height="60" rx="5" /><rect x="184" y="10" width="80" height="26" rx="5" />
      </g>
      <rect x="124" y="60" width="40" height="46" rx="6" fill="var(--map-park)" />
      <g stroke="var(--map-road)" strokeLinecap="round" fill="none">
        <path d="M52 0 C 56 70, 48 130, 54 262" strokeWidth="5" />
        <path d="M113 0 V262" strokeWidth="10" />
        <path d="M174 0 V262" strokeWidth="8" />
        <path d="M40 52 H276" strokeWidth="7" />
        <path d="M40 115 H276" strokeWidth="7" />
        <path d="M40 184 H276" strokeWidth="6" />
      </g>
      <text x="6" y="150" transform="rotate(-90 16 150)">OCEAN</text>
      <text x="117" y="250" transform="rotate(-90 121 250)">GALLE RD</text>
      <text x="200" y="47">KOLLUPITIYA</text>
      <path id="kl-route" d="M262 52 L174 52 L174 115 L113 115 L113 206" fill="none" stroke="var(--brand)" strokeWidth="9" strokeLinejoin="round" opacity=".18" />
      <path d="M262 52 L174 52 L174 115 L113 115 L113 206" fill="none" stroke="var(--brand)" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
      <g transform="translate(113 206)">
        <circle r="9" fill="var(--ink)" opacity=".12"><animate attributeName="r" values="8;20;8" dur="2.4s" repeatCount="indefinite" /></circle>
        <circle r="8" fill="var(--ink)" /><circle r="3.5" fill="var(--bg)" />
      </g>
      <g>
        <circle r="13" fill="var(--brand)" stroke="var(--bg)" strokeWidth="3" />
        <g transform="translate(-7 -7) scale(.58)" stroke="#fff" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18H9" /><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" />
        </g>
        <animateMotion dur="36s" repeatCount="indefinite" calcMode="linear"><mpath href="#kl-route" /></animateMotion>
      </g>
    </svg>
  );
}

// ─── Facts (no invented numbers) ─────────────────────────────────────────

function Stats() {
  const t = useT();
  return (
    <section className="stats" aria-label={t("home.stats.label")}>
      <div className="wrap">
        <div className="stats-row">
          <div className="stat"><b>29</b><span>{t("home.stats.types")}</span></div>
          <div className="stat"><b>5</b><span>{t("home.stats.providers")}</span></div>
          <div className="stat"><b>1</b><span>{t("home.stats.oneJob")}</span></div>
          <div className="stat"><b>3</b><span>English, සිංහල, தமிழ்</span></div>
        </div>
      </div>
    </section>
  );
}

// ─── What we send ────────────────────────────────────────────────────────

function Services() {
  const t = useT();
  const small: { icon: IconName; tint: string; key: string }[] = [
    { icon: "wrench", tint: "t-blue", key: "mechanic" },
    { icon: "battery", tint: "t-amber", key: "battery" },
    { icon: "fuel", tint: "t-green", key: "fuel" },
    { icon: "key", tint: "t-rose", key: "lock" },
  ];
  return (
    <section className="services" id="services" aria-labelledby="svc-title">
      <div className="wrap">
        <div className="split-head">
          <div className="section-head"><span className="eyebrow">{t("home.svc.eyebrow")}</span><h2 id="svc-title">{t("home.svc.title")}</h2></div>
          <p>{t("home.svc.lead")}</p>
        </div>
        <div className="svc-grid">
          <article className="svc feature">
            <span className="si"><I n="truck" /></span>
            <h3>{t("home.svc.tow")}</h3>
            <p>{t("home.svc.towBody")}</p>
            <ul>
              <li><I n="check" />{t("home.svc.tow1")}</li>
              <li><I n="check" />{t("home.svc.tow2")}</li>
              <li><I n="check" />{t("home.svc.tow3")}</li>
            </ul>
            <div className="fit"><span>{t("home.svc.light")}</span><span>{t("home.svc.heavy")}</span><span>{t("home.svc.flood")}</span></div>
            <div className="truck-art" aria-hidden="true">
              <svg viewBox="0 0 320 112">
                <path d="M0 102h320" stroke="var(--panel-line)" strokeWidth="2" />
                <path d="M0 102h320" stroke="var(--panel-muted)" strokeWidth="2" strokeDasharray="18 14" opacity=".35" transform="translate(0 6)" />
                <rect x="18" y="58" width="196" height="14" rx="4" fill="var(--panel-2)" stroke="var(--panel-line)" />
                <path d="M214 34h48l28 28v22h-76z" fill="var(--brand)" />
                <path d="M226 42h32l17 18h-49z" fill="var(--panel)" opacity=".55" />
                <rect x="58" y="32" width="114" height="26" rx="11" fill="var(--panel-muted)" opacity=".45" />
                <path d="M74 32l14-14h50l16 14z" fill="var(--panel-muted)" opacity=".3" />
                <g fill="var(--panel)" stroke="var(--panel-muted)" strokeWidth="5"><circle cx="62" cy="88" r="12" /><circle cx="170" cy="88" r="12" /><circle cx="256" cy="88" r="12" /></g>
                <rect x="270" y="26" width="18" height="6" rx="3" fill="var(--brand-2)" />
              </svg>
            </div>
          </article>
          {small.map((s) => (
            <article key={s.key} className="svc">
              <span className={`si ${s.tint}`}><I n={s.icon} /></span>
              <h3>{t(`home.svc.${s.key}`)}</h3>
              <p>{t(`home.svc.${s.key}Body`)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How it works ────────────────────────────────────────────────────────

function HowItWorks() {
  const t = useT();
  const steps: IconName[] = ["pin", "spark", "truck", "clock", "wrench"];
  return (
    <section id="how" aria-labelledby="how-title">
      <div className="wrap">
        <div className="section-head center">
          <span className="eyebrow">{t("home.how.eyebrow")}</span>
          <h2 id="how-title">{t("home.how.title")}</h2>
          <p>{t("home.how.lead")}</p>
        </div>
        <div className="flow">
          {steps.map((n, i) => (
            <div key={n} className={`step ${i === 0 ? "hot" : ""}`}>
              <time>{t("home.how.stepN", { n: i + 1 })}</time>
              <span className="n"><I n={n} /></span>
              <h3>{t(`home.how.s${i + 1}`)}</h3>
              <p>{t(`home.how.s${i + 1}Body`)}</p>
              <span className="chip">{t(`home.how.s${i + 1}Chip`)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── One job, four people (an example) ──────────────────────────────────

function Network() {
  const t = useT();
  return (
    <section className="network" id="network" aria-labelledby="net-title">
      <span className="dots" aria-hidden="true" />
      <div className="wrap">
        <div className="section-head center">
          <span className="eyebrow">{t("home.net.eyebrow")}</span>
          <h2 id="net-title">{t("home.net.title")}</h2>
          <p>{t("home.net.lead")}</p>
        </div>
        <div className="thread">
          <div className="thread-bar"><span className="job"><span className="plate"><i>WP</i><span>CAB-4521</span></span>Toyota Axio 2016 <small>· {t("home.float.example")}</small></span></div>
          <div className="views">
            <article className="view">
              <div className="view-h"><span className="vi t-orange"><I n="user" /></span><span><b>{t("home.net.driver")}</b><small>{t("home.net.driverSub")}</small></span></div>
              <div className="view-b">
                <span className="big">{t("home.net.driverBig")}</span>
                <div className="mini-map"><svg viewBox="0 0 240 78" preserveAspectRatio="none"><path d="M0 52 H240 M90 0 V78 M170 0 V78" stroke="var(--map-road)" strokeWidth="8" /><path d="M232 22 H170 V52 H90" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" /><circle cx="170" cy="38" r="7" fill="var(--brand)" stroke="var(--bg)" strokeWidth="2" /><circle cx="90" cy="52" r="6" fill="var(--ink)" /></svg></div>
                <dl className="kv"><dt>{t("home.net.provider")}</dt><dd>Perera Towing</dd><dt>{t("home.net.status")}</dt><dd>{t("home.phone.enRoute")}</dd></dl>
              </div>
              <span className="view-f"><I n="phone" />{t("home.phone.call")}</span>
            </article>
            <article className="view">
              <div className="view-h"><span className="vi t-blue"><I n="truck" /></span><span><b>{t("home.net.tow")}</b><small>Perera Towing</small></span></div>
              <div className="view-b">
                <span className="big">{t("home.net.towBig")}</span>
                <dl className="kv"><dt>{t("home.net.problem")}</dt><dd>{t("home.float.fault")}</dd><dt>{t("home.net.send")}</dt><dd>{t("home.float.flatbed")}</dd><dt>{t("home.net.drop")}</dt><dd>City Auto Garage</dd></dl>
              </div>
              <span className="view-f p">{t("home.net.accept")} <I n="arrow" /></span>
            </article>
            <article className="view">
              <div className="view-h"><span className="vi t-violet"><I n="wrench" /></span><span><b>{t("home.net.garage")}</b><small>City Auto Garage</small></span></div>
              <div className="view-b">
                <span className="big">{t("home.net.garageBig")}</span>
                <div className="note"><b><I n="spark" />{t("home.net.triageNotes")}</b>{t("home.net.triageText")}</div>
                <dl className="kv"><dt>{t("home.net.owner")}</dt><dd>{t("home.net.ownerFollows")}</dd></dl>
              </div>
              <span className="view-f">{t("home.net.openJob")} <I n="arrow" /></span>
            </article>
            <article className="view">
              <div className="view-h"><span className="vi t-green"><I n="store" /></span><span><b>{t("home.net.shop")}</b><small>Lanka Spares</small></span></div>
              <div className="view-b">
                <span className="big">{t("home.net.shopBig")}</span>
                <dl className="kv"><dt>{t("home.net.part")}</dt><dd>{t("home.net.partName")}</dd><dt>{t("home.net.fits")}</dt><dd>Toyota Axio 2016</dd><dt>{t("home.net.collects")}</dt><dd>{t("home.net.collector")}</dd></dl>
              </div>
              <span className="view-f p">{t("home.net.confirm")} <I n="arrow" /></span>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Real garages and shops ──────────────────────────────────────────────

function Directory() {
  const t = useT();
  const [tab, setTab] = useState<"garages" | "parts">("garages");
  const [q, setQ] = useState("");
  const [garages, setGarages] = useState<PublicGarage[] | null>(null);
  const [shops, setShops] = useState<PublicShop[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listPublicGarages().then(setGarages, () => { setGarages([]); setFailed(true); });
    listPublicShops().then(setShops, () => { setShops([]); setFailed(true); });
  }, []);

  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const g = (garages ?? []).filter((x) => match([x.name, x.address, ...x.services].join(" "))).slice(0, 6);
  const s = (shops ?? []).filter((x) => match([x.name, x.city, x.address, ...x.categories].join(" "))).slice(0, 6);
  const list = tab === "garages" ? g : s;
  const loading = (tab === "garages" ? garages : shops) === null;

  return (
    <section id="directory" aria-labelledby="dir-title">
      <div className="wrap">
        <div className="split-head">
          <div className="section-head"><span className="eyebrow">{t("home.dir.eyebrow")}</span><h2 id="dir-title">{t("home.dir.title")}</h2></div>
          <p>{t("home.dir.lead")}</p>
        </div>
        <div className="dir-bar">
          <div className="seg" role="tablist" aria-label={t("home.dir.type")}>
            <button type="button" role="tab" aria-selected={tab === "garages"} onClick={() => setTab("garages")}><I n="wrench" />{t("home.dir.garages")} <span>{garages?.length ?? "…"}</span></button>
            <button type="button" role="tab" aria-selected={tab === "parts"} onClick={() => setTab("parts")}><I n="store" />{t("home.dir.shops")} <span>{shops?.length ?? "…"}</span></button>
          </div>
          <label className="search"><I n="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("home.dir.search")} aria-label={t("home.dir.search")} /></label>
        </div>
        {loading ? (
          <p className="empty">{t("home.dir.loading")}</p>
        ) : list.length === 0 ? (
          <p className="empty">{failed ? t("home.dir.offline") : q ? t("home.dir.noMatch") : tab === "garages" ? t("home.dir.noGarages") : t("home.dir.noShops")}</p>
        ) : (
          <div className="dlist two">
            {tab === "garages"
              ? g.map((x) => <GarageRow key={x.id} g={x} />)
              : s.map((x) => <ShopRow key={x.id} s={x} />)}
          </div>
        )}
        <div className="dir-foot">
          <span>{t("home.dir.foot")}</span>
          <Link className="btn btn-ghost btn-sm" href={tab === "garages" ? "/garages" : "/parts"}>{tab === "garages" ? t("home.dir.allGarages") : t("home.dir.allParts")} <I n="arrow" /></Link>
        </div>
      </div>
    </section>
  );
}

export function GarageRow({ g }: { g: PublicGarage }) {
  const t = useT();
  const c = g.brandColor ?? colorFor(g.name);
  return (
    <article className="pc">
      {g.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="lg img" src={g.logoUrl} alt="" />
      ) : (
        <span className="lg" style={{ background: `linear-gradient(140deg, color-mix(in srgb, ${c} 70%, #fff), ${c})` }}>{initials(g.name)}</span>
      )}
      <div className="bd">
        <h3>{g.name}</h3>
        <div className="meta">{g.address && <span>{g.address}</span>}<span className="st">{t("home.dir.booking")}</span></div>
        {g.services.length > 0 && <div className="tg">{g.services.slice(0, 4).map((x) => <span key={x}>{x}</span>)}</div>}
      </div>
      <div className="act">
        <Link className="btn btn-primary" href={`/book?g=${encodeURIComponent(g.bookingToken)}`}>{t("home.dir.book")}</Link>
        {g.phone && <a className="btn btn-ghost" href={`tel:${g.phone}`}><I n="phone" />{t("home.dir.call")}</a>}
      </div>
    </article>
  );
}

export function ShopRow({ s }: { s: PublicShop }) {
  const t = useT();
  const c = colorFor(s.name);
  return (
    <article className="pc">
      <span className="lg" style={{ background: `linear-gradient(140deg, color-mix(in srgb, ${c} 70%, #fff), ${c})` }}>{initials(s.name)}</span>
      <div className="bd">
        <h3>{s.name}</h3>
        <div className="meta">
          {(s.city || s.address) && <span>{[s.address, s.city].filter(Boolean).join(", ")}</span>}
          <span className="st">{s.delivers ? t("home.dir.delivers") : t("home.dir.pickupOnly")}</span>
          <span>{t("home.dir.parts", { count: s.partCount })}</span>
        </div>
        {s.categories.length > 0 && <div className="tg">{s.categories.map((x) => <span key={x}>{x}</span>)}</div>}
      </div>
      <div className="act">
        <Link className="btn btn-primary" href={`/parts?shop=${encodeURIComponent(s.id)}`}>{t("home.dir.seeParts")}</Link>
        {s.phone && <a className="btn btn-ghost" href={`tel:${s.phone}`}><I n="phone" />{t("home.dir.call")}</a>}
      </div>
    </article>
  );
}

// ─── The garage system ───────────────────────────────────────────────────

function GarageSystem() {
  const t = useT();
  const feats: { icon: IconName; key: string }[] = [
    { icon: "board", key: "jobs" },
    { icon: "file", key: "inspect" },
    { icon: "package", key: "parts" },
    { icon: "clock", key: "booking" },
  ];
  return (
    <section className="gos" id="garage-os" aria-labelledby="gos-title">
      <div className="wrap">
        <div className="split-head">
          <div className="section-head">
            <span className="ai-badge"><I n="wrench" />{t("home.gos.badge")}</span>
            <h2 id="gos-title">{t("home.gos.title1")} <span>{t("home.gos.title2")}</span></h2>
          </div>
          <p>{t("home.gos.lead")}</p>
        </div>

        <div className="app" aria-label={t("home.gos.preview")}>
          <div className="app-top"><i /><i /><i /><span className="url">kaduna.lk/provider/garage</span><span className="who">{t("home.float.example")} · City Auto Garage</span></div>
          <div className="app-body">
            <aside className="a-side" aria-hidden="true">
              <div className="bl"><span className="logo-mark"><I n="wrench" /></span>{t("home.gos.product")}</div>
              <span className="g">{t("home.gos.workshop")}</span>
              <a className="on"><I n="board" />{t("home.gos.navJobs")}<span className="n">12</span></a>
              <a><I n="truck" />{t("home.gos.navKaduna")}<span className="n">2</span></a>
              <a><I n="clock" />{t("home.gos.navBookings")}</a>
              <span className="g">{t("home.gos.stock")}</span>
              <a><I n="package" />{t("home.gos.navParts")}<span className="n">3</span></a>
              <span className="g">{t("home.gos.business")}</span>
              <a><I n="file" />{t("home.gos.navInvoices")}</a>
              <a><I n="users" />{t("home.gos.navMechanics")}</a>
            </aside>
            <div className="a-main">
              <div className="a-top"><div><h4>{t("home.gos.board")}</h4><small>{t("home.gos.boardSub")}</small></div><span className="btn btn-ghost btn-sm" style={{ height: 36, fontSize: 13 }}>+ {t("home.gos.newJob")}</span></div>
              <div className="a-kpis">
                <div><small>{t("home.gos.k1")}</small><b>7</b></div>
                <div><small>{t("home.gos.k2")}</small><b>3</b></div>
                <div><small>{t("home.gos.k3")}</small><b>2</b></div>
                <div><small>{t("home.gos.k4")}</small><b>5</b></div>
              </div>
              <div className="lanes">
                <div className="ln">
                  <h5>{t("home.gos.open")} <span>2</span></h5>
                  <div className="jc sel"><div className="top"><b>Toyota Axio</b><span className="plate"><i>WP</i><span>CAB-4521</span></span></div><p>{t("home.gos.j1")}</p><div className="tags"><span className="t-orange">{t("home.gos.fromKaduna")}</span></div></div>
                  <div className="jc"><div className="top"><b>Suzuki Wagon R</b><span className="plate"><i>WP</i><span>CAR-1187</span></span></div><p>{t("home.gos.j2")}</p></div>
                </div>
                <div className="ln">
                  <h5>{t("home.gos.working")} <span>2</span></h5>
                  <div className="jc"><div className="top"><b>Honda Vezel</b><span className="plate"><i>WP</i><span>CBH-2290</span></span></div><p>{t("home.gos.j3")}</p><div className="tags"><span className="t-amber">{t("home.gos.waitingParts")}</span></div><div className="prog"><i style={{ width: "40%" }} /></div></div>
                  <div className="jc"><div className="top"><b>Nissan Leaf</b><span className="plate"><i>CP</i><span>CAE-7302</span></span></div><p>{t("home.gos.j4")}</p><div className="tags"><span className="t-blue">{t("home.gos.approval")}</span></div><div className="prog"><i style={{ width: "70%" }} /></div></div>
                </div>
                <div className="ln">
                  <h5>{t("home.gos.ready")} <span>1</span></h5>
                  <div className="jc"><div className="top"><b>Toyota KDH</b><span className="plate"><i>WP</i><span>NC-6614</span></span></div><p>{t("home.gos.j5")}</p><div className="tags"><span className="t-green">{t("home.gos.paid")}</span></div></div>
                </div>
              </div>
            </div>
            <div className="a-ai">
              <div className="hd"><span className="bd"><I n="package" /></span>{t("home.gos.order")}<span className="plate"><i>WP</i><span>CBH-2290</span></span></div>
              <span className="lbl">{t("home.gos.fitsLabel")}</span>
              <div className="q best"><span className="sl" style={{ background: "#14a37a" }}>LS</span><span><b>{t("home.gos.part")}</b><small>Lanka Spares · {t("home.gos.inStock")}</small></span><span className="p">{t("home.gos.trade")}</span></div>
              <span className="lbl">{t("home.gos.howHere")}</span>
              <div className="q"><span className="sl" style={{ background: "#3b82f6" }}><I n="user" /></span><span><b>{t("home.gos.ownerCollects")}</b><small>{t("home.gos.ownerCollectsSub")}</small></span><span className="p">#482913</span></div>
              <span className="btn btn-primary">{t("home.gos.place")}</span>
            </div>
          </div>
        </div>

        <div className="gos-feats">
          {feats.map((f) => (
            <div key={f.key} className="gf"><span className="gi"><I n={f.icon} /></span><h3>{t(`home.gos.f.${f.key}`)}</h3><p>{t(`home.gos.f.${f.key}Body`)}</p></div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── The rest of Kaduna ──────────────────────────────────────────────────

function AlsoOnKaduna() {
  const t = useT();
  const items: { icon: IconName; tint: string; key: string; live: boolean }[] = [
    { icon: "shield", tint: "t-violet", key: "claims", live: true },
    { icon: "globe", tint: "t-blue", key: "geo", live: true },
    { icon: "pulse", tint: "t-green", key: "health", live: false },
  ];
  return (
    <section aria-labelledby="rm-title">
      <div className="wrap">
        <div className="section-head center"><span className="eyebrow">{t("home.more.eyebrow")}</span><h2 id="rm-title">{t("home.more.title")}</h2><p>{t("home.more.lead")}</p></div>
        <div className="rm-grid">
          {items.map((x) => (
            <article key={x.key} className="rm">
              <div className="rh"><span className={`ri ${x.tint}`}><I n={x.icon} /></span><span className={`soon ${x.live ? "live" : ""}`}>{x.live ? t("home.more.live") : t("home.more.soon")}</span></div>
              <h3>{t(`home.more.${x.key}`)}</h3>
              <p>{t(`home.more.${x.key}Body`)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function JoinBand() {
  const t = useT();
  const cards: { icon: IconName; key: string; href: string }[] = [
    { icon: "truck", key: "tow", href: "/join#providers" },
    { icon: "wrench", key: "garage", href: "/join#garages" },
    { icon: "store", key: "shop", href: "/join#parts" },
  ];
  return (
    <section className="cta-band" id="join" aria-labelledby="cta-title">
      <div className="wrap">
        <div className="cta-box">
          <span className="dots" aria-hidden="true" />
          <div><h2 id="cta-title">{t("home.cta.title")}</h2><p>{t("home.cta.lead")}</p></div>
          <div className="cta-actions">
            {cards.map((c) => (
              <Link key={c.key} className="cta-card" href={c.href}>
                <span className="ci"><I n={c.icon} /></span>
                <div><b>{t(`home.cta.${c.key}`)}</b><small>{t(`home.cta.${c.key}Sub`)}</small></div>
                <I n="arrow" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
