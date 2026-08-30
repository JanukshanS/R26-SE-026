"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type GaussianSplatViewerProps = {
  url: string;
  onLoadingChange?: (loading: boolean) => void;
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

export function GaussianSplatViewer({ url, onLoadingChange }: GaussianSplatViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // useLayoutEffectt cleanup runs BEFORE React removes DOM nodes.
  // stop() cancels the rAF loop synchronously so it never fires on a detached
  // container. dispose() is deferred — calling it while addSplatScene() is still
  // running internally causes the "removeChild" crash; deferring lets the library
  // finish its current microtask before we tear down its DOM elements.
  useLayoutEffect(() => {
    return () => {
      const v = viewerRef.current;
      viewerRef.current = null;
      if (v) {
        try { v.stop?.(); } catch {}
        setTimeout(() => { try { v.dispose?.(); } catch {} }, 0);
      }
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !url) return;
    onLoadingChange?.(true);
    setError(null);

    let cancelled = false;

    async function init() {
      const GS3D = await import("@mkkellogg/gaussian-splats-3d");
      if (cancelled || !containerRef.current) return;

      const key = stableKey(url);
      let buffer = splatCache.get(key);
      if (!buffer) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch model (HTTP ${res.status})`);
        buffer = await res.arrayBuffer();
        splatCache.set(key, buffer);
      }

      if (cancelled) return;

      // Stop any previous viewer before creating a new one (url change)
      if (viewerRef.current) {
        try { viewerRef.current.stop?.(); viewerRef.current.dispose?.(); } catch {}
        viewerRef.current = null;
      }

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
        onLoadingChange?.(false);
        viewer.start();
      }
    }

    init().catch((err: unknown) => {
      if (!cancelled) {
        console.error("GaussianSplatViewer:", err);
        setError(String(err));
        onLoadingChange?.(false);
      }
    });

    return () => {
      cancelled = true;
      // Stop viewer on url change (container still in DOM — safe to call here).
      // On unmount the useLayoutEffect above handles this before DOM detach.
      if (viewerRef.current) {
        try { viewerRef.current.stop?.(); viewerRef.current.dispose?.(); } catch {}
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
      {error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }}>
          <span style={{ fontSize: "0.85rem", color: "#ef4444", fontWeight: 500 }}>Failed to render 3D model</span>
          <span style={{ fontSize: "0.72rem", color: "#9ca3af", textAlign: "center", maxWidth: 320 }}>{error}</span>
        </div>
      )}
    </div>
  );
}
