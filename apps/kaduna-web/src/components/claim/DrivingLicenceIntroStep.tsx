"use client";

import { ShieldCheck } from "lucide-react";

import { useT } from "@/lib/i18n";

const PRIMARY_BTN =
  "w-full rounded-md bg-[#f97316] px-5 py-3 text-sm font-semibold text-white transition-transform duration-150 hover:opacity-90 active:scale-[0.97]";

/**
 * Brief heads-up screen shown once the vehicle walkaround (Guided Capture) is
 * done, before Driving Licence — those two steps look and feel different
 * enough (car photos vs. personal documents + a verification video) that
 * jumping straight from one to the other with no transition read like the
 * flow had broken or lost its place, rather than moving deliberately into
 * the next section.
 */
export function DrivingLicenceIntroStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-[#FFEDD5] text-[#f97316]">
          <ShieldCheck className="size-8" aria-hidden />
        </span>
      </div>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("claim.licenceIntro.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("claim.licenceIntro.body")}</p>
      </div>
      <button type="button" onClick={onNext} className={PRIMARY_BTN}>
        {t("claim.common.continue")}
      </button>
    </div>
  );
}
