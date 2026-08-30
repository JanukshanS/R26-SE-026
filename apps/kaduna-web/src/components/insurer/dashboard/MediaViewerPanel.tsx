"use client";

import { useEffect, useRef, useState } from "react";
import type { AccidentImage, Claim } from "@/lib/insurer/types";
import { distanceMetres, formatDistance, distanceLevel } from "@/lib/insurer/geo";
import { useT } from "@/lib/i18n";

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
      weekday: "short", month: "short", day: "numeric",
      year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
  } catch { return iso; }
}

function formatCoords(img: AccidentImage): string {
  if (img.gps_lat != null && img.gps_lng != null) {
    return `${img.gps_lat.toFixed(5)}, ${img.gps_lng.toFixed(5)}`;
  }
  return "—";
}

const BTN = {
  width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
  background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: 4,
  cursor: "pointer", fontSize: 16, fontWeight: 600, lineHeight: 1,
} as const;

export function MediaViewerPanel({
  title, urls, loading, visible, onClose, referenceLocation,
}: MediaViewerPanelProps) {
  const t = useT();
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActiveIndex(0); }, [urls]);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [activeIndex]);
  useEffect(() => { if (zoom <= 1) setPan({ x: 0, y: 0 }); }, [zoom]);

  // imgContainerRef div is always rendered (loading state is inside it),
  // so [] deps work — the ref is set on mount.
  useEffect(() => {
    const el = imgContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(prev => Math.max(1, Math.min(8, prev * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const zoomIn  = () => setZoom(prev => Math.min(8, prev * 1.5));
  const zoomOut = () => { const next = Math.max(1, zoom / 1.5); setZoom(next); if (next <= 1) setPan({ x: 0, y: 0 }); };
  const reset   = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStart.current) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  };
  const handleMouseUp = () => { setIsDragging(false); dragStart.current = null; };

  if (!visible) return null;

  const active = urls[activeIndex];
  const activeUrl = active?.url ?? "";
  const activeIsVideo = isVideo(activeUrl);
  const hasThumbs = urls.length > 1;

  return (
    <div
      className="absolute inset-0 z-20 rounded-xl border border-border bg-card flex flex-col"
      role="dialog"
      aria-label={title}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button type="button" onClick={onClose} aria-label={t("insurer.action.close")}
          className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div className="w-1/3 shrink-0 border-r border-border px-4 py-5 flex flex-col gap-3 overflow-y-auto">
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">{t("insurer.media.photoLocation")}</p>
          {active && active.gps_lat != null && active.gps_lng != null ? (
            <a href={`https://www.google.com/maps?q=${active.gps_lat},${active.gps_lng}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 self-start px-2 py-0.5 border-2 border-primary rounded text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
              {formatCoords(active)}<span aria-hidden>↗</span>
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
            const dist = distanceMetres(ref.gps_lat, ref.gps_lng, active.gps_lat, active.gps_lng);
            const level = distanceLevel(dist);
            const tone = level === "ok" ? "bg-emerald-100 text-emerald-800"
              : level === "warn" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
            return (
              <span className={`inline-flex items-center gap-1 self-start px-2.5 py-1 rounded text-xs font-semibold ${tone}`}>
                {level === "ok"
                  ? t("insurer.media.locationMatched")
                  : t("insurer.media.locationOff", { distance: formatDistance(dist) })}
              </span>
            );
          })()}

          <hr className="border-border" />
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">{t("insurer.media.photoTimestamp")}</p>
          <p className="text-sm text-muted-foreground">{active ? formatCapturedAt(active.captured_at) : "—"}</p>

          {zoom > 1 && !activeIsVideo && (
            <>
              <hr className="border-border" />
              <div className="flex items-center justify-between">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  {t("insurer.media.zoom", { level: zoom.toFixed(1) })}
                </p>
                <button type="button" onClick={reset} className="text-[0.68rem] text-primary hover:underline">{t("insurer.media.reset")}</button>
              </div>
            </>
          )}
        </div>

        {/* Media area */}
        <div className="flex flex-1 flex-col min-w-0 relative">
          {/* Container always rendered so wheel listener attaches on mount */}
          <div
            ref={imgContainerRef}
            className="flex-1 min-h-0 flex items-center justify-center bg-muted overflow-hidden"
            style={{ cursor: !activeIsVideo && zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default" }}
            onMouseDown={!activeIsVideo ? handleMouseDown : undefined}
            onMouseMove={!activeIsVideo ? handleMouseMove : undefined}
            onMouseUp={!activeIsVideo ? handleMouseUp : undefined}
            onMouseLeave={!activeIsVideo ? handleMouseUp : undefined}
            onDoubleClick={!activeIsVideo ? reset : undefined}
          >
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("insurer.media.loading")}</p>
            ) : urls.length > 0 ? (
              activeIsVideo ? (
                <video key={activeUrl} src={activeUrl} controls className="max-w-full max-h-full" />
              ) : (
                <img
                  src={activeUrl}
                  alt={t("insurer.media.itemAlt", { title, number: activeIndex + 1 })}
                  draggable={false}
                  className="max-w-full max-h-full object-contain rounded border border-border select-none"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "center",
                    transition: isDragging ? "none" : "transform 0.15s ease",
                  }}
                />
              )
            ) : (
              <p className="text-sm text-muted-foreground">{t("insurer.media.empty")}</p>
            )}
          </div>

          {/* Zoom controls — images only */}
          {!loading && urls.length > 0 && !activeIsVideo && (
            <div style={{
              position: "absolute", right: 10,
              bottom: hasThumbs ? 86 : 10,
              display: "flex", flexDirection: "column", gap: 3, zIndex: 5,
            }}>
              <button type="button" style={BTN} onClick={zoomIn} title={t("insurer.media.zoomIn")}>+</button>
              <button type="button" style={BTN} onClick={zoomOut} title={t("insurer.media.zoomOut")}>−</button>
              {zoom > 1 && (
                <button type="button" style={{ ...BTN, fontSize: 13 }} onClick={reset} title={t("insurer.media.resetZoom")}>↺</button>
              )}
            </div>
          )}

          {/* Hint */}
          {!loading && urls.length > 0 && !activeIsVideo && zoom === 1 && (
            <p className="text-center text-[0.65rem] text-muted-foreground py-1 shrink-0">
              {t("insurer.media.hint")}
            </p>
          )}

          {/* Thumbnails */}
          {hasThumbs && (
            <div className="flex gap-2 px-4 py-3 border-t border-border overflow-x-auto shrink-0">
              {urls.map((img, i) => (
                <button key={img.url} type="button" onClick={() => setActiveIndex(i)}
                  className={`shrink-0 p-0.5 rounded border-2 transition-colors ${i === activeIndex ? "border-primary" : "border-transparent"}`}>
                  {isVideo(img.url) ? (
                    <span className="flex items-center justify-center w-[72px] h-[54px] text-2xl">▶</span>
                  ) : (
                    <img src={img.url} alt="" className="w-[72px] h-[54px] object-cover rounded block" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
