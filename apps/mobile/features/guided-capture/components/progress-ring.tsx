import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_PROGRESS_RING_TRACK,
  CAPTURE_VALID_HEX,
} from '@/features/guided-capture/capture-ui-theme';

type ProgressRingProps = {
  current: number;
  total: number;
  size?: number;
};

/** Small circular progress ring showing captured/expected photo count. Stays orange
 * while in progress; turns the same green as the "Angle is good" status pill once
 * complete (the glow at that point lives on the View and Submit button instead). */
export function ProgressRing({ current, total, size = 46 }: ProgressRingProps) {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? Math.min(current / total, 1) : 0;
  const dashOffset = circumference * (1 - progress);
  const complete = total > 0 && current >= total;
  const activeColor = complete ? CAPTURE_VALID_HEX : CAPTURE_ACTION_BLUE;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={CAPTURE_PROGRESS_RING_TRACK}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={activeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.labelWrap} pointerEvents="none">
        <Text style={[styles.label, { color: activeColor }]} numberOfLines={1} adjustsFontSizeToFit>
          {current}/{total}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
  },
});
