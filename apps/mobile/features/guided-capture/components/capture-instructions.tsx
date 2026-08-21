import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

const ORANGE = '#f97316';
const TEXT = '#111111';

// ── Stop-arc diagram ─────────────────────────────────────────────────────
// Partial coverage, not a full 360° loop: testing confirmed good 3D model
// quality with ~1/4–1/3 of the car covered (~12 stops, ~10-14° apart). Shown
// as a 3-slide carousel (front-right corner / side / rear corner) so it's
// clear this pattern applies to any side of the car, not one fixed start.
const ARC_SIZE_W = 320;
// Taller than a single corner-wrap needs, so the rear-corner variant (whose
// arc dips further below the car) fits without clipping — grown uniformly
// so all 3 slides share one canvas size and nothing shifts when swiping.
const ARC_SIZE_H = 330;
const CENTER_X = ARC_SIZE_W / 2;
// Recentered vertically (was 205 when there was only a front-corner wrap) so
// there's equal headroom above and below for the front- and rear-corner
// variants' arcs, which curve in opposite directions.
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

// "front"/"rear" are points on a circle (wrapping a corner) — unchanged.
// "side" is a literal straight line parallel to the car, with its own fewer
// dot count: 12 non-overlapping dots on a line needs more vertical room than
// this canvas has, so it uses 8 instead rather than touching the other slides.
type ArcVariant =
  | {
      key: string;
      kind: 'arc';
      circleCenter: { x: number; y: number };
      radius: number;
      startDeg: number;
      endDeg: number;
      dotCount: number;
    }
  | {
      key: string;
      kind: 'line';
      from: { x: number; y: number };
      to: { x: number; y: number };
      dotCount: number;
    };

const ARC_VARIANTS: ArcVariant[] = [
  {
    key: 'front',
    kind: 'arc',
    circleCenter: { x: CENTER_X, y: CAR_CENTER_Y - 15 },
    radius: ARC_RADIUS,
    startDeg: 140,
    endDeg: 0,
    dotCount: ARC_DOT_COUNT,
  },
  {
    key: 'side',
    kind: 'line',
    from: { x: 290, y: CAR_CENTER_Y - 77 },
    to: { x: 290, y: CAR_CENTER_Y + 77 },
    dotCount: 8,
  },
  {
    key: 'rear',
    kind: 'arc',
    circleCenter: { x: CENTER_X, y: CAR_CENTER_Y + 15 },
    radius: ARC_RADIUS,
    startDeg: -140,
    endDeg: 0,
    dotCount: ARC_DOT_COUNT,
  },
];

/** Simplified top-down car outline — same shape language as the live capture
 * screen's own arc diagram (orbit-progress.tsx's CarIcon), scaled up here
 * since this is the static hero illustration on this screen. */
function CarIcon() {
  return (
    <>
      <Rect
        x={CENTER_X - 30}
        y={CAR_CENTER_Y - 65}
        width={60}
        height={130}
        rx={22}
        fill="#ffffff"
        stroke={TEXT}
        strokeWidth={2.5}
      />
      <Rect
        x={CENTER_X - 19}
        y={CAR_CENTER_Y - 39}
        width={38}
        height={26}
        rx={8}
        fill="none"
        stroke={TEXT}
        strokeWidth={2}
      />
      <Rect
        x={CENTER_X - 19}
        y={CAR_CENTER_Y + 16}
        width={38}
        height={21}
        rx={8}
        fill="none"
        stroke={TEXT}
        strokeWidth={2}
      />
      <Line
        x1={CENTER_X}
        y1={CAR_CENTER_Y - 36}
        x2={CENTER_X}
        y2={CAR_CENTER_Y + 34}
        stroke={TEXT}
        strokeWidth={1.5}
      />
      {/* Four wheels, straddling the body edges near the windshield/rear-window
       * height — inset from the bumpers, matching real wheel position. */}
      <Rect x={CENTER_X - 34.5} y={CAR_CENTER_Y - 52} width={9} height={20} rx={3} fill={TEXT} />
      <Rect x={CENTER_X + 25.5} y={CAR_CENTER_Y - 52} width={9} height={20} rx={3} fill={TEXT} />
      <Rect x={CENTER_X - 34.5} y={CAR_CENTER_Y + 32} width={9} height={20} rx={3} fill={TEXT} />
      <Rect x={CENTER_X + 25.5} y={CAR_CENTER_Y + 32} width={9} height={20} rx={3} fill={TEXT} />
    </>
  );
}

