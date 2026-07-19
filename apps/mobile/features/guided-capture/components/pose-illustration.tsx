import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  CAPTURE_ACTION_BLUE,
  GRAY_900,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';
import type { HeightStep } from '@/features/guided-capture/types';

const POSE_IMAGES: Record<HeightStep, number> = {
  overhead: require('../../../assets/images/overhead.png'),
  chest: require('../../../assets/images/chest.png'),
  waist: require('../../../assets/images/waist.png'),
};

const POSE_TITLES: Record<HeightStep, string> = {
  overhead: 'Overhead photo',
  chest: 'Chest-height photo',
  waist: 'Waist-height photo',
};

const POSE_INSTRUCTIONS: Record<HeightStep, string> = {
  overhead: 'Hold the phone above your head, tilted down over the vehicle.',
  chest: 'Hold the phone upright at chest height.',
  waist: 'Hold the phone upright at waist height.',
};

type PoseIllustrationProps = {
  heightStep: HeightStep;
  stopIndex: number;
  stopCount: number;
  isRetake: boolean;
  onReady: () => void;
};

/** Static pose image + fade/scale-in shown before each phocto. */
export function PoseIllustration({
  heightStep,
  stopIndex,
  stopCount,
  isRetake,
  onReady,
}: PoseIllustrationProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    opacity.setValue(0);
    scale.setValue(0.92);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [heightStep, stopIndex, opacity, scale]);

  return (
    <View style={styles.root}>
      <Text style={styles.stopLabel}>
        {isRetake ? 'Retake photo' : `Stop ${stopIndex + 1} of ${stopCount}`}
      </Text>
      <Text style={styles.title}>{POSE_TITLES[heightStep]}</Text>
      <Animated.Image
        source={POSE_IMAGES[heightStep]}
        style={[styles.image, { opacity, transform: [{ scale }] }]}
        resizeMode="contain"
      />
      <Text style={styles.instruction}>{POSE_INSTRUCTIONS[heightStep]}</Text>
      <Pressable
        style={({ pressed }) => [styles.readyButton, pressed && styles.readyButtonPressed]}
        onPress={onReady}
        accessibilityRole="button"
        accessibilityLabel="Ready to aim">
        <Text style={styles.readyButtonText}>Ready</Text>
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
    gap: 12,
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
  },
  image: {
    width: 280,
    height: 280,
  },
  instruction: {
    color: GRAY_900,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  readyButton: {
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderRadius: 10,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  readyButtonPressed: {
    opacity: 0.85,
  },
  readyButtonText: {
    color: WHITE,
    fontSize: 17,
    fontWeight: '700',
  },
});
