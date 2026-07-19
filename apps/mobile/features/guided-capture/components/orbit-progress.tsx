import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ARC_CAR_FILL,
  CAPTURE_ARC_CAR_ROOF,
  CAPTURE_ARC_DOT_DONE,
  CAPTURE_ARC_DOT_TARGET,
  CAPTURE_ARC_DOT_UPCOMING,
  CAPTURE_TEXT_WHITE,
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
};

const SIZE = 300;
const CENTER_X = SIZE / 2;
const CENTER_Y = SIZE * 0.66;
const RADIUS = SIZE * 0.42;

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

/** Static "walk to the next dot" progress: an arc of dots around a top-down car icon. */
export function OrbitProgress({
  stopCount,
  completedStopIndex,
  progress01,
  onManualContinue,
}: OrbitProgressProps) {
  // Clamp so extra stops beyond stopCount (walked after the required set is done) don't
  // push the angle math outside the drawn semicircle — they just show as "fully arrived".
  const clampedDoneIndex = Math.min(completedStopIndex, stopCount - 1);
  const targetIndex = Math.min(completedStopIndex + 1, stopCount - 1);
  const doneAngle = angleForIndex(clampedDoneIndex, stopCount);
  const targetAngle = angleForIndex(targetIndex, stopCount);
  const markerAngle = doneAngle + (targetAngle - doneAngle) * progress01;
  const marker = pointForAngle(markerAngle);

  return (
    <View style={styles.root}>
      <Text style={styles.stopLabel}>{`Stop ${targetIndex + 1} of ${stopCount}`}</Text>
      <Text style={styles.title}>Keep walking to the next stop</Text>

      <Svg width={SIZE} height={SIZE}>
        {/* Top-down car icon */}
        <Rect
          x={CENTER_X - 22}
          y={CENTER_Y - 38}
          width={44}
          height={76}
          rx={14}
          fill={CAPTURE_ARC_CAR_FILL}
        />
        <Rect
          x={CENTER_X - 13}
          y={CENTER_Y - 20}
          width={26}
          height={40}
          rx={6}
          fill={CAPTURE_ARC_CAR_ROOF}
        />

        {Array.from({ length: stopCount }, (_, i) => {
          const { x, y } = pointForAngle(angleForIndex(i, stopCount));
          const isDone = i <= completedStopIndex;
          const isTarget = i === targetIndex;
          const fill = isDone ? CAPTURE_ARC_DOT_DONE : isTarget ? CAPTURE_ARC_DOT_TARGET : WHITE;
          const stroke = isDone || isTarget ? fill : CAPTURE_ARC_DOT_UPCOMING;
          return (
            <Circle
              key={i}
              cx={x}
              cy={y}
              r={isTarget ? 10 : 7}
              fill={fill}
              stroke={stroke}
              strokeWidth={2}
            />
          );
        })}

        {/* "You are here" marker, sliding toward the target dot as progress advances. */}
        <Circle cx={marker.x} cy={marker.y} r={5} fill={CAPTURE_ARC_DOT_DONE} />
      </Svg>

      <Pressable
        style={({ pressed }) => [styles.manualBtn, pressed && styles.manualBtnPressed]}
        onPress={onManualContinue}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="I'm in position">
        <Text style={styles.manualBtnText}>I&apos;m in position</Text>
      </Pressable>
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
    gap: 8,
  },
  stopLabel: {
    color: GRAY_900,
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    color: GRAY_900,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  manualBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 5,
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderWidth: 2,
    borderColor: CAPTURE_ACTION_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualBtnPressed: {
    opacity: 0.88,
  },
  manualBtnText: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '800',
    fontSize: 15,
  },
});
