/**
 * App localisation — English, Sinhala, Tamil.
 *
 * Deliberately dependency-free. Reading the device locale is the only thing a
 * library would have bought us, and that needs a native module (a rebuild) to
 * do properly; the language picker is the requirement, device detection is a
 * courtesy. `Intl` gives us a good-enough guess with no new dependency at all.
 *
 * ── Contract for translated copy ────────────────────────────────────────
 *   t("driver.home.greeting", { name })   → "Hi Asath!"
 *   t("driver.trips.count", { count: n }) → picks ...count_one / ...count_other
 *
 * Keys are stable dot-paths named for MEANING, never for the English text, so
 * rewording the English never invalidates a translation. Catalogues are flat
 * maps of fully-qualified key → string, one file per namespace, merged in
 * locales/<locale>/index.ts.
 *
 * Sinhala and Tamil both have two plural categories, the same as English, so
 * the _one/_other pair covers all three languages and there is no ICU
 * machinery here to maintain.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import en from "@/locales/en";
import si from "@/locales/si";
import ta from "@/locales/ta";

export const LOCALES = ["en", "si", "ta"] as const;
export type Locale = (typeof LOCALES)[number];

/** Native name first — someone looking for their language reads it in it. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
};

const CATALOGUES: Record<Locale, Record<string, string>> = { en, si, ta };

const STORAGE_KEY = "kaduna.locale";

export type TranslateVars = Record<string, string | number>;
export type Translate = (key: string, vars?: TranslateVars) => string;
/** Signature of `useI18n().formatDate`, for helpers that take one as a parameter. */
export type FormatDate = (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;

/**
 * Resolve one key. Falls back through: requested locale → English → the key
 * itself. Returning the key rather than an empty string means a missing
 * translation shows up as `driver.home.greeting` on screen — obvious in QA,
 * and never a blank button.
 */
function lookup(locale: Locale, key: string): string {
  return CATALOGUES[locale][key] ?? CATALOGUES.en[key] ?? key;
}

export function translateWith(locale: Locale): Translate {
  return (key, vars) => {
    let k = key;
    if (vars && typeof vars.count === "number") {
      const plural = `${key}_${vars.count === 1 ? "one" : "other"}`;
      if (CATALOGUES[locale][plural] ?? CATALOGUES.en[plural]) k = plural;
    }
    let out = lookup(locale, k);
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        out = out.split(`{{${name}}}`).join(String(value));
      }
    }
    return out;
  };
}

/** BCP-47 tag for Intl. Sri Lanka for all three — this is a Sri Lankan app. */
export function bcp47(locale: Locale): string {
  return locale === "en" ? "en-LK" : `${locale}-LK`;
}

/**
 * Hermes ships a subset of ICU, so a locale it does not carry data for can
 * throw rather than fall back. Every formatter here degrades to en-GB instead
 * of taking a screen down over a date.
 */
function safeFormat(fn: (tag: string) => string, locale: Locale): string {
  try {
    return fn(bcp47(locale));
  } catch {
    try {
      return fn("en-GB");
    } catch {
      return "";
    }
  }
}

type I18nValue = {
  locale: Locale;
  t: Translate;
  setLocale: (l: Locale) => void;
  /** True until the stored choice has been read — splash screens can wait on it. */
  ready: boolean;
  formatDate: FormatDate;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
  /** Rupees, the way they are written here: "LKR 28,500". */
  formatCurrency: (n: number) => string;
};

function buildValue(
  locale: Locale,
  setLocale: (l: Locale) => void,
  ready: boolean
): I18nValue {
  const t = translateWith(locale);
  return {
    locale,
    t,
    setLocale,
    ready,
    formatDate: (d, opts) => {
      const date = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(date.getTime())) return "";
      return safeFormat(
        (tag) =>
          new Intl.DateTimeFormat(tag, opts ?? { day: "numeric", month: "short", year: "numeric" }).format(date),
        locale
      );
    },
    formatNumber: (n, opts) => safeFormat((tag) => new Intl.NumberFormat(tag, opts).format(n), locale),
    formatCurrency: (n) =>
      `LKR ${safeFormat((tag) => new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(n), locale)}`,
  };
}

/**
 * The default is a working English translator, not a throw. Components render
 * correctly in tests and in any tree that has not mounted the provider, which
 * is why the existing suite needed no changes when copy moved into catalogues.
 */
const I18nContext = createContext<I18nValue>(buildValue("en", () => {}, true));

/** Best guess from the device, used only until the driver picks for themselves. */
function deviceLocale(): Locale {
  try {
    const tag = new Intl.DateTimeFormat().resolvedOptions().locale ?? "en";
    const base = tag.toLowerCase().split(/[-_]/)[0];
    return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : "en";
  } catch {
    return "en";
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        const next =
          stored && (LOCALES as readonly string[]).includes(stored)
            ? (stored as Locale)
            : deviceLocale();
        setLocaleState(next);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => buildValue(locale, setLocale, ready), [locale, setLocale, ready]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/** The common case — `const t = useT()`. */
export function useT(): Translate {
  return useContext(I18nContext).t;
}
