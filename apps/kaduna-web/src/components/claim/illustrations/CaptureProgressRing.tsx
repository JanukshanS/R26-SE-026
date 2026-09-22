/** Small circular progress ring — ported 1:1 (same math) from
 * apps/mobile/features/guided-capture/components/progress-ring.tsx. Orange
 * while in progress, the same green as "aligned" once complete. */
const TRACK_COLOR = "rgba(255, 255, 255, 0.28)";
const ACTIVE_COLOR = "#f97316";
const COMPLETE_COLOR = "#00db7e";

export function CaptureProgressRing({ current, total, size = 46 }: { current: number; total: number; size?: number }) {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? Math.min(current / total, 1) : 0;
  const dashOffset = circumference * (1 - progress);
  const complete = total > 0 && current >= total;
  const activeColor = complete ? COMPLETE_COLOR : ACTIVE_COLOR;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke={TRACK_COLOR} strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={activeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold" style={{ color: activeColor }}>
          {current}/{total}
        </span>
      </div>
    </div>
  );
}
