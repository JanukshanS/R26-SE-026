import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_STATUS_ALIGNING_BG,
  CAPTURE_STATUS_PULSE_TINT,
  CAPTURE_TEXT_WHITE,
  CAPTURE_TYPE_LABEL_SIZE,
  CAPTURE_TYPE_LABEL_WEIGHT,
  CAPTURE_VALID_BORDER,
} from '@/features/guided-capture/capture-ui-theme';
import type { CaptureStatus } from '@/features/guided-capture/tilt-status';

type StatusPillProps = {
  state: CaptureStatus;
  label: string;
};

const STATE_BG: Record<CaptureStatus, string> = {
  aligning: CAPTURE_STATUS_ALIGNING_BG,
  almost: CAPTURE_ACTION_BLUE,
  steady: CAPTURE_VALID_BORDER,
};

/** Unified camera-overlay status: grey "aligning" -> pulsing orange "almost" -> green "steady". */
export function StatusPill({ state, label }: StatusPillProps) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (state === 'almost') {
      pulse.value = withRepeat(
        withSequence(withTiming(1, { duration: 550 }), withTiming(0, { duration: 550 })),
        -1,
        true
      );
    } else {
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [state, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + pulse.value * 0.5,
    transform: [{ scale: 1 + pulse.value * 0.18 }],
  }));

  return (
    <View style={styles.wrap}>
      {state === 'almost' ? <Animated.View style={[styles.pulseRing, pulseStyle]} /> : null}
      <View style={[styles.pill, { backgroundColor: STATE_BG[state] }]}>
        <Text style={styles.text} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
  },
  pulseRing: {
    position: 'absolute',
    left: -6,
    right: -6,
    top: -6,
    bottom: -6,
    borderRadius: 999,
    backgroundColor: CAPTURE_STATUS_PULSE_TINT,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: CAPTURE_TEXT_WHITE,
    fontSize: CAPTURE_TYPE_LABEL_SIZE,
    fontWeight: CAPTURE_TYPE_LABEL_WEIGHT,
  },
});
