"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, MapPin, PhoneCall } from "lucide-react";

import { useT } from "@/lib/i18n";
import { ensureClaimSession } from "@/lib/claimFlow/session";
import { captureLocationSnapshot } from "@/lib/claimFlow/location";
import { findInsuranceCompany, type InsuranceCompany } from "@/lib/claimFlow/insuranceCompanies";
import type { LocationSnapshot, VerifiedClaimant } from "@/lib/claimFlow/types";

const PRIMARY_BTN =
  "w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-transform duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-50";
const GHOST_BTN =
  "w-full rounded-md border border-input px-5 py-3 text-sm font-medium transition-transform duration-150 hover:bg-accent active:scale-[0.97] disabled:opacity-50";

export function CallInsurerStep({
  claimant,
  onDone,
  submitting,
  error,
}: {
  claimant: VerifiedClaimant;
  onDone: (location: LocationSnapshot) => void;
  /** True while ClaimFlow is creating the capture row after Continue is tapped. */
  submitting: boolean;
  error: string | null;
}) {
  const t = useT();
  const [insurer, setInsurer] = useState<InsuranceCompany | null>(null);
  const [resolvingInsurer, setResolvingInsurer] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [location, setLocation] = useState<LocationSnapshot | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    // First real thing this flow needs Supabase for — bootstrap the
    // anonymous session here (not on VerifyStep) so a claimant who bounces
    // off the identity screen never creates a session/leaves a footprint.
    // Best-effort/early: ClaimFlow awaits this for real before it actually
    // matters (creating the capture row), so a slow or failed attempt here
    // doesn't get silently swallowed — see ensureClaimSession's doc comment.
    void ensureClaimSession();
    let cancelled = false;
    setResolvingInsurer(true);
    void findInsuranceCompany(claimant.insuranceProvider)
      .then((company) => {
        if (!cancelled) setInsurer(company);
      })
      .finally(() => {
        if (!cancelled) setResolvingInsurer(false);
      });
    return () => {
      cancelled = true;
    };
  }, [claimant.insuranceProvider]);

  const onConfirmCalled = () => {
    setConfirmed(true);
  };

  const onShareLocation = async () => {
    setLocating(true);
    const snap = await captureLocationSnapshot();
    setLocation(snap);
    setLocating(false);
  };

  const canContinue = confirmed && location != null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("claim.callInsurer.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("claim.callInsurer.body")}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        {resolvingInsurer ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> …
          </div>
        ) : insurer ? (
          <a
            href={insurer.phoneTel}
            onClick={onConfirmCalled}
            className="flex items-center gap-3 rounded-md border border-input px-4 py-3 hover:bg-accent"
          >
            <PhoneCall className="size-5 text-primary" aria-hidden />
            <span className="font-medium">
              {t("claim.callInsurer.button", { name: insurer.appName })}
            </span>
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">{t("claim.callInsurer.noInsurerHint")}</p>
        )}
        {/* Always reachable once the lookup has settled — whether or not an
            insurer was found, the claimant must still be able to confirm
            they've made the call and move on (e.g. no insurer on file, or
            they called from memory instead of tapping the number). */}
        {!resolvingInsurer && !confirmed && (
          <button
            type="button"
            onClick={onConfirmCalled}
            className="mt-3 text-xs font-medium text-primary underline underline-offset-2"
          >
            {t("claim.callInsurer.buttonGeneric")}
          </button>
        )}
        {confirmed && (
          <p className="mt-3 text-xs font-medium text-green-700">{t("claim.callInsurer.confirmed")}</p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-base font-semibold tracking-tight">
          {t("claim.callInsurer.locationTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("claim.callInsurer.locationBody")}</p>
        <button
          type="button"
          onClick={() => void onShareLocation()}
          disabled={locating}
          className={`mt-3 flex items-center justify-center gap-2 ${GHOST_BTN}`}
        >
          {locating ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
          {locating ? t("claim.callInsurer.locating") : t("claim.callInsurer.useMyLocation")}
        </button>
        {location && (
          <p className="mt-3 text-sm">
            {location.locationPermission === "granted" ? (
              <span className="text-green-700">
                {t("claim.callInsurer.locationConfirmed")} — {location.locationLabel}
              </span>
            ) : (
              <span className="text-amber-700">{t("claim.callInsurer.locationDenied")}</span>
            )}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={() => location && onDone(location)}
        disabled={!canContinue || submitting}
        className={PRIMARY_BTN}
      >
        <span className="flex items-center justify-center gap-2">
          {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {submitting ? t("claim.common.uploading") : t("claim.common.continue")}
        </span>
      </button>
    </div>
  );
}