function ArcDiagram({ variant }: { variant: ArcVariant }) {
  let dots: { x: number; y: number }[];
  let connectingPathD: string;
  let nearestDot: { x: number; y: number };

  if (variant.kind === 'arc') {
    const { circleCenter, radius, startDeg, endDeg, dotCount } = variant;
    dots = Array.from({ length: dotCount }, (_, i) =>
      arcPoint(circleCenter, radius, startDeg + ((endDeg - startDeg) * i) / (dotCount - 1))
    );
    const arcStart = arcPoint(circleCenter, radius, startDeg);
    const arcEnd = arcPoint(circleCenter, radius, endDeg);
    const sweepFlag = endDeg < startDeg ? 1 : 0;
    connectingPathD = `M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 0 ${sweepFlag} ${arcEnd.x} ${arcEnd.y}`;
    // Measure to the actual nearest dot (the last one — closest to the car's
    // side by construction of these angles), not across the car's own width —
    // this is the real stand-back distance for a capture position.
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
    <Svg width={ARC_SIZE_W} height={ARC_SIZE_H}>
      <Path d={connectingPathD} stroke={ORANGE} strokeOpacity={0.3} strokeWidth={2} fill="none" />

      <CarIcon />

      {dots.map((p, i) =>
        i === 0 ? (
          <Circle key={i} cx={p.x} cy={p.y} r={9} fill="#ffffff" stroke={ORANGE} strokeWidth={3} />
        ) : (
          <Circle key={i} cx={p.x} cy={p.y} r={9} fill={ORANGE} />
        )
      )}
      <SvgText x={dots[0]!.x} y={dots[0]!.y - 16} fontSize={12} fontWeight="700" fill={ORANGE} textAnchor="middle">
        Start
      </SvgText>

      <Line x1={twoMStart.x} y1={twoMStart.y} x2={twoMEnd.x} y2={twoMEnd.y} stroke={ORANGE} strokeWidth={1.5} />
      <Path
        d={`M ${twoMStart.x} ${twoMStart.y} l 7 -4 M ${twoMStart.x} ${twoMStart.y} l 7 4`}
        stroke={ORANGE}
        strokeWidth={1.5}
        fill="none"
      />
      <Path
        d={`M ${twoMEnd.x} ${twoMEnd.y} l -7 -4 M ${twoMEnd.x} ${twoMEnd.y} l -7 4`}
        stroke={ORANGE}
        strokeWidth={1.5}
        fill="none"
      />
      <SvgText
        x={(twoMStart.x + twoMEnd.x) / 2}
        y={nearestDot.y - 8}
        fontSize={13}
        fontWeight="700"
        fill={ORANGE}
        textAnchor="middle">
        2m
      </SvgText>
    </Svg>
  );
}

/** Horizontally swipeable 3-slide carousel of ArcDiagram variants (front-right
 * corner / side / rear corner) — same component, different geometry per slide,
 * so it reads as "this pattern applies to any side," not one fixed start point.
 * FlatList + pagingEnabled rather than a carousel dependency — none was already
 * installed, and paging is all this needs. Item width is measured via onLayout
 * rather than assumed from screen width, so it's correct regardless of the
 * imageCard's own padding. */
function ArcCarousel() {
  const [itemWidth, setItemWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setItemWidth(e.nativeEvent.layout.width);
  }, []);

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!itemWidth) return;
      const index = Math.round(e.nativeEvent.contentOffset.x / itemWidth);
      setActiveIndex(Math.max(0, Math.min(index, ARC_VARIANTS.length - 1)));
    },
    [itemWidth]
  );

  return (
    <View>
      <View onLayout={onLayout} style={styles.carouselMeasure}>
        {itemWidth > 0 ? (
          <FlatList
            data={ARC_VARIANTS}
            keyExtractor={(item) => item.key}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumScrollEnd}
            renderItem={({ item }) => (
              <View style={{ width: itemWidth, alignItems: 'center' }}>
                <ArcDiagram variant={item} />
              </View>
            )}
          />
        ) : null}
      </View>
      <View style={styles.paginationRow}>
        {ARC_VARIANTS.map((v, i) => (
          <View key={v.key} style={[styles.paginationDot, i === activeIndex && styles.paginationDotActive]} />
        ))}
      </View>
    </View>
  );
}

