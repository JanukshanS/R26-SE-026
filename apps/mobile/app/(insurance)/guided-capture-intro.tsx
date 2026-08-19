import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { DEFAULT_STOP_COUNT } from '@/features/guided-capture/constants';
import { loadGuidedCaptureStoreState } from '@/features/guided-capture/storage/guided-capture-store';
import { HEIGHT_STEPS } from '@/features/guided-capture/types';

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
// Standing silhouette (head, tapered torso, legs) with a posed arm — the arm's
// elbow/hand position is what actually differentiates each step; the dashed
// height marker lines up with the hand so the pose and the reference line
// reinforce each other instead of the marker looking bolted on.
const STEP_ICON_W = 64;
const STEP_ICON_H = 82;
const STEP_ICON_CX = STEP_ICON_W / 2;
const SHOULDER = { x: 40, y: 29 };

type ArmPose = 'overhead' | 'chest' | 'waist';

// Elbow pokes outward before the forearm bends back in toward the body — the
// standard legible convention for "arm bent, hand held in front of the body"
// at small scale. Upper-arm (~13) and forearm (~16-18) segment lengths are
// fixed across all 3 poses, only the angles differ — keeps the silhouette
// consistent instead of each pose reading as a different shape; verified by
// rendering it at actual on-screen size before landing on these coordinates.
const ARM_POSE_POINTS: Record<ArmPose, { elbow: { x: number; y: number }; hand: { x: number; y: number } }> = {
  overhead: { elbow: { x: 43.1, y: 17.4 }, hand: { x: 40.3, y: 7.0 } },
  chest: { elbow: { x: 46.0, y: 39.4 }, hand: { x: 30.0, y: 36.0 } },
  waist: { elbow: { x: 44.5, y: 41.2 }, hand: { x: 31.0, y: 50.0 } },
};

const PHONE_W = 5;
const PHONE_H = 9;

function HeightStepIcon({ armPose, number, label }: { armPose: ArmPose; number: number; label: string }) {
  const { elbow, hand } = ARM_POSE_POINTS[armPose];
  const markerY = hand.y;
  return (
    <View style={styles.stepIconWrap}>
      <Svg width={STEP_ICON_W} height={STEP_ICON_H}>
        {/* legs */}
        <Path d="M 26 54 L 24 76" stroke={TEXT} strokeWidth={2.5} strokeLinecap="round" fill="none" />
        <Path d="M 38 54 L 40 76" stroke={TEXT} strokeWidth={2.5} strokeLinecap="round" fill="none" />

        {/* tapered torso — shoulders wider than hips, not a uniform capsule */}
        <Path
          d="M 22 27 L 42 27 L 39 54 L 25 54 Z"
          fill="#ffffff"
          stroke={TEXT}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* posed arm: shoulder -> elbow -> hand, the one part that changes per step */}
        <Path
          d={`M ${SHOULDER.x} ${SHOULDER.y} L ${elbow.x} ${elbow.y} L ${hand.x} ${hand.y}`}
          stroke={TEXT}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* phone held at the hand */}
        <Rect
          x={hand.x - PHONE_W / 2}
          y={hand.y - PHONE_H / 2}
          width={PHONE_W}
          height={PHONE_H}
          rx={1.2}
          fill={TEXT}
        />

        <Circle cx={STEP_ICON_CX} cy={17} r={8} fill="#ffffff" stroke={TEXT} strokeWidth={2} />

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

export default function GuidedCaptureIntroScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [hasRequiredPhotos, setHasRequiredPhotos] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadGuidedCaptureStoreState().then((state) => {
        if (cancelled) return;
        setHasRequiredPhotos(state.photos.length >= DEFAULT_STOP_COUNT * HEIGHT_STEPS.length);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {navigation.canGoBack() ? (
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.headerBack, pressed && styles.pressed]}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Go back">
              <View style={styles.headerChevronWrap} collapsable={false}>
                <Ionicons name="chevron-back" size={22} color={TEXT} />
              </View>
              <Text style={styles.headerTitle}>Guided capture camera angles</Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTitle}>Guided Capture</Text>
          )}
        </View>

        <View style={styles.imageCard}>
          <ArcCarousel />
        </View>

        <StepSequenceRow />

        <Text style={styles.body}>
          At each stop, take 3 photos in order — overhead, chest height, then waist height. Then move to the
          next stop and repeat.
        </Text>

        {hasRequiredPhotos ? (
          <Text style={styles.doneNotice}>You already have the required photos.</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.nextBtn, pressed && styles.nextPressed]}
          onPress={() => router.push('/(insurance)/capture')}
          accessibilityRole="button"
          accessibilityLabel="Continue to camera">
          <Text style={styles.nextBtnText}>Next</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 5,
    paddingTop: 45,
  },
  headerBack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingBottom: 1,
    paddingRight: 8,
  },
  headerChevronWrap: {
    width: 28,
    height: 28,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: TEXT,
    flexShrink: 0,
  },
  pressed: {
    opacity: 0.65,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT,
    textAlign: 'center',
    marginBottom: 0,
    lineHeight: 28,
  },
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
    marginBottom: 15,
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
    marginTop: 2,
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
  body: {
    paddingHorizontal: 10,
    fontSize: 17,
    lineHeight: 24,
    color: TEXT,
    textAlign: 'center',
    fontWeight: '500',
  },
  doneNotice: {
    marginTop: 12,
    paddingHorizontal: 10,
    fontSize: 15,
    lineHeight: 20,
    color: ORANGE,
    textAlign: 'center',
    fontWeight: '700',
  },
  footer: {
    paddingHorizontal: 25,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#ffffff',
  },
  nextBtn: {
    backgroundColor: ORANGE,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextPressed: {
    opacity: 0.92,
  },
  nextBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});
