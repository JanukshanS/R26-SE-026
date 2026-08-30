"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows, Environment, GizmoHelper, GizmoViewport,
  Grid, OrbitControls, useGLTF,
} from "@react-three/drei";
import * as THREE from "three";
import { DamagedCar, ReferenceCar } from "./CarModels";
import { ComparisonLines } from "./ComparisonLines";
import { GaussianSplatViewer } from "./GaussianSplatViewer";
import { useT } from "@/lib/i18n";

function GeneratedModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const { cloned, scale, position } = useMemo(() => {
    const cloned = scene.clone(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim === 0) return { cloned, scale: 1, position: [0, 0, 0] as [number, number, number] };
    const s = 4 / maxDim;
    return {
      cloned,
      scale: s,
      position: [-center.x * s, box.max.y * s, center.z * s] as [number, number, number],
    };
  }, [scene]);

  return (
    <group position={position} scale={scale}>
      <group rotation={[Math.PI, 0, 0]}>
        <primitive object={cloned} castShadow receiveShadow />
      </group>
    </group>
  );
}

function CompareScene({ glbUrl }: { glbUrl?: string }) {
  return (
    <>
      <color attach="background" args={["#e8eaed"]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 10, 5]} intensity={1.2} castShadow />
      <directionalLight position={[-6, 4, -5]} intensity={0.4} />
      {glbUrl ? (
        <GeneratedModel url={glbUrl} />
      ) : (
        <>
          <DamagedCar damaged position={[-2.2, 0, 0]} rotation={[0, 0.25, 0]} />
          <ReferenceCar position={[2.2, 0, 0]} rotation={[0, -0.25, 0]} />
          <ComparisonLines />
        </>
      )}
      <Grid position={[0, 0, 0]} infiniteGrid cellSize={0.5} sectionSize={2} fadeDistance={20} cellColor="#d1d5db" sectionColor="#9ca3af" />
      <ContactShadows position={[0, 0, 0]} opacity={0.4} scale={14} blur={2} />
      <Environment preset="city" />
      <OrbitControls enableDamping dampingFactor={0.06} minDistance={2} maxDistance={20} target={[0, 0.5, 0]} />
      <GizmoHelper alignment="top-right" margin={[56, 56]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#334155" />
      </GizmoHelper>
    </>
  );
}

type CompareViewCanvasProps = {
  glbUrl?: string;
  splatUrl?: string;
  isLoading?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  isTransitioning?: boolean;
};

function downloadFile(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

export function CompareViewCanvas({ glbUrl, splatUrl, isLoading, expanded, onToggleExpand, isTransitioning }: CompareViewCanvasProps) {
  const t = useT();
  const hasModel = !!(splatUrl || glbUrl);
  const [splatLoading, setSplatLoading] = useState(!!splatUrl);

  useEffect(() => {
    if (splatUrl) setSplatLoading(true);
  }, [splatUrl]);

  return (
    <div className="compare-view" style={{ position: "relative" }}>
      <div className="compare-view__header">
        <h3 className="compare-view__title">
          {hasModel ? t("insurer.compare.generatedTitle") : t("insurer.compare.compareTitle")}
        </h3>
        <div className="compare-view__header-actions">
          {splatUrl && (
            <button type="button" className="compare-view__download" onClick={() => downloadFile(splatUrl, "model.ply")}>
              {t("insurer.compare.downloadPly")}
            </button>
          )}
          {!splatUrl && glbUrl && (
            <button type="button" className="compare-view__download" onClick={() => downloadFile(glbUrl, "model.glb")}>
              {t("insurer.compare.downloadGlb")}
            </button>
          )}
          {onToggleExpand && !isLoading && !splatLoading && (
            <button type="button" className="compare-view__expand" onClick={onToggleExpand} title={expanded ? t("insurer.compare.collapse") : t("insurer.compare.expand")} aria-label={expanded ? t("insurer.compare.collapse") : t("insurer.compare.expand")}>
              {expanded ? "⤡" : "⤢"}
            </button>
          )}
        </div>
      </div>
      {splatUrl && splatLoading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#e8eaed", pointerEvents: "none", zIndex: 10 }}>
          <div style={{ width: 36, height: 36, border: "3px solid #d1d5db", borderTopColor: "#f97316", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{t("insurer.compare.loadingModel")}</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      <div className="compare-view__canvas-wrap">
        {splatUrl ? (
          <GaussianSplatViewer url={splatUrl} onLoadingChange={setSplatLoading} />
        ) : isTransitioning ? (
          <div className="compare-view__empty">
            <div className="compare-view__spinner" aria-label={t("insurer.action.loading")} />
          </div>
        ) : glbUrl ? (
          <Canvas shadows camera={{ position: [0, 3.5, 10], fov: 42 }} gl={{ antialias: true }}>
            <Suspense fallback={null}>
              <CompareScene glbUrl={glbUrl} />
            </Suspense>
          </Canvas>
        ) : isLoading ? (
          <div className="compare-view__empty">
            <div className="compare-view__spinner" aria-label={t("insurer.action.loading")} />
            <p>{t("insurer.compare.checking")}</p>
          </div>
        ) : (
          <div className="compare-view__empty">
            <p>{t("insurer.compare.emptyTitle")}</p>
            <p>{t("insurer.compare.emptyHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
