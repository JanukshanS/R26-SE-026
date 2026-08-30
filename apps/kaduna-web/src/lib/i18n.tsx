"use client";

/**
 * Site localisation — English, Sinhala, Tamil.
 *
 * The site is a static export (`output: "export"` in next.config), so there is
 * no middleware and therefore no `/[locale]/` routing: the locale is client
 * state, persisted in localStorage. Every page here is already client-rendered
 * off Supabase, so nothing is lost but per-locale URLs — see
 * cursorgenerateddocs/demo/I18N-ESTIMATE.md for the SEO trade-off that buys.
 *
 * Keys, plural suffixes and the fallback chain match apps/mobile/lib/i18n.tsx
 * exactly, so the shared parts of the catalogue (the triage questionnaire
 * above all) can be lifted into contracts/ later without touching call sites.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import en from "@/locales/en";
import si from "@/locales/si";
import ta from "@/locales/ta";

export const LOCALES = ["en", "si", "ta"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
};

const CATALOGUES: Record<Locale, Record<string, string>> = { en, si, ta };

const STORAGE_KEY = "kaduna.locale";

export type TranslateVars = Record<string, string | number>;
export type Translate = (key: string, vars?: TranslateVars) => string;

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

export function bcp47(locale: Locale): string {
  return locale === "en" ? "en-LK" : `${locale}-LK`;
}

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
  formatDate: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
  formatCurrency: (n: number) => string;
};

function buildValue(locale: Locale, setLocale: (l: Locale) => void): I18nValue {
  return {
    locale,
    t: translateWith(locale),
    setLocale,
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

const I18nContext = createContext<I18nValue>(buildValue("en", () => {}));

function browserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = (tag ?? "").toLowerCase().split("-")[0];
    if ((LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Starts at "en" on purpose. The export is prerendered in English, so
  // reading localStorage during render would mismatch the server HTML; the
  // stored choice is applied on the first effect instead.
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode or a blocked origin — fall through to the browser's own
      // language preference.
    }
    setLocaleState(
      stored && (LOCALES as readonly string[]).includes(stored) ? (stored as Locale) : browserLocale()
    );
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is not a reason to refuse it.
    }
  }, []);

  const value = useMemo(() => buildValue(locale, setLocale), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function useT(): Translate {
  return useContext(I18nContext).t;
}
