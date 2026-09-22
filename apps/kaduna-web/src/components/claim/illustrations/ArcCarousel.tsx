"use client";

import { useCallback, useRef, useState } from "react";

import { useT } from "@/lib/i18n";

/** Web port of apps/mobile's ArcCarousel + ArcDiagram
 * (features/guided-capture/components/capture-instructions.tsx) — same exact
 * geometry per slide (front-right corner / side / rear corner), so the "walk
 * around the car" pattern reads the same on both platforms. Mobile shows this
 * as a 3-slide carousel to make clear the pattern applies to any side of the
 * car, not one fixed start point; the web version previously only showed one
 * static diagram. */

const ORANGE = "#f97316";
const TEXT = "#111111";

const ARC_SIZE_W = 320;
const ARC_SIZE_H = 330;
const CENTER_X = ARC_SIZE_W / 2;
const CAR_CENTER_Y = 165;
const ARC_RADIUS = 135;
const ARC_DOT_COUNT = 12;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function arcPoint(
  circleCenter: { x: number; y: number },
  radius: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = degToRad(angleDeg);
  return {
    x: circleCenter.x + radius * Math.cos(rad),
    y: circleCenter.y - radius * Math.sin(rad),
  };
}

type ArcVariant =
  | {
      key: string;
      kind: "arc";
      circleCenter: { x: number; y: number };
      radius: number;
      startDeg: number;
      endDeg: number;
      dotCount: number;
    }
  | {
      key: string;
      kind: "line";
      from: { x: number; y: number };
      to: { x: number; y: number };
      dotCount: number;
    };

const ARC_VARIANTS: ArcVariant[] = [
  {
    key: "front",
    kind: "arc",
    circleCenter: { x: CENTER_X, y: CAR_CENTER_Y - 15 },
    radius: ARC_RADIUS,
    startDeg: 140,
    endDeg: 0,
    dotCount: ARC_DOT_COUNT,
  },
  {
    key: "side",
    kind: "line",
    from: { x: 290, y: CAR_CENTER_Y - 77 },
    to: { x: 290, y: CAR_CENTER_Y + 77 },
    dotCount: 8,
  },
  {
    key: "rear",
    kind: "arc",
    circleCenter: { x: CENTER_X, y: CAR_CENTER_Y + 15 },
    radius: ARC_RADIUS,
    startDeg: -140,
    endDeg: 0,
    dotCount: ARC_DOT_COUNT,
  },
];

function CarIconSvg() {
  return (
    <>
      <rect
        x={CENTER_X - 30}
        y={CAR_CENTER_Y - 65}
        width={60}
        height={130}
        rx={22}
        fill="#ffffff"
        stroke={TEXT}
        strokeWidth={2.5}
      />
      <rect
        x={CENTER_X - 19}
        y={CAR_CENTER_Y - 39}
        width={38}
        height={26}
        rx={8}
        fill="none"
        stroke={TEXT}
        strokeWidth={2}
      />
      <rect
        x={CENTER_X - 19}
        y={CAR_CENTER_Y + 16}
        width={38}
        height={21}
        rx={8}
        fill="none"
        stroke={TEXT}
        strokeWidth={2}
      />
      <line x1={CENTER_X} y1={CAR_CENTER_Y - 36} x2={CENTER_X} y2={CAR_CENTER_Y + 34} stroke={TEXT} strokeWidth={1.5} />
      <rect x={CENTER_X - 34.5} y={CAR_CENTER_Y - 52} width={9} height={20} rx={3} fill={TEXT} />
      <rect x={CENTER_X + 25.5} y={CAR_CENTER_Y - 52} width={9} height={20} rx={3} fill={TEXT} />
      <rect x={CENTER_X - 34.5} y={CAR_CENTER_Y + 32} width={9} height={20} rx={3} fill={TEXT} />
      <rect x={CENTER_X + 25.5} y={CAR_CENTER_Y + 32} width={9} height={20} rx={3} fill={TEXT} />
    </>
  );
}

