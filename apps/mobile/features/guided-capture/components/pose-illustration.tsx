import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { CaptureButton } from '@/features/guided-capture/components/capture-button';
import { StopProgressLabel } from '@/features/guided-capture/components/stop-progress-label';
import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_SOFT,
  CAPTURE_TYPE_HEADLINE_SIZE,
  CAPTURE_TYPE_HEADLINE_WEIGHT,
  GRAY_900,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';
import type { HeightStep } from '@/features/guided-capture/types';
import { useT } from '@/lib/i18n';

const POSE_IMAGES: Record<HeightStep, number> = {
  overhead: require('../../../assets/images/overhead.png'),
  chest: require('../../../assets/images/chest.png'),
  waist: require('../../../assets/images/waist.png'),
};

const POSE_TITLE_KEYS: Record<HeightStep, string> = {
  overhead: 'insurance.pose.titleOverhead',
  chest: 'insurance.pose.titleChest',
  waist: 'insurance.pose.titleWaist',
};

const POSE_INSTRUCTION_KEYS: Record<HeightStep, string> = {
  overhead: 'insurance.pose.instructionOverhead',
  chest: 'insurance.pose.instructionChest',
  waist: 'insurance.pose.instructionWaist',
};

/** Distance the reference photos show — kept as real text so it isn't only baked into the image pixels. */
const POSE_DISTANCE_KEY = 'insurance.pose.distance';

type PoseMedia = { type: 'image'; source: number } | { type: 'video'; source: number };

type PoseIllustrationProps = {
  heightStep: HeightStep;
  stopIndex: number;
  stopCount: number;
  isRetake: boolean;
  onReady: () => void;
  /** Defaults to the built-in reference photo for `heightStep`. Pass a video source later
   * (`{ type: 'video', source }`) to swap in a looping reference clip with a data-only change. */
  media?: PoseMedia;
};

/** Pose reference (image or, later, video) + fade/scale-in shown before each photo. */
export function PoseIllustration({
  heightStep,
  stopIndex,
  stopCount,
  isRetake,
  onReady,
  media,
}: PoseIllustrationProps) {
  const t = useT();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const resolvedMedia: PoseMedia = media ?? { type: 'image', source: POSE_IMAGES[heightStep] };
  const videoSource = resolvedMedia.type === 'video' ? resolvedMedia.source : null;
  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

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
      {isRetake ? (
        <View style={styles.retakePill}>
          <Text style={styles.retakeText}>{t('insurance.pose.retake')}</Text>
        </View>
      ) : (
        <StopProgressLabel stopIndex={stopIndex} stopCount={stopCount} heightStep={heightStep} />
      )}
      <Text style={styles.title}>{t(POSE_TITLE_KEYS[heightStep])}</Text>
      <Animated.View style={[styles.mediaWrap, { opacity, transform: [{ scale }] }]}>
        {resolvedMedia.type === 'video' ? (
          <VideoView player={player} style={styles.image} contentFit="contain" nativeControls={false} />
        ) : (
          <Image source={resolvedMedia.source} style={styles.image} resizeMode="contain" />
        )}
      </Animated.View>
      <Text style={styles.distanceLabel}>{t(POSE_DISTANCE_KEY)}</Text>
      <Text style={styles.instruction}>{t(POSE_INSTRUCTION_KEYS[heightStep])}</Text>
      <CaptureButton
        title={t('insurance.pose.ready')}
        onPress={onReady}
        accessibilityLabel={t('insurance.pose.readyA11y')}
      />
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
  retakePill: {
    alignSelf: 'center',
    backgroundColor: CAPTURE_ACTION_BLUE_SOFT,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  retakeText: {
    color: CAPTURE_ACTION_BLUE,
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    color: GRAY_900,
    fontSize: CAPTURE_TYPE_HEADLINE_SIZE,
    fontWeight: CAPTURE_TYPE_HEADLINE_WEIGHT,
  },
  // Matches the reference photos' own ~4:3 aspect ratio (e.g. overhead.png is
  // 658x494) instead of forcing a 280x280 square — with resizeMode="contain",
  // a square box let the photo letterbox with an invisible white margin above
  // and below, which is why borderRadius here was clipping blank space rather
  // than the actual photo (no visible effect).
  mediaWrap: {
    width: 280,
    aspectRatio: 4 / 3,
    borderRadius: 16,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  distanceLabel: {
    color: CAPTURE_ACTION_BLUE,
    fontSize: 14,
    fontWeight: '600',
  },
  instruction: {
    color: GRAY_900,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 4,
  },
});