// ── 3-step in-stop sequence icons ────────────────────────────────────────
// Solid filled silhouette (not an outlined stick figure) with a posed arm —
// the arm's elbow/hand position is what actually differentiates each step;
// the dashed height marker lines up with the hand so the pose and the
// reference line reinforce each other instead of the marker looking bolted
// on. Adapted from reference photos of a person holding a phone
// overhead/at chest/at waist height, not traced directly.
const STEP_ICON_W = 64;
const STEP_ICON_H = 82;

type ArmPose = 'overhead' | 'chest' | 'waist';

// Torso+legs as one filled shape (tapered torso, visible sloped shoulders, two
// separated legs with rounded feet) — shared across all 3 poses, only the arm
// changes. The head circle (cx 32, cy 16, r 8) overlaps its top edge slightly
// so there's no visible gap at the neck.
const TORSO_PATH =
  'M 20 25 L 44 25 L 38 52 L 41 52 L 41 78 ' +
  'Q 41 81 38 81 L 34.5 81 L 34.5 55 L 29.5 55 L 29.5 81 ' +
  'L 26 81 Q 23 81 23 78 L 23 52 L 26 52 Z';

// Each pose has its own shoulder anchor, not one shared point: overhead's arm
// swings clear of the body so it can start right at the natural shoulder
// point, but chest/waist's arms cross in front of the torso — starting them
// from a point well inside the torso's own fill (rather than at its edge)
// keeps the thick round-capped stroke's join fully submerged, which is what
// avoids a visible seam between the arm and torso shapes. Because of that,
// upper-arm/forearm segment lengths aren't strictly equal across poses here
// the way they are for the (separate) outlined onboarding-screen pose icons —
// for this filled-silhouette style the torso shape and stroke width carry
// the visual consistency instead, and forcing equal lengths reintroduced the
// seam. Verified at actual on-screen size before landing on these coordinates.
const ARM_POSE_POINTS: Record<
  ArmPose,
  {
    shoulder: { x: number; y: number };
    elbow: { x: number; y: number };
    hand: { x: number; y: number };
    phoneRotationDeg: number;
  }
> = {
  // Slight phone tilt matches a raised arm's natural wrist angle in the reference photo.
  overhead: {
    shoulder: { x: 39, y: 27 },
    elbow: { x: 47.0, y: 17.0 },
    hand: { x: 42.0, y: 5.0 },
    phoneRotationDeg: -22,
  },
  chest: {
    shoulder: { x: 35, y: 30 },
    elbow: { x: 49.0, y: 40.0 },
    hand: { x: 31.0, y: 37.0 },
    phoneRotationDeg: 0,
  },
  waist: {
    shoulder: { x: 35, y: 30 },
    elbow: { x: 44.0, y: 42.0 },
    hand: { x: 31.0, y: 50.0 },
    phoneRotationDeg: 0,
  },
};

const PHONE_W = 5;
const PHONE_H = 9;
// Chest/waist hold the phone at an angle where it reads flush against the
// dark arm/torso without this — the white outline is what makes it pop the
// way it already does on overhead (where it sits against open space instead).
const PHONE_OUTLINE_W = 6;
const PHONE_OUTLINE_H = 10;

// Off-hand arm, resting naturally at the figure's side — same for all 3
// poses since it's just a neutral hang, not part of what differentiates each
// step. Without this only one arm was drawn, so the figure read as having an
// armless side rather than an arm resting at rest.
const REST_ARM = {
  shoulder: { x: 20, y: 28 },
  elbow: { x: 20, y: 40 },
  hand: { x: 19, y: 51 },
};