function ArcDiagram({ variant }: { variant: ArcVariant }) {
  const t = useT();
  let dots: { x: number; y: number }[];
  let connectingPathD: string;
  let nearestDot: { x: number; y: number };

  if (variant.kind === "arc") {
    const { circleCenter, radius, startDeg, endDeg, dotCount } = variant;
    dots = Array.from({ length: dotCount }, (_, i) =>
      arcPoint(circleCenter, radius, startDeg + ((endDeg - startDeg) * i) / (dotCount - 1))
    );
    const arcStart = arcPoint(circleCenter, radius, startDeg);
    const arcEnd = arcPoint(circleCenter, radius, endDeg);
    const sweepFlag = endDeg < startDeg ? 1 : 0;
    connectingPathD = `M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 0 ${sweepFlag} ${arcEnd.x} ${arcEnd.y}`;
    // Measure to the actual nearest dot (the last one — closest to the car's
    // side by construction of these angles), not across the car's own width.
    nearestDot = dots[dots.length - 1]!;
  } else {
    const { from, to, dotCount } = variant;
    dots = Array.from({ length: dotCount }, (_, i) => ({
      x: from.x + ((to.x - from.x) * i) / (dotCount - 1),
      y: from.y + ((to.y - from.y) * i) / (dotCount - 1),
    }));
    connectingPathD = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    nearestDot = dots[dots.length - 1]!;
  }

  const carEdgeX = nearestDot.x >= CENTER_X ? CENTER_X + 30 : CENTER_X - 30;
  const twoMStart = { x: carEdgeX, y: nearestDot.y };
  const twoMEnd = { x: nearestDot.x, y: nearestDot.y };

  return (
    <svg width={ARC_SIZE_W} height={ARC_SIZE_H} viewBox={`0 0 ${ARC_SIZE_W} ${ARC_SIZE_H}`}>
      <path d={connectingPathD} stroke={ORANGE} strokeOpacity={0.3} strokeWidth={2} fill="none" />

      <CarIconSvg />

      {dots.map((p, i) =>
        i === 0 ? (
          <circle key={i} cx={p.x} cy={p.y} r={9} fill="#ffffff" stroke={ORANGE} strokeWidth={3} />
        ) : (
          <circle key={i} cx={p.x} cy={p.y} r={9} fill={ORANGE} />
        )
      )}
      <text x={dots[0]!.x} y={dots[0]!.y - 16} fontSize={12} fontWeight={700} fill={ORANGE} textAnchor="middle">
        {t("claim.captureIntro.diagramStart")}
      </text>

      <line x1={twoMStart.x} y1={twoMStart.y} x2={twoMEnd.x} y2={twoMEnd.y} stroke={ORANGE} strokeWidth={1.5} />
      <path
        d={`M ${twoMStart.x} ${twoMStart.y} l 7 -4 M ${twoMStart.x} ${twoMStart.y} l 7 4`}
        stroke={ORANGE}
        strokeWidth={1.5}
        fill="none"
      />
      <path
        d={`M ${twoMEnd.x} ${twoMEnd.y} l -7 -4 M ${twoMEnd.x} ${twoMEnd.y} l -7 4`}
        stroke={ORANGE}
        strokeWidth={1.5}
        fill="none"
      />
      <text
        x={(twoMStart.x + twoMEnd.x) / 2}
        y={nearestDot.y - 8}
        fontSize={13}
        fontWeight={700}
        fill={ORANGE}
        textAnchor="middle"
      >
        {t("claim.captureIntro.diagramDistance")}
      </text>
    </svg>
  );
}

/** Horizontally swipeable 3-slide carousel (front-right corner / side / rear
 * corner) — CSS scroll-snap instead of a carousel library or FlatList paging,
 * since the browser already does native swipe/paging for free. */
export function ArcCarousel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !el.clientWidth) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(Math.max(0, Math.min(index, ARC_VARIANTS.length - 1)));
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ARC_VARIANTS.map((v) => (
          <div key={v.key} className="flex w-full shrink-0 snap-center justify-center">
            <ArcDiagram variant={v} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1.5">
        {ARC_VARIANTS.map((v, i) => (
          <span
            key={v.key}
            className={`rounded-full transition-all ${
              i === activeIndex ? "h-2 w-2 bg-[#f97316]" : "h-1.5 w-1.5 bg-[#d9d9d9]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
