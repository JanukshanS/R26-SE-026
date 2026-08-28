"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { AccidentImage, Claim, ClaimLocationEntry } from "@/lib/insurer/types";
import { useInsurerUser } from "@/lib/insurer/auth";
import { authHeaders, API_BASE } from "@/lib/insurer/api";
import { usePipelineJob } from "@/lib/insurer/PipelineJobContext";
import { AccidentImagesPanel } from "./AccidentImagesPanel";
import { MediaViewerPanel } from "./MediaViewerPanel";

const CompareViewCanvas = dynamic(
  () => import("@/components/insurer/three/CompareViewCanvas").then((m) => ({ default: m.CompareViewCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="compare-view" style={{ border: "1px solid var(--border)", borderRadius: "0.75rem" }}>
        <div className="compare-view__header">
          <h3 className="compare-view__title">Generated 3D Model</h3>
          <div className="compare-view__header-actions" />
        </div>
        <div className="compare-view__canvas-wrap">
          <div className="compare-view__empty">
            <div className="compare-view__spinner" aria-label="Loading" />
          </div>
        </div>
      </div>
    ),
  }
);

type ModelState = "idle" | "generating" | "ready" | "error" | "low_light";
type SavedModel = { job_id: string; created_at: string };

function InfoRow({ label, value, passed }: { label: string; value?: string; passed?: boolean }) {
  return (
    <div className="irow grid items-center gap-3 px-3 py-2 rounded-md hover:bg-accent text-sm">
      <span className="text-xs text-muted-foreground whitespace-nowrap">{label}</span>
      <span className="font-medium text-foreground truncate">{value ?? ""}</span>
      {passed !== undefined ? (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 whitespace-nowrap ${
            passed ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
          }`}
        >
          {passed ? "✓ Passed" : "✗ Failed"}
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}

function LocationBlock({
  label,
  sublabel,
  entry,
}: {
  label: string;
  sublabel: string;
  entry?: ClaimLocationEntry;
}) {
  const address = entry?.location_label ?? "—";
  const timestamp =
    entry?.captured_at_display_local ??
    (entry?.captured_at ? new Date(entry.captured_at).toLocaleString() : "—");
  const coords =
    entry?.gps_lat != null && entry?.gps_lng != null
      ? `${entry.gps_lat.toFixed(5)}, ${entry.gps_lng.toFixed(5)}`
      : null;

  return (
    <div className="flex flex-col gap-1 pb-5 border-b border-border last:border-b-0 last:pb-0">
      <div className="flex items-baseline gap-1">
        <span className="text-xs font-bold text-primary uppercase tracking-wide">{label}</span>
        <span className="text-xs text-muted-foreground">{sublabel}</span>
      </div>
      <span className="text-sm text-foreground leading-relaxed">{address}</span>
      {coords && entry?.gps_lat != null && entry?.gps_lng != null ? (
        <a
          href={`https://www.google.com/maps?q=${entry.gps_lat},${entry.gps_lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 self-start px-2 py-0.5 border-2 border-primary rounded text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
        >
          {coords}
          <span aria-hidden>↗</span>
        </a>
      ) : null}
      <span className="text-xs text-muted-foreground">{timestamp}</span>
    </div>
  );
}

export function ClaimDetailPanel({
  claim,
  expanded = false,
  onToggleExpand,
  isAnimating = false,
}: {
  claim: Claim;
  expanded?: boolean;
  onToggleExpand?: () => void;
  isAnimating?: boolean;
}) {
  const { user } = useInsurerUser();
  const { activeJob, startPolling } = usePipelineJob();
  const isStaff = user?.role === "staff";
  const canApprove = user?.role === "admin" || user?.role === "agent";
  const anyJobGenerating = activeJob?.state === "generating";

  const [showImages, setShowImages] = useState(false);
  const [showUserVerification, setShowUserVerification] = useState(false);
  const [showThirdParty, setShowThirdParty] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [showEnhanced, setShowEnhanced] = useState(false);

  const [localSplatUrl, setLocalSplatUrl] = useState<string | undefined>(undefined);
  const [localEnhancedJobId, setLocalEnhancedJobId] = useState<string | null>(null);
  const [existingModels, setExistingModels] = useState<SavedModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);

  const [insuranceExpiry, setInsuranceExpiry] = useState<string | null>(null);
  const [startError, setStartError] = useState(false);
  const [starting, setStarting] = useState(false);

  const [photoData, setPhotoData] = useState<{
    walkaround: AccidentImage[];
    user_verification: AccidentImage[];
    third_party: AccidentImage[];
  } | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);

  const [enhancedPhotos, setEnhancedPhotos] = useState<string[]>([]);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  const isActiveJobHere = activeJob?.folder === claim.folder;

  const modelState: ModelState = startError
    ? "error"
    : isActiveJobHere && activeJob!.state === "generating"
      ? "generating"
      : localSplatUrl
        ? "ready"
        : "idle";

  const jobStillRunning = isActiveJobHere && activeJob!.state === "generating";
  const splatUrl =
    jobStillRunning && activeJob!.splatUrl ? activeJob!.splatUrl : localSplatUrl;
  const enhancedJobId =
    jobStillRunning && activeJob!.enhancedJobId
      ? activeJob!.enhancedJobId
      : localEnhancedJobId;

  useEffect(() => {
    setApproved(false);
    setApproving(false);
  }, [claim.folder]);

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await fetch(`${API_BASE}/claims/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          nic: claim.nic,
          customer_name: claim.customer,
          folder: claim.folder,
        }),
      });
      if (!res.ok) throw new Error("Failed to approve claim");
      setApproved(true);
    } catch {
      alert("Could not approve this claim. Please try again.");
    } finally {
      setApproving(false);
    }
  }

  const activeFolderRef = useRef(claim.folder);

  const fetchModels = (folder: string) => {
    setModelsLoading(true);
    return fetch(`${API_BASE}/claims/${encodeURIComponent(folder)}/models`)
      .then((r) => (r.ok ? r.json() : []))
      .then((models: SavedModel[]) => {
        if (activeFolderRef.current !== folder) return;
        setExistingModels(models);
        if (models.length > 0)
          setLocalSplatUrl(`${API_BASE}/pipeline/jobs/${models[0].job_id}/splat`);
      })
      .catch(() => {})
      .finally(() => {
        if (activeFolderRef.current === folder) setModelsLoading(false);
      });
  };

  const fetchEnhancedJobs = (folder: string) =>
    fetch(`${API_BASE}/claims/${encodeURIComponent(folder)}/enhanced-jobs`)
      .then((r) => (r.ok ? r.json() : []))
      .then((jobs: SavedModel[]) => {
        if (activeFolderRef.current !== folder) return;
        if (jobs.length > 0) setLocalEnhancedJobId(jobs[0].job_id);
      })
      .catch(() => {});

  async function ensurePhotosLoaded() {
    if (photoData || photosLoading) return;
    setPhotosLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/claims/${encodeURIComponent(claim.folder)}/photos`,
        { headers: authHeaders() }
      );
      if (res.ok) setPhotoData(await res.json());
    } finally {
      setPhotosLoading(false);
    }
  }

  useEffect(() => {
    const folder = claim.folder;
    activeFolderRef.current = folder;

    setLocalSplatUrl(undefined);
    setLocalEnhancedJobId(null);
    setExistingModels([]);
    setShowModelPicker(false);
    setEnhancedPhotos([]);
    setShowEnhanced(false);
    setStartError(false);
    setPhotoData(null);
    setPhotosLoading(false);
    setInsuranceExpiry(null);
    setShowImages(false);
    setShowUserVerification(false);
    setShowThirdParty(false);
    setShowLocation(false);

    fetchModels(folder);
    fetchEnhancedJobs(folder);

    fetch(`${API_BASE}/claims/${encodeURIComponent(folder)}/expiry`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (activeFolderRef.current !== folder) return;
        if (data) setInsuranceExpiry(data.insuranceExpireMonth ?? null);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim.folder]);

  async function handleGenerateModel() {
    setStartError(false);
    setStarting(true);
    try {
      const createRes = await fetch(`${API_BASE}/pipeline/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nic: claim.nic,
          customer_name: claim.customer,
          folder: claim.folder,
        }),
      });
      if (!createRes.ok) throw new Error("Failed to create pipeline job");
      const { job_id } = await createRes.json();

      await fetch(
        `${API_BASE}/pipeline/jobs/${job_id}/run?background=true&skip_zero_dce=true`,
        { method: "POST" }
      );

      startPolling(claim.nic, claim.folder, claim.vehicleRegNo ?? claim.nic, job_id);
    } catch {
      setStartError(true);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section
      className={`claim-panel rounded-xl border border-border bg-card flex flex-col min-h-0 overflow-hidden relative${
        expanded ? " claim-detail--expanded" : ""
      }${isAnimating ? " claim-detail--animating" : ""}`}
    >
      <div className="claim-info flex flex-col gap-2 shrink-0">
        <div className="claim-body flex items-stretch rounded-xl border border-border overflow-hidden">
          <div className="claim-rows flex-1 min-w-0">
            <div className="px-3 py-2 border-b border-border bg-muted/40">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Claim Details</span>
            </div>
            <InfoRow label="NIC" value={claim.nic} passed={true} />
            <InfoRow label="Customer" value={claim.customer} passed={true} />
            <InfoRow label="Policy ID" value={claim.policyId} passed={true} />
            {(insuranceExpiry ?? claim.insuranceExpireMonth) && (
              <InfoRow
                label="Insurance Expiry"
                value={insuranceExpiry ?? claim.insuranceExpireMonth!}
                passed={true}
              />
            )}
            <InfoRow label="Vehicle Model" value={claim.vehicleModel} passed={true} />
            <InfoRow
              label="Vehicle Reg No"
              value={claim.vehicleRegNo ?? "CBQ - 6899"}
              passed={true}
            />
          </div>

          <div className="claim-views flex flex-col shrink-0 w-[190px] border-l border-border">
            <div className="px-3 py-2 border-b border-border bg-muted/40 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documents</span>
            </div>
            {claim.userVerificationAvailable ? (
              <button
                type="button"
                className="flex items-center justify-between gap-2 w-full px-3 py-2.5 text-sm font-medium text-foreground border-b border-border hover:bg-primary/5 hover:text-primary transition-all"
                onClick={() => {
                  void ensurePhotosLoaded();
                  setShowUserVerification(true);
                }}
              >
                <span>User Verification</span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 opacity-40">
                  <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <div className="flex items-center justify-between gap-2 w-full px-3 py-2.5 text-sm text-muted-foreground/40 border-b border-border select-none">
                <span>User Verification</span>
                <span className="text-xs">N/A</span>
              </div>
            )}

            <button
              type="button"
              className="flex items-center justify-between gap-2 w-full px-3 py-2.5 text-sm font-medium text-foreground border-b border-border hover:bg-primary/5 hover:text-primary transition-all"
              onClick={() => {
                void ensurePhotosLoaded();
                setShowImages(true);
              }}
            >
              <span>Accident Images</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 opacity-40">
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {claim.thirdPartyApplicable ? (
              <button
                type="button"
                className="flex items-center justify-between gap-2 w-full px-3 py-2.5 text-sm font-medium text-foreground border-b border-border hover:bg-primary/5 hover:text-primary transition-all"
                onClick={() => {
                  void ensurePhotosLoaded();
                  setShowThirdParty(true);
                }}
              >
                <span>3rd Party Details</span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 opacity-40">
                  <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <div className="flex items-center justify-between gap-2 w-full px-3 py-2.5 text-sm text-muted-foreground/40 border-b border-border select-none">
                <span>3rd Party Details</span>
                <span className="text-xs">N/A</span>
              </div>
            )}

            <button
              type="button"
              className={`flex items-center justify-between gap-2 w-full px-3 py-2.5 text-sm font-medium text-foreground hover:bg-primary/5 hover:text-primary transition-all${enhancedJobId && modelState !== "generating" ? " border-b border-border" : ""}`}
              onClick={() => setShowLocation(true)}
            >
              <span>Location Details</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 opacity-40">
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {enhancedJobId && modelState !== "generating" && (
              <button
                type="button"
                className="flex items-center justify-between gap-2 w-full px-3 py-2.5 text-sm font-medium text-foreground hover:bg-primary/5 hover:text-primary transition-all"
                onClick={async () => {
                  if (enhancedPhotos.length === 0) {
                    const res = await fetch(`${API_BASE}/pipeline/jobs/${enhancedJobId}/enhanced-photos`);
                    if (res.ok) setEnhancedPhotos(await res.json());
                  }
                  setShowEnhanced(true);
                }}
              >
                <span>Enhanced Photos</span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 opacity-40">
                  <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>

          <div className="claim-btns flex flex-col shrink-0 w-[150px] border-l border-border">
            <div className="px-3 py-2 border-b border-border bg-muted/40 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</span>
            </div>
            <div className="flex flex-col gap-1.5 p-2 flex-1">
            {canApprove && (
              <button
                type="button"
                disabled={approving || approved}
                onClick={() => setShowApproveConfirm(true)}
                className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700 transition-colors shadow-sm disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {approved ? "Approved ✓" : approving ? "Approving…" : "Approve"}
              </button>
            )}
            {canApprove && (
              <button
                type="button"
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                Require Inspection
              </button>
            )}

            {modelState !== "generating" &&
              (modelsLoading ? (
                <button type="button" disabled className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold bg-primary text-primary-foreground opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                  <span className="btn-spinner" />Checking…
                </button>
              ) : existingModels.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowModelPicker(true)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors shadow-sm"
                >
                  View 3D Model
                </button>
              ) : null)}

            {!isStaff && (
              <button
                type="button"
                onClick={handleGenerateModel}
                disabled={starting || anyJobGenerating}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {modelState === "generating" ? (
                  <><span className="btn-spinner" />Generating…</>
                ) : starting ? (
                  <><span className="btn-spinner" />Starting…</>
                ) : existingModels.length > 0 ? (
                  "Generate New Model"
                ) : (
                  "Generate 3D Model"
                )}
              </button>
            )}

            {!isStaff && modelState === "error" && (
              <button
                type="button"
                onClick={handleGenerateModel}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                Retry 3D Model
              </button>
            )}
            </div>
          </div>
        </div>
      </div>

      <div className="claim-detail__compare flex-1 min-h-[200px] flex">
        <CompareViewCanvas
          splatUrl={splatUrl}
          isLoading={modelsLoading}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          isTransitioning={isAnimating}
        />
      </div>

      <AccidentImagesPanel
        nic={claim.nic}
        images={photoData?.walkaround ?? []}
        loading={photosLoading}
        visible={showImages}
        onClose={() => setShowImages(false)}
        referenceLocation={claim.locations?.insurer_call ?? null}
      />
      <MediaViewerPanel
        title="User Verification Test"
        urls={photoData?.user_verification ?? []}
        loading={photosLoading}
        visible={showUserVerification}
        onClose={() => setShowUserVerification(false)}
        claim={claim}
        referenceLocation={claim.locations?.insurer_call ?? null}
      />
      <MediaViewerPanel
        title="3rd Party Details"
        urls={photoData?.third_party ?? []}
        loading={photosLoading}
        visible={showThirdParty}
        onClose={() => setShowThirdParty(false)}
        claim={claim}
        referenceLocation={claim.locations?.insurer_call ?? null}
      />

      {showModelPicker && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="w-[min(360px,90%)] rounded-xl border border-border bg-card shadow-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">Select 3D Model</h3>
              <button
                type="button"
                onClick={() => setShowModelPicker(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col p-2 gap-1.5 max-h-72 overflow-y-auto">
              {existingModels.map((m, i) => (
                <button
                  key={m.job_id}
                  type="button"
                  onClick={() => {
                    setLocalSplatUrl(`${API_BASE}/pipeline/jobs/${m.job_id}/splat`);
                    setShowModelPicker(false);
                  }}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-md border text-left gap-4 transition-colors ${
                    splatUrl?.includes(m.job_id)
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary hover:bg-accent"
                  }`}
                >
                  <span className="text-sm font-semibold">
                    Model {existingModels.length - i}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {m.created_at ? new Date(m.created_at).toLocaleString() : "Unknown date"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showLocation && (
        <div className="absolute inset-0 z-20 rounded-xl border border-border bg-card flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <h3 className="text-sm font-semibold">Location Details</h3>
            <button
              type="button"
              onClick={() => setShowLocation(false)}
              className="text-muted-foreground hover:text-foreground text-xl leading-none"
            >
              ×
            </button>
          </div>
          <div className="flex flex-col justify-center gap-6 px-10 py-8 flex-1 overflow-y-auto">
            <LocationBlock label="Reported" sublabel=" " entry={claim.locations?.insurer_call} />
            <LocationBlock
              label="Captured"
              sublabel=" "
              entry={claim.locations?.guided_capture_started}
            />
            <LocationBlock
              label="Submitted"
              sublabel=" "
              entry={claim.locations?.report_submitted}
            />
          </div>
        </div>
      )}

      {showEnhanced && (
        <div className="absolute inset-0 z-20 rounded-xl border border-border bg-card flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              Enhanced Photos
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                Zero-DCE
              </span>
            </h3>
            <button
              type="button"
              onClick={() => setShowEnhanced(false)}
              className="text-muted-foreground hover:text-foreground text-xl leading-none"
            >
              ×
            </button>
          </div>
          <div className="px-4 py-3 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
            Photos were too dark for 3D reconstruction. Zero-DCE neural enhancement has been applied.
          </div>
          {enhancedPhotos.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Loading enhanced photos…
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {enhancedPhotos.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Enhanced photo ${i + 1}`}
                  className="w-full aspect-[4/3] object-cover rounded-md border border-border cursor-pointer hover:opacity-85 transition-opacity"
                  onClick={() => window.open(url, "_blank")}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showApproveConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowApproveConfirm(false)}
        >
          <div
            className="w-[min(480px,94vw)] rounded-xl border border-border bg-card shadow-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold">Confirm Approval</h3>
              <button
                type="button"
                onClick={() => setShowApproveConfirm(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-1.5">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Are you sure you want to approve the claim for{" "}
                <strong className="text-foreground font-semibold">{claim.customer}</strong>?
              </p>
              <p className="text-xs text-muted-foreground">NIC: {claim.nic}</p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button
                type="button"
                onClick={() => setShowApproveConfirm(false)}
                className="rounded-md border border-input px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={approving}
                onClick={() => {
                  setShowApproveConfirm(false);
                  handleApprove();
                }}
                className="rounded-md px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {approving ? "Approving…" : "Yes, Approve"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