function HeightStepIcon({ armPose, number, label }: { armPose: ArmPose; number: number; label: string }) {
  const { shoulder, elbow, hand, phoneRotationDeg } = ARM_POSE_POINTS[armPose];
  const markerY = hand.y;
  // Overhead's phone already sits against open space, clearly legible at the
  // original size. Chest/waist hold it in front of the dark arm/torso, so it
  // gets a slightly larger size plus a thin white outline to stay legible.
  const outlined = armPose !== 'overhead';
  const phoneW = outlined ? PHONE_OUTLINE_W : PHONE_W;
  const phoneH = outlined ? PHONE_OUTLINE_H : PHONE_H;
  return (
    <View style={styles.stepIconWrap}>
      <Svg width={STEP_ICON_W} height={STEP_ICON_H}>
        {/* filled torso + legs silhouette */}
        <Path d={TORSO_PATH} fill={TEXT} />

        {/* off-hand arm, resting at the side — drawn before the posed arm/phone
            so it stays underneath at the shoulder overlap */}
        <Path
          d={`M ${REST_ARM.shoulder.x} ${REST_ARM.shoulder.y} L ${REST_ARM.elbow.x} ${REST_ARM.elbow.y} L ${REST_ARM.hand.x} ${REST_ARM.hand.y}`}
          stroke={TEXT}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* filled head, overlapping the torso's shoulder line slightly */}
        <Circle cx={32} cy={16} r={8} fill={TEXT} />

        {/* posed arm as a thick round-capped/joined stroke — reads as a solid
            limb rather than a stick line; the one part that changes per step */}
        <Path
          d={`M ${shoulder.x} ${shoulder.y} L ${elbow.x} ${elbow.y} L ${hand.x} ${hand.y}`}
          stroke={TEXT}
          strokeWidth={8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* phone held at the hand — the only colored element against the silhouette */}
        <Rect
          x={hand.x - phoneW / 2}
          y={hand.y - phoneH / 2}
          width={phoneW}
          height={phoneH}
          rx={1.2}
          fill={ORANGE}
          stroke={outlined ? '#ffffff' : undefined}
          strokeWidth={outlined ? 1.2 : 0}
          rotation={phoneRotationDeg}
          origin={`${hand.x}, ${hand.y}`}
        />

        {/* height marker drawn last so it stays fully visible over the figure */}
        <Line
          x1={6}
          y1={markerY}
          x2={STEP_ICON_W - 6}
          y2={markerY}
          stroke={ORANGE}
          strokeWidth={2}
          strokeDasharray="3,3"
        />
        <Circle cx={6} cy={markerY} r={3.5} fill={ORANGE} />
      </Svg>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{number}</Text>
      </View>
      <Text style={styles.stepLabel}>{label}</Text>
    </View>
  );
}

function StepSequenceRow() {
  return (
    <View style={styles.stepRow}>
      <HeightStepIcon armPose="overhead" number={1} label="Overhead" />
      <HeightStepIcon armPose="chest" number={2} label="Chest height" />
      <HeightStepIcon armPose="waist" number={3} label="Waist height" />
    </View>
  );
}

/** Full instructional content shared between the Guided Capture intro screen
 * and the "How to Capture" overflow-menu option on the live capture screen —
 * same arc diagram + pose icons + captions in both places, so a user mid-shoot
 * can re-check the exact reference they saw before starting, not a summary of it. */
export function CaptureInstructions() {
  return (
    <>
      <View style={styles.imageCard}>
        <ArcCarousel />
      </View>

      <View style={[styles.calloutCard, styles.topCaptionSpacing]}>
        <Ionicons name="information-circle" size={20} color={ORANGE} style={styles.calloutIcon} />
        <Text style={styles.calloutText}>
          Capture along the path of the accident — start where the damage begins and continue around that
          side of the vehicle.
        </Text>
      </View>

      <StepSequenceRow />

      <View style={styles.calloutCard}>
        <Ionicons name="information-circle" size={20} color={ORANGE} style={styles.calloutIcon} />
        <Text style={styles.calloutText}>
          At each stop, take 3 photos in order — overhead, chest height, then waist height. Then move to
          the next stop and repeat.
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  imageCard: {
    backgroundColor: '#ffffff',
    borderRadius: 13,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 220,
  },
  carouselMeasure: {
    alignSelf: 'stretch',
    // Explicit height, not left to content: a horizontal FlatList nested in a
    // plain View can report zero/unreliable height to the outer ScrollView
    // even while it still paints visually, which throws off how much scroll
    // space the ScrollView thinks it needs — hiding whatever comes after it.
    height: ARC_SIZE_H,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  paginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#d9d9d9',
  },
  paginationDotActive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ORANGE,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    marginBottom: 25,
  },
  stepIconWrap: {
    alignItems: 'center',
    gap: 4,
  },
  stepBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  stepBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: TEXT,
    marginTop: 2,
    textAlign: 'center',
  },
  calloutCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFEDD5',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  calloutIcon: {
    marginTop: 1,
  },
  calloutText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: TEXT,
    fontWeight: '500',
  },
  topCaptionSpacing: {
    marginBottom: 50,
  },
});
