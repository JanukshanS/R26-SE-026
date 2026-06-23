import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  CAPTURE_TEXT_WHITE,
  CAPTURE_VALID_BORDER_SOFT,
  SWEEP_CUE_BG,
  SWEEP_CUE_SHADOW,
  SWEEP_CUE_TEXT,
  SWEEP_CUE_TEXT_SHADOW,
} from '@/features/guided-capture/capture-ui-theme';

type SweepDirectionCueProps = {
  direction: 'left' | 'right' | null;
  /** True during the short pulse after a capture (not shown before the first photo). */
  visible: boolean;
};

const PULSE_PX = 20;
const PULSE_MS = 700;

export function SweepDirectionCue({ direction, visible }: SweepDirectionCueProps) {
  const shift = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!visible || !direction) {
      cancelAnimation(shift);
      shift.value = 0;
      opacity.value = withTiming(0, { duration: 200 });
      return;
    }

    opacity.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });

    const delta = direction === 'right' ? PULSE_PX : -PULSE_PX;
    shift.value = withRepeat(
      withSequence(
        withTiming(delta, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [direction, visible, shift, opacity]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shift.value }],
  }));

  if (!visible || !direction) {
    return null;
  }

  const chevron = direction === 'left' ? 'chevron-back' : 'chevron-forward';
  const label =
    direction === 'left'
      ? 'Slowly move left around the vehicle'
      : 'Slowly move right around the vehicle';

  const iconSize = 35;
  const chevronColor = CAPTURE_TEXT_WHITE;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={[styles.fadeBlock, fadeStyle]}>
        <Animated.View style={[styles.chevronCluster, rowStyle]}>
          <View style={styles.chevronBackdrop} collapsable={false}>
            <Ionicons name={chevron} size={iconSize} color={chevronColor} style={styles.chevronIcon} />
            <Ionicons name={chevron} size={iconSize} color={chevronColor} style={styles.chevronIcon} />
            <Ionicons name={chevron} size={iconSize} color={chevronColor} style={styles.chevronIcon} />
          </View>
        </Animated.View>
        <Text style={styles.caption}>{label}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: '26%',
    alignItems: 'center',
    zIndex: 6,
  },
  fadeBlock: {
    alignItems: 'center',
  },
  chevronCluster: {
    marginBottom: 125,
  },
  chevronBackdrop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 5,
    paddingVertical: 5,
    borderRadius: 5,
    overflow: 'hidden',
    /** Light frosted panel; lower alpha = more see-through (try 0.55–0.85). */
    backgroundColor: SWEEP_CUE_BG,
    borderWidth: 2,
    borderColor: CAPTURE_VALID_BORDER_SOFT,
    shadowColor: SWEEP_CUE_SHADOW,
    shadowOffset: { width: 0, height: 2 },
    // shadowOpacity: 0.2,
    // shadowRadius: 8,
    elevation: 6,
  },
  chevronIcon: {
    // textShadowOffset: { width: 0, height: 1 },
    // textShadowRadius: 1,
  },
  caption: {
    color: SWEEP_CUE_TEXT,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    textShadowColor: SWEEP_CUE_TEXT_SHADOW,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 0,
    paddingHorizontal: 0,
  },
});
