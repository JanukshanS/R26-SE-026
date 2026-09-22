import { CarIcon } from "./CarIcon";

/** Static "walk to the next stop" diagram — ported from apps/mobile's
 * orbit-progress.tsx (same car icon + arc-of-dots geometry), but without the
 * gyro-driven live marker: sensor-tracked walk progress was deliberately
 * dropped from the web flow (unreliable across devices/browsers), so this is
 * just an illustration of where "next" is, paired with a manual button. */
const SIZE = 300;
const CENTER_X = SIZE / 2;
const CENTER_Y = SIZE * 0.66;
const RADIUS = SIZE * 0.42;

const DOT_DONE = "#f97316";
const DOT_TARGET = "rgba(0, 219, 126, 0.9)";
const DOT_UPCOMING = "rgba(17, 17, 17, 0.25)";
const CAR_LINE = "#333333";

function angleForIndex(i: number, stopCount: number): number {
  if (stopCount <= 1) return Math.PI / 2;
  return Math.PI - (Math.PI * i) / (stopCount - 1);
}

function pointForAngle(angle: number): { x: number; y: number } {
  return { x: CENTER_X + RADIUS * Math.cos(angle), y: CENTER_Y - RADIUS * Math.sin(angle) };
}

export function OrbitDiagram({ stopCount, targetStopIndex }: { stopCount: number; targetStopIndex: number }) {
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <CarIcon centerX={CENTER_X} centerY={CENTER_Y} lineColor={CAR_LINE} />
      {Array.from({ length: stopCount }, (_, i) => {
        const { x, y } = pointForAngle(angleForIndex(i, stopCount));
        const isDone = i < targetStopIndex;
        const isTarget = i === targetStopIndex;
        const r = isTarget ? 10 : 7;
        const fill = isDone ? DOT_DONE : isTarget ? DOT_TARGET : "#ffffff";
        const stroke = isDone || isTarget ? fill : DOT_UPCOMING;
        return <circle key={i} cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={2} />;
      })}
    </svg>
  );
}
