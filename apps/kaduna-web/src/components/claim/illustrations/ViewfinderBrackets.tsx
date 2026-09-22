/** Corner-bracket viewfinder overlay — ported 1:1 (same paths) from
 * apps/mobile/features/guided-capture/components/guidance-boundary.tsx.
 * Purely decorative framing (no real object detection); the brackets just
 * recolor with the current tilt-alignment state. */
export type TiltAlignState = "aligning" | "almost" | "steady";

const FRAME_COLOR: Record<TiltAlignState, string> = {
  aligning: "rgba(255, 255, 255, 0.92)",
  almost: "#f97316",
  steady: "rgba(0, 219, 126, 0.9)",
};

const S = 45; // corner size
const T = 7; // corner thickness
const R = 8; // corner radius

const CORNER_PATH = {
  TL: `M 0 ${S} L 0 ${R} A ${R} ${R} 0 0 1 ${R} 0 L ${S} 0`,
  TR: `M ${S} ${S} L ${S} ${R} A ${R} ${R} 0 0 0 ${S - R} 0 L 0 0`,
  BL: `M 0 0 L 0 ${S - R} A ${R} ${R} 0 0 0 ${R} ${S} L ${S} ${S}`,
  BR: `M ${S} 0 L ${S} ${S - R} A ${R} ${R} 0 0 1 ${S - R} ${S} L 0 ${S}`,
} as const;

const CORNER_POSITION: Record<keyof typeof CORNER_PATH, string> = {
  TL: "top-0 left-0",
  TR: "top-0 right-0",
  BL: "bottom-0 left-0",
  BR: "bottom-0 right-0",
};

function CornerBracket({ corner, color }: { corner: keyof typeof CORNER_PATH; color: string }) {
  return (
    <svg width={S} height={S} className={`absolute ${CORNER_POSITION[corner]}`}>
      <path d={CORNER_PATH[corner]} stroke={color} strokeWidth={T} fill="none" />
    </svg>
  );
}

export function ViewfinderBrackets({ state }: { state: TiltAlignState }) {
  const color = FRAME_COLOR[state];
  return (
    <div className="pointer-events-none absolute inset-3">
      <CornerBracket corner="TL" color={color} />
      <CornerBracket corner="TR" color={color} />
      <CornerBracket corner="BL" color={color} />
      <CornerBracket corner="BR" color={color} />
    </div>
  );
}
