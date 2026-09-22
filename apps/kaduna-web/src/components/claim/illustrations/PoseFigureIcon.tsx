/** Filled-silhouette pose icon (overhead/chest/waist) — ported 1:1 from
 * apps/mobile/features/guided-capture/components/capture-instructions.tsx's
 * HeightStepIcon (same TORSO_PATH, arm joint coordinates, phone dimensions). */
import type { HeightStep } from "@/lib/claimFlow/types";

const ORANGE = "#f97316";
const TEXT = "#111111";
const ICON_W = 64;
const ICON_H = 82;

const TORSO_PATH =
  "M 20 25 L 44 25 L 38 52 L 41 52 L 41 78 " +
  "Q 41 81 38 81 L 34.5 81 L 34.5 55 L 29.5 55 L 29.5 81 " +
  "L 26 81 Q 23 81 23 78 L 23 52 L 26 52 Z";

const ARM_POSE_POINTS: Record<
  HeightStep,
  { shoulder: { x: number; y: number }; elbow: { x: number; y: number }; hand: { x: number; y: number }; phoneRotationDeg: number }
> = {
  overhead: { shoulder: { x: 39, y: 27 }, elbow: { x: 47, y: 17 }, hand: { x: 42, y: 5 }, phoneRotationDeg: -22 },
  chest: { shoulder: { x: 35, y: 30 }, elbow: { x: 49, y: 40 }, hand: { x: 31, y: 37 }, phoneRotationDeg: 0 },
  waist: { shoulder: { x: 35, y: 30 }, elbow: { x: 44, y: 42 }, hand: { x: 31, y: 50 }, phoneRotationDeg: 0 },
};

const REST_ARM = { shoulder: { x: 20, y: 28 }, elbow: { x: 20, y: 40 }, hand: { x: 19, y: 51 } };

const PHONE_W = 5;
const PHONE_H = 9;
const PHONE_OUTLINE_W = 6;
const PHONE_OUTLINE_H = 10;

export function PoseFigureIcon({ armPose, number, label }: { armPose: HeightStep; number: number; label: string }) {
  const { shoulder, elbow, hand, phoneRotationDeg } = ARM_POSE_POINTS[armPose];
  const markerY = hand.y;
  const outlined = armPose !== "overhead";
  const phoneW = outlined ? PHONE_OUTLINE_W : PHONE_W;
  const phoneH = outlined ? PHONE_OUTLINE_H : PHONE_H;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={ICON_W} height={ICON_H} viewBox={`0 0 ${ICON_W} ${ICON_H}`}>
        <path d={TORSO_PATH} fill={TEXT} />
        <path
          d={`M ${REST_ARM.shoulder.x} ${REST_ARM.shoulder.y} L ${REST_ARM.elbow.x} ${REST_ARM.elbow.y} L ${REST_ARM.hand.x} ${REST_ARM.hand.y}`}
          stroke={TEXT}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx={32} cy={16} r={8} fill={TEXT} />
        <path
          d={`M ${shoulder.x} ${shoulder.y} L ${elbow.x} ${elbow.y} L ${hand.x} ${hand.y}`}
          stroke={TEXT}
          strokeWidth={8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect
          x={hand.x - phoneW / 2}
          y={hand.y - phoneH / 2}
          width={phoneW}
          height={phoneH}
          rx={1.2}
          fill={ORANGE}
          stroke={outlined ? "#ffffff" : undefined}
          strokeWidth={outlined ? 1.2 : 0}
          transform={`rotate(${phoneRotationDeg} ${hand.x} ${hand.y})`}
        />
        <line x1={6} y1={markerY} x2={ICON_W - 6} y2={markerY} stroke={ORANGE} strokeWidth={2} strokeDasharray="3,3" />
        <circle cx={6} cy={markerY} r={3.5} fill={ORANGE} />
      </svg>
      <div className="mt-1 flex size-5 items-center justify-center rounded-full bg-[#f97316] text-xs font-bold text-white">
        {number}
      </div>
      <span className="text-center text-xs font-semibold text-[#111111]">{label}</span>
    </div>
  );
}
