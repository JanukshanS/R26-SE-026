"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { useT } from "@/lib/i18n";
import { verifyClaimant } from "@/lib/claimFlow/verifyClaimant";
import type { ClaimLinkIdentity, VerifiedClaimant } from "@/lib/claimFlow/types";

const PRIMARY_BTN =
  "w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";

export function VerifyStep({
  prefill,
  onVerified,
}: {
  /** From the claim-link token, when the page was opened with one. */
  prefill: ClaimLinkIdentity | null;
  onVerified: (claimant: VerifiedClaimant, enteredNic: string) => void;
}) {
  const t = useT();
  const [nic, setNic] = useState(prefill?.nic ?? "");
  const [plateNumber, setPlateNumber] = useState(prefill?.plateNumber ?? "");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = nic.trim().length > 0 && plateNumber.trim().length > 0;

  const onConfirm = async () => {
    if (!ready || checking) return;
    setChecking(true);
    setError(null);
    const claimant = await verifyClaimant(nic.trim(), plateNumber.trim());
    setChecking(false);
    if (!claimant) {
      setError(t("claim.verify.notFound"));
      return;
    }
    onVerified(claimant, nic.trim());
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("claim.verify.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("claim.verify.body")}</p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <label className="block text-sm">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
            {t("claim.verify.fieldNic")}
          </span>
          <input
            value={nic}
            onChange={(e) => setNic(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
            {t("claim.verify.fieldPlate")}
          </span>
          <input
            value={plateNumber}
            onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
            placeholder="CBD-3742"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 uppercase"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="button" onClick={() => void onConfirm()} disabled={!ready || checking} className={PRIMARY_BTN}>
        <span className="flex items-center justify-center gap-2">
          {checking && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          {checking ? t("claim.verify.checking") : t("claim.verify.confirm")}
        </span>
      </button>
    </div>
  );
}
