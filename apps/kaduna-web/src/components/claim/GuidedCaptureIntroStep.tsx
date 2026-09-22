"use client";

import { Info } from "lucide-react";

import { useT } from "@/lib/i18n";
import { ArcCarousel } from "./illustrations/ArcCarousel";
import { PoseFigureIcon } from "./illustrations/PoseFigureIcon";

const PRIMARY_BTN =
  "w-full rounded-md bg-[#f97316] px-5 py-3 text-sm font-semibold text-white hover:opacity-90";

/**
 * Shown once before Guided Capture starts — ported from apps/mobile's
 * guided-capture-intro.tsx + capture-instructions.tsx (pose icons + callout
 * copy + the 3-slide swipeable arc carousel showing front/side/rear corner
 * coverage, so it's clear the walk-around pattern applies to any side of the
 * car, not one fixed start point).
 */
export function GuidedCaptureIntroStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("claim.captureIntro.title")}</h1>
      </div>

      <div className="flex justify-center rounded-xl bg-white py-4">
        <ArcCarousel />
      </div>

      <div className="flex items-start gap-2.5 rounded-xl bg-[#FFEDD5] px-4 py-3">
        <Info className="mt-0.5 size-5 shrink-0 text-[#f97316]" aria-hidden />
        <p className="text-sm font-medium text-[#111111]">{t("claim.captureIntro.calloutPath")}</p>
      </div>

      <div className="flex justify-around">
        <PoseFigureIcon armPose="overhead" number={1} label={t("claim.captureIntro.poseOverhead")} />
        <PoseFigureIcon armPose="chest" number={2} label={t("claim.captureIntro.poseChest")} />
        <PoseFigureIcon armPose="waist" number={3} label={t("claim.captureIntro.poseWaist")} />
      </div>

      <div className="flex items-start gap-2.5 rounded-xl bg-[#FFEDD5] px-4 py-3">
        <Info className="mt-0.5 size-5 shrink-0 text-[#f97316]" aria-hidden />
        <p className="text-sm font-medium text-[#111111]">{t("claim.captureIntro.calloutOrder")}</p>
      </div>

      <button type="button" onClick={onNext} className={PRIMARY_BTN}>
        {t("claim.common.next")}
      </button>
    </div>
  );
}
