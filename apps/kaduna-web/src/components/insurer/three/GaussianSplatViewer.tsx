"use client";

import { useEffect, useRef, useState } from "react";

type GaussianSplatViewerProps = {
  url: string;
};

// Session-level cache: stable file path → ArrayBuffer
// Key strips query params so re-generated signed URLs for the same file still hit the cache.
const splatCache = new Map<string, ArrayBuffer>();

function stableKey(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0];
  }
}

export function GaussianSplatViewer({ url }: GaussianSplatViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !url) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function init() {
      const GS3D = await import("@mkkellogg/gaussian-splats-3d");
      if (cancelled || !containerRef.current) return;

      // Use cached buffer or fetch and cache it
      const key = stableKey(url);
      let buffer = splatCache.get(key);
      if (!buffer) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch model (HTTP ${res.status})`);
        buffer = await res.arrayBuffer();
        splatCache.set(key, buffer);
      }

      if (cancelled) return;

      // Create a short-lived blob URL from the cached buffer
      const blob = new Blob([buffer], { type: "application/octet-stream" });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;

      const container = containerRef.current!;
      const viewer = new GS3D.Viewer({
        rootElement: container,
        cameraUp: [0, 0, 1],
        initialCameraPosition: [0, -5, 3],
        initialCameraLookAt: [0, 0, 0],
        selfDrivenMode: true,
        useBuiltInControls: true,
        halfPrecisionCovariancesOnGPU: false,
        gpuAcceleratedSort: false,
        sharedMemoryForWorkers: false,
      });
      viewerRef.current = viewer;

      await viewer.addSplatScene(blobUrl, {
        splatAlphaRemovalThreshold: 5,
        showLoadingUI: false,
        format: GS3D.SceneFormat.Ply,
      });

      if (!cancelled) {
        setLoading(false);
        viewer.start();
      }
    }

    init().catch((err: unknown) => {
      if (!cancelled) {
        console.error("GaussianSplatViewer:", err);
        setError(String(err));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        viewerRef.current.stop?.();
        viewerRef.current.dispose?.();
        viewerRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [url]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: "#e8eaed" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, pointerEvents: "none" }}>
          <div style={{ width: 36, height: 36, border: "3px solid #d1d5db", borderTopColor: "#f97316", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>Loading 3D model…</span>
        </div>
      )}
      {error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }}>
          <span style={{ fontSize: "0.85rem", color: "#ef4444", fontWeight: 500 }}>Failed to render 3D model</span>
          <span style={{ fontSize: "0.72rem", color: "#9ca3af", textAlign: "center", maxWidth: 320 }}>{error}</span>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
