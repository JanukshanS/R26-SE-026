import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Rect } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CaptureButton } from '@/features/guided-capture/components/capture-button';
import { StopProgressLabel } from '@/features/guided-capture/components/stop-progress-label';
import {
  CAPTURE_ARC_CAR_LINE,
  CAPTURE_ARC_DOT_DONE,
  CAPTURE_ARC_DOT_TARGET,
  CAPTURE_ARC_DOT_UPCOMING,
  GRAY_900,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';

type OrbitProgressProps = {
  stopCount: number;
  /** Stop just finished; the next stop (the walking target) is completedStopIndex + 1. */
  completedStopIndex: number;
  progress01: number;
  /** Manual escape hatch (e.g. straight-line walks along a flat side barely turn the phone,
   * so the gyro accumulates very little yaw — or the device has no working gyroscope). */
  onManualContinue: () => void;
  /** Required stops are already covered at this point — lets the user leave Guided Capture
   * for the next step in the claim instead of only being able to keep walking/shooting. */
  onNextStep: () => void;
};

const SIZE = 300;
const CENTER_X = SIZE / 2;
const CENTER_Y = SIZE * 0.66;
const RADIUS = SIZE * 0.42;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Angle (radians) for dot index i, sweeping a semicircle from 180° (left) to 0° (right). */
function angleForIndex(i: number, stopCount: number): number {
  if (stopCount <= 1) return Math.PI / 2;
  return Math.PI - (Math.PI * i) / (stopCount - 1);
}

function pointForAngle(angle: number): { x: number; y: number } {
  return {
    x: CENTER_X + RADIUS * Math.cos(angle),
    y: CENTER_Y - RADIUS * Math.sin(angle),
  };
}

/** One arc dot: pulsing glow while it's the walking target, a quick "pop" flash the moment
 * it flips from target/upcoming to done. */
function OrbitDot({
  x,
  y,
  isDone,
  isTarget,
}: {
  x: number;
  y: number;
  isDone: boolean;
  isTarget: boolean;
}) {
  const wasDoneRef = useRef(isDone);
  const flash = useSharedValue(0);
  const glowPulse = useSharedValue(0);

  useEffect(() => {
    if (isDone && !wasDoneRef.current) {
      flash.value = 0;
      flash.value = withTiming(1, { duration: 380 });
    }
    wasDoneRef.current = isDone;
  }, [isDone, flash]);

  useEffect(() => {
    if (isTarget) {
      glowPulse.value = withRepeat(
        withSequence(withTiming(1, { duration: 650 }), withTiming(0, { duration: 650 })),
        -1,
        true
      );
    } else {
      glowPulse.value = withTiming(0, { duration: 200 });
    }
  }, [isTarget, glowPulse]);

  const glowProps = useAnimatedProps(() => ({
    r: 12 + glowPulse.value * 7,
    fillOpacity: isTarget ? 0.18 + glowPulse.value * 0.22 : 0,
  }));

  const flashProps = useAnimatedProps(() => ({
    r: 7 + (1 - flash.value) * 7,
    fillOpacity: (1 - flash.value) * 0.85,
  }));

  const baseRadius = isTarget ? 10 : 7;
  const fill = isDone ? CAPTURE_ARC_DOT_DONE : isTarget ? CAPTURE_ARC_DOT_TARGET : WHITE;
  const stroke = isDone || isTarget ? fill : CAPTURE_ARC_DOT_UPCOMING;

  return (
    <>
      {isTarget ? (
        <AnimatedCircle cx={x} cy={y} fill={CAPTURE_ARC_DOT_TARGET} animatedProps={glowProps} />
      ) : null}
      <Circle cx={x} cy={y} r={baseRadius} fill={fill} stroke={stroke} strokeWidth={2} />
      <AnimatedCircle cx={x} cy={y} fill={WHITE} animatedProps={flashProps} />
    </>
  );
}

/** Thin-outline top-down car icon, matching the "Guided capture camera angles" intro diagram. */
function CarIcon() {
  return (
    <>
      <Rect
        x={CENTER_X - 22}
        y={CENTER_Y - 40}
        width={44}
        height={80}
        rx={16}
        fill={WHITE}
        stroke={CAPTURE_ARC_CAR_LINE}
        strokeWidth={2.5}
      />
      <Rect
        x={CENTER_X - 14}
        y={CENTER_Y - 24}
        width={28}
        height={20}
        rx={5}
        fill="none"
        stroke={CAPTURE_ARC_CAR_LINE}
        strokeWidth={2}
      />
      <Rect
        x={CENTER_X - 14}
        y={CENTER_Y + 12}
        width={28}
        height={16}
        rx={5}
        fill="none"
        stroke={CAPTURE_ARC_CAR_LINE}
        strokeWidth={2}
      />
      <Line
        x1={CENTER_X}
        y1={CENTER_Y - 22}
        x2={CENTER_X}
        y2={CENTER_Y + 26}
        stroke={CAPTURE_ARC_CAR_LINE}
        strokeWidth={1.5}
      />
      <Ellipse cx={CENTER_X - 24} cy={CENTER_Y - 18} rx={4} ry={6} fill={WHITE} stroke={CAPTURE_ARC_CAR_LINE} strokeWidth={2} />
      <Ellipse cx={CENTER_X + 24} cy={CENTER_Y - 18} rx={4} ry={6} fill={WHITE} stroke={CAPTURE_ARC_CAR_LINE} strokeWidth={2} />
    </>
  );
}

/** "Walk to the next dot" progress: an arc of dots around a top-down car icon. */
export function OrbitProgress({
  stopCount,
  completedStopIndex,
  progress01,
  onManualContinue,
  onNextStep,
}: OrbitProgressProps) {
  // Clamp so extra stops beyond stopCount (walked after the required set is done) don't
  // push the angle math outside the drawn semicircle — they just show as "fully arrived".
  // This clamped index is only for the arc geometry (dot positions are fixed to stopCount
  // slots); the label below uses the real, unclamped next-stop number instead, so walking
  // toward stop 13 reads "Stop 13", not a geometry-clamped "Stop 12".
  const clampedDoneIndex = Math.min(completedStopIndex, stopCount - 1);
  const targetIndex = Math.min(completedStopIndex + 1, stopCount - 1);
  const labelTargetIndex = completedStopIndex + 1;
  const doneAngle = angleForIndex(clampedDoneIndex, stopCount);
  const targetAngle = angleForIndex(targetIndex, stopCount);
  const markerAngle = doneAngle + (targetAngle - doneAngle) * progress01;
  const marker = pointForAngle(markerAngle);
  // The last required stop was just finished — any further stops from here are "extra".
  const requiredStopsDone = completedStopIndex >= stopCount - 1;

  return (
    <View style={styles.root}>
      <StopProgressLabel stopIndex={labelTargetIndex} stopCount={stopCount} />
      <Text style={styles.title}>Keep walking to the next stop</Text>

      <Svg width={SIZE} height={SIZE}>
        <CarIcon />

        {Array.from({ length: stopCount }, (_, i) => {
          const { x, y } = pointForAngle(angleForIndex(i, stopCount));
          return (
            <OrbitDot key={i} x={x} y={y} isDone={i <= completedStopIndex} isTarget={i === targetIndex} />
          );
        })}

        {/* "You are here" marker, sliding toward the target dot as progress advances. */}
        <Circle cx={marker.x} cy={marker.y} r={5} fill={CAPTURE_ARC_DOT_DONE} />
      </Svg>

      {requiredStopsDone ? (
        <View style={styles.actions}>
          <CaptureButton
            title="Home"
            onPress={onNextStep}
            variant="secondary"
            fullWidth={false}
            style={styles.actionBtn}
            accessibilityLabel="Home"
          />
          <CaptureButton
            title="Continue"
            onPress={onManualContinue}
            variant="primary"
            fullWidth={false}
            style={styles.actionBtn}
            accessibilityLabel="Continue"
          />
        </View>
      ) : (
        <CaptureButton
          title="Continue"
          onPress={onManualContinue}
          variant="secondary"
          fullWidth={false}
          accessibilityLabel="Continue"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  title: {
    color: GRAY_900,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  // flex: 1 (not fullWidth) so both buttons split the row evenly regardless of their
  // text length — "I'm in position" is longer than "Next Step", so matching width by
  // content alone left them visibly different sizes.
  actionBtn: {
    flex: 1,
  },
});
