/** Top-down car outline — ported 1:1 (same coordinates) from
 * apps/mobile/features/guided-capture/components/capture-instructions.tsx's
 * CarIcon / orbit-progress.tsx's CarIcon. `centerX`/`centerY` let callers
 * place it inside their own SVG canvas at whatever size that canvas uses. */
export function CarIcon({
  centerX,
  centerY,
  lineColor = "#111111",
}: {
  centerX: number;
  centerY: number;
  lineColor?: string;
}) {
  return (
    <>
      <rect
        x={centerX - 30}
        y={centerY - 65}
        width={60}
        height={130}
        rx={22}
        fill="#ffffff"
        stroke={lineColor}
        strokeWidth={2.5}
      />
      <rect
        x={centerX - 19}
        y={centerY - 39}
        width={38}
        height={26}
        rx={8}
        fill="none"
        stroke={lineColor}
        strokeWidth={2}
      />
      <rect
        x={centerX - 19}
        y={centerY + 16}
        width={38}
        height={21}
        rx={8}
        fill="none"
        stroke={lineColor}
        strokeWidth={2}
      />
      <line x1={centerX} y1={centerY - 36} x2={centerX} y2={centerY + 34} stroke={lineColor} strokeWidth={1.5} />
      <rect x={centerX - 34.5} y={centerY - 52} width={9} height={20} rx={3} fill={lineColor} />
      <rect x={centerX + 25.5} y={centerY - 52} width={9} height={20} rx={3} fill={lineColor} />
      <rect x={centerX - 34.5} y={centerY + 32} width={9} height={20} rx={3} fill={lineColor} />
      <rect x={centerX + 25.5} y={centerY + 32} width={9} height={20} rx={3} fill={lineColor} />
    </>
  );
}
