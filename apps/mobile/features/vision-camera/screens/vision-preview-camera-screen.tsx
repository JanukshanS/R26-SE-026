import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';

import {
  CAPTURE_ACCENT_LIGHT_BLUE,
  CAPTURE_ACTION_BLUE,
  CAPTURE_SCREEN_BG,
  CAPTURE_SCREEN_DARK_BG,
  CAPTURE_TEXT_PARAGRAPH_ON_DARK,
  CAPTURE_TEXT_WHITE,
} from '@/features/guided-capture/capture-ui-theme';

/**
 * Native-only Vision Camera UI. Loaded dynamically from `app/vision-preview.tsx`
 * so the route file never evaluates `react-native-vision-camera` at startup.
 */
export default function VisionPreviewCameraScreen() {
  const router = useRouter();
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission, canRequestPermission } = useCameraPermission();

  useEffect(() => {
    if (!hasPermission && canRequestPermission) {
      void requestPermission();
    }
  }, [hasPermission, canRequestPermission, requestPermission]);

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Camera permission is required for the Vision Camera preview.</Text>
        {canRequestPermission ? (
          <Pressable style={styles.primaryBtn} onPress={() => void requestPermission()}>
            <Text style={styles.primaryBtnText}>Grant permission</Text>
          </Pressable>
        ) : (
          <Text style={styles.hint}>Enable camera access in system Settings, then return here.</Text>
        )}
        <Pressable style={styles.textBtn} onPress={() => router.back()}>
          <Text style={styles.textBtnLabel}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>No back camera device found.</Text>
        <Pressable style={styles.textBtn} onPress={() => router.back()}>
          <Text style={styles.textBtnLabel}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive />
      <Pressable style={styles.backHit} onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.backLabel}>← Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CAPTURE_SCREEN_BG,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 16,
    backgroundColor: CAPTURE_SCREEN_DARK_BG,
  },
  message: {
    color: CAPTURE_TEXT_PARAGRAPH_ON_DARK,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  hint: {
    color: CAPTURE_ACCENT_LIGHT_BLUE,
    fontSize: 14,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: CAPTURE_ACTION_BLUE,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 5,
  },
  primaryBtnText: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '700',
    fontSize: 16,
  },
  textBtn: {
    paddingVertical: 8,
  },
  textBtnLabel: {
    color: CAPTURE_ACCENT_LIGHT_BLUE,
    fontSize: 16,
    fontWeight: '600',
  },
  backHit: {
    position: 'absolute',
    top: 56,
    left: 16,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backLabel: {
    color: CAPTURE_ACCENT_LIGHT_BLUE,
    fontSize: 16,
    fontWeight: '600',
  },
});
