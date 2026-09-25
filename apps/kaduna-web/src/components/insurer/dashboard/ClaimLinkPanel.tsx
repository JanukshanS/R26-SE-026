"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, LoaderCircle, Link2, MessageSquare } from "lucide-react";

import { useT } from "@/lib/i18n";
import {
  createClaimLink,
  searchVehicles,
  sendClaimLinkSms,
  type ClaimLinkResult,
  type VehicleSearchResult,
} from "@/lib/insurer/claimLinksApi";

const PRIMARY_BTN =
  "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";

/**
 * Insurer-side entry point for the "report without the app" flow: generates
 * a one-time link (see backend POST /claims/claim-links) that a claimant can
 * open in any mobile browser to walk through the same evidence-capture steps
 * the driver app enforces, with no install required.
 */
export function ClaimLinkPanel() {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const [nic, setNic] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimLinkResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [smsPending, setSmsPending] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);

  const [vehicleResults, setVehicleResults] = useState<VehicleSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  // Set right before a selection fills plateNumber, so the resulting state
  // change doesn't immediately re-trigger a search-and-reopen of the dropdown
  // for the very value the user just picked.
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    const query = plateNumber.trim();
    if (query.length < 2) {
      setVehicleResults([]);
      setShowResults(false);
      return;
    }
    const handle = setTimeout(() => {
      void searchVehicles(query).then((results) => {
        setVehicleResults(results);
        setShowResults(results.length > 0);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [plateNumber]);

  const onSelectVehicle = (v: VehicleSearchResult) => {
    skipNextSearchRef.current = true;
    setPlateNumber(v.plateNumber);
    setShowResults(false);
    setVehicleResults([]);
    if (v.nic) setNic(v.nic);
    if (v.phone) setPhone(v.phone);
  };

  const ready = nic.trim().length > 0 && plateNumber.trim().length > 0;

  const onGenerate = async () => {
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    setResult(null);
    setCopied(false);
    setSmsSent(false);
    setSmsError(null);
    try {
      const link = await createClaimLink({
        nic: nic.trim(),
        plateNumber: plateNumber.trim(),
        phone: phone.trim() || undefined,
      });
      setResult(link);
    } catch {
      setError(t("insurer.claimLink.errorFallback"));
    } finally {
      setPending(false);
    }
  };

  const onCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the URL is still visible to select/copy manually.
    }
  };

  // Reads `phone` live rather than freezing it at generation time — lets
  // staff fix up (or fill in) the number after seeing the result, when it
  // wasn't auto-filled by the vehicle search.
  const onSendSms = async () => {
    if (!result || !phone.trim() || smsPending) return;
    setSmsPending(true);
    setSmsError(null);
    setSmsSent(false);
    try {
      await sendClaimLinkSms({ phone: phone.trim(), url: result.url });
      setSmsSent(true);
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : t("insurer.claimLink.smsErrorFallback"));
    } finally {
      setSmsPending(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <Link2 className="size-4 text-primary" aria-hidden />
          <h2 className="font-display text-base font-semibold tracking-tight">
            {t("insurer.claimLink.heading")}
          </h2>
        </span>
        {expanded ? (
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>

      {expanded && (
        <>
          <p className="mt-1 text-sm text-muted-foreground">{t("insurer.claimLink.intro")}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="relative block text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                {t("insurer.claimLink.fieldPlate")}
              </span>
              <input
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                onFocus={() => setShowResults(vehicleResults.length > 0)}
                onBlur={() => setTimeout(() => setShowResults(false), 150)}
                placeholder="CBD-3742"
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase"
              />
              {showResults && (
                <ul className="absolute z-10 mt-1 w-full min-w-[14rem] rounded-md border border-border bg-popover shadow-md">
                  {vehicleResults.map((v) => (
                    <li key={v.plateNumber}>
                      <button
                        type="button"
                        // onMouseDown (not onClick) fires before the input's onBlur closes the list.
                        onMouseDown={() => onSelectVehicle(v)}
                        className="block w-full px-3 py-2 text-left text-sm normal-case hover:bg-accent"
                      >
                        <span className="font-semibold">{v.plateNumber}</span>
                        {v.vehicleModel && (
                          <span className="ml-2 text-muted-foreground">{v.vehicleModel}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label className="block text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                {t("insurer.claimLink.fieldNic")}
              </span>
              <input
                value={nic}
                onChange={(e) => setNic(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                {t("insurer.claimLink.fieldPhone")}
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={!ready || pending}
              className={PRIMARY_BTN}
            >
              <span className="flex items-center gap-2">
                {pending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
                {pending ? t("insurer.claimLink.generating") : t("insurer.claimLink.generate")}
              </span>
            </button>
            {!ready && (
              <span className="text-sm text-muted-foreground">{t("insurer.claimLink.needFields")}</span>
            )}
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          {result && (
            <div className="mt-4 rounded-lg border border-border bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("insurer.claimLink.resultHeading")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code className="break-all rounded bg-muted px-2 py-1 text-sm">{result.url}</code>
                <button
                  type="button"
                  onClick={() => void onCopy()}
                  className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent"
                >
                  {copied ? (
                    <>
                      <Check className="size-3.5" /> {t("insurer.claimLink.copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" /> {t("insurer.claimLink.copy")}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void onSendSms()}
                  disabled={!phone.trim() || smsPending}
                  title={!phone.trim() ? t("insurer.claimLink.smsNeedsPhone") : undefined}
                  className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  {smsPending ? (
                    <>
                      <LoaderCircle className="size-3.5 animate-spin" /> {t("insurer.claimLink.sendingSms")}
                    </>
                  ) : smsSent ? (
                    <>
                      <Check className="size-3.5" /> {t("insurer.claimLink.smsSent")}
                    </>
                  ) : (
                    <>
                      <MessageSquare className="size-3.5" /> {t("insurer.claimLink.sendSms")}
                    </>
                  )}
                </button>
              </div>
              {!phone.trim() && (
                <p className="mt-2 text-xs text-muted-foreground">{t("insurer.claimLink.smsNeedsPhone")}</p>
              )}
              {smsError && <p className="mt-2 text-xs text-red-600">{smsError}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {t("insurer.claimLink.expiresIn", { hours: result.expiresInHours })}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
