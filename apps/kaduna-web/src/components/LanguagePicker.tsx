"use client";

import { Globe } from "lucide-react";

import { LOCALE_LABELS, LOCALES, useI18n, type Locale } from "@/lib/i18n";

/**
 * Language switcher for the site chrome.
 *
 * A native <select> rather than a custom dropdown: it is keyboard-navigable,
 * screen-reader-correct and renders as the platform's own picker on mobile,
 * none of which a hand-rolled menu would give us for free.
 *
 * Options are labelled in their own script and never translated — someone who
 * reads only Sinhala looks for "සිංහල", not for "Sinhala".
 */
export default function LanguagePicker({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <Globe aria-hidden className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
      <span className="sr-only">{t("common.language.label")}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="appearance-none rounded-md border border-input bg-background py-1.5 pl-8 pr-7 text-sm font-medium hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-2 size-3.5 fill-muted-foreground"
      >
        <path d="M5.5 7.5 10 12l4.5-4.5z" />
      </svg>
    </label>
  );
}
