import { BlurView } from 'expo-blur';
import { useMemo } from 'react';
import {
  Dimensions,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  CAPTURE_MODAL_BLUR_INTENSITY_ANDROID,
  CAPTURE_MODAL_BLUR_INTENSITY_IOS,
  CAPTURE_MODAL_BLUR_REDUCTION_ANDROID,
  CAPTURE_MODAL_BLUR_TINT,
  CAPTURE_MODAL_UNIFORM_VEIL,
  CAPTURE_MODAL_WEB_SCRIM,
} from '@/features/guided-capture/capture-ui-theme';

export function useCaptureModalOverlaySize() {
  const windowDims = useWindowDimensions();
  return useMemo(() => {
    const screen = Dimensions.get('screen');
    return {
      width: Math.max(windowDims.width, screen.width),
      height: Math.max(windowDims.height, screen.height),
    };
  }, [windowDims.height, windowDims.width]);
}

type CaptureModalBackdropProps = {
  width: number;
  height: number;
};

/** Blur + veil + web scrim — same rendering for every capture-related modal. */
export function CaptureModalBackdrop({ width, height }: CaptureModalBackdropProps) {
  const sizedFill = useMemo(
    () => [captureModalBackdropStyles.fill, { width, height }],
    [width, height],
  );

  if (Platform.OS === 'web') {
    return (
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: CAPTURE_MODAL_WEB_SCRIM }]}
      />
    );
  }

  return (
    <>
      <BlurView
        tint={CAPTURE_MODAL_BLUR_TINT}
        intensity={
          Platform.OS === 'android'
            ? CAPTURE_MODAL_BLUR_INTENSITY_ANDROID
            : CAPTURE_MODAL_BLUR_INTENSITY_IOS
        }
        style={sizedFill}
        {...(Platform.OS === 'android'
          ? {
              experimentalBlurMethod: 'dimezisBlurView' as const,
              blurReductionFactor: CAPTURE_MODAL_BLUR_REDUCTION_ANDROID,
            }
          : {})}
      />
      <View
        pointerEvents="none"
        style={[
          captureModalBackdropStyles.fill,
          { width, height, backgroundColor: CAPTURE_MODAL_UNIFORM_VEIL },
        ]}
      />
    </>
  );
}

export const captureModalBackdropStyles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: '#000000',
  },
  rootWeb: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    minHeight: '100%',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
