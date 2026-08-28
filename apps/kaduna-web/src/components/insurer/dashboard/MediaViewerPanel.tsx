"use client";

import { useEffect, useState } from "react";
import type { AccidentImage, Claim } from "@/lib/insurer/types";
import { distanceMetres, formatDistance, distanceLevel } from "@/lib/insurer/geo";

type ReferenceLocation = { gps_lat: number | null; gps_lng: number | null };

type MediaViewerPanelProps = {
  title: string;
  urls: AccidentImage[];
  loading?: boolean;
  visible: boolean;
  onClose: () => void;
  claim: Claim;
  referenceLocation?: ReferenceLocation | null;
};

function isVideo(url: string): boolean {
  const path = url.split("?")[0];
  return /\.(mp4|mov|webm|avi|mkv)$/i.test(path);
}

function formatCapturedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

function formatCoords(img: AccidentImage): string {
  if (img.gps_lat != null && img.gps_lng != null) {
    return `${img.gps_lat.toFixed(5)}, ${img.gps_lng.toFixed(5)}`;
  }
  return "—";
}

export function MediaViewerPanel({
  title,
  urls,
  loading,
  visible,
  onClose,
  referenceLocation,
}: MediaViewerPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [urls]);

  if (!visible) return null;

  const active = urls[activeIndex];
  const activeUrl = active?.url ?? "";

  return (
    <div
      className="absolute inset-0 z-20 rounded-xl border border-border bg-card flex flex-col"
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground text-xl leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Loading images…
          </div>
        ) : (
          <>
            <div className="w-1/3 shrink-0 border-r border-border px-4 py-5 flex flex-col gap-3 overflow-y-auto">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Photo Location
              </p>
              {active && active.gps_lat != null && active.gps_lng != null ? (
                <a
                  href={`https://www.google.com/maps?q=${active.gps_lat},${active.gps_lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 self-start px-2 py-0.5 border-2 border-primary rounded text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {formatCoords(active)}
                  <span aria-hidden>↗</span>
                </a>
              ) : (
                <p className="text-sm font-semibold text-foreground leading-relaxed">
                  {active ? formatCoords(active) : "—"}
                </p>
              )}

              {(() => {
                if (!active || active.gps_lat == null || active.gps_lng == null) return null;
                const ref = referenceLocation;
                if (!ref || ref.gps_lat == null || ref.gps_lng == null) return null;
                const dist = distanceMetres(
                  ref.gps_lat,
                  ref.gps_lng,
                  active.gps_lat,
                  active.gps_lng
                );
                const level = distanceLevel(dist);
                const icon = level === "ok" ? "✓" : "⚠";
                const label =
                  level === "ok"
                    ? "Location Matched"
                    : `${formatDistance(dist)} from accident site`;
                const tone =
                  level === "ok"
                    ? "bg-emerald-100 text-emerald-800"
                    : level === "warn"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-red-100 text-red-800";
                return (
                  <span
                    className={`inline-flex items-center gap-1 self-start px-2.5 py-1 rounded text-xs font-semibold ${tone}`}
                  >
                    {icon} {label}
                  </span>
                );
              })()}

              <hr className="border-border" />

              <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Photo Timestamp
              </p>
              <p className="text-sm text-muted-foreground">
                {active ? formatCapturedAt(active.captured_at) : "—"}
              </p>
            </div>

            <div className="flex flex-1 flex-col min-w-0">
              <div className="flex-1 min-h-0 p-3 flex items-center justify-center bg-muted">
                {urls.length > 0 ? (
                  isVideo(activeUrl) ? (
                    <video
                      key={activeUrl}
                      src={activeUrl}
                      controls
                      className="max-w-full max-h-full"
                    />
                  ) : (
                    <img
                      src={activeUrl}
                      alt={`${title} — item ${activeIndex + 1}`}
                      className="max-w-full max-h-full object-contain rounded border border-border"
                    />
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">No media available</p>
                )}
              </div>
              {urls.length > 1 && (
                <div className="flex gap-2 px-4 py-3 border-t border-border overflow-x-auto shrink-0">
                  {urls.map((img, i) => (
                    <button
                      key={img.url}
                      type="button"
                      onClick={() => setActiveIndex(i)}
                      className={`shrink-0 p-0.5 rounded border-2 transition-colors ${
                        i === activeIndex ? "border-primary" : "border-transparent"
                      }`}
                    >
                      {isVideo(img.url) ? (
                        <span className="flex items-center justify-center w-[72px] h-[54px] text-2xl">
                          ▶
                        </span>
                      ) : (
                        <img
                          src={img.url}
                          alt=""
                          className="w-[72px] h-[54px] object-cover rounded block"
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
