import { useRouter } from 'expo-router';
import { useEffect, useState, type ComponentType } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  CAPTURE_ACCENT_LIGHT_BLUE,
  CAPTURE_SCREEN_DARK_BG,
  CAPTURE_TEXT_PARAGRAPH_ON_DARK,
} from '@/features/guided-capture/capture-ui-theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; Screen: ComponentType };

/**
 * Dev / integration route for react-native-vision-camera.
 *
 * Vision Camera v5 loads Nitro native modules at import time. This file does not
 * import `react-native-vision-camera` directly so the rest of the app can run until
 * you open this screen. After opening, native code must include Nitro — rebuild:
 * `npx expo run:android` / `npx expo run:ios`.
 */
export default function VisionPreviewScreen() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>(() =>
    Platform.OS === 'web' ? { status: 'error', message: 'web' } : { status: 'loading' },
  );

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    let cancelled = false;
    import('@/features/vision-camera/screens/vision-preview-camera-screen')
      .then((m) => {
        if (!cancelled) {
          setState({ status: 'ready', Screen: m.default });
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setState({ status: 'error', message: e?.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (Platform.OS === 'web' || state.status === 'error') {
    const isWeb = Platform.OS === 'web';
    return (
      <View style={styles.center}>
        <Text style={styles.message}>
          {isWeb
            ? 'Vision Camera runs on iOS and Android native builds only (not web).'
            : 'Vision Camera needs native Nitro modules in your app binary. Rebuild the dev client after installing dependencies:\n\n• npx expo run:android\n• npx expo run:ios\n\nThen open this screen again.'}
        </Text>
        {!isWeb && state.status === 'error' && state.message ? (
          <Text style={styles.hint}>{state.message}</Text>
        ) : null}
        <Pressable style={styles.textBtn} onPress={() => router.back()}>
          <Text style={styles.textBtnLabel}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (state.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={CAPTURE_ACCENT_LIGHT_BLUE} size="large" />
        <Text style={styles.message}>Loading Vision Camera…</Text>
      </View>
    );
  }

  const { Screen } = state;
  return <Screen />;
}

const styles = StyleSheet.create({
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
    fontSize: 12,
    textAlign: 'center',
  },
  textBtn: {
    paddingVertical: 8,
  },
  textBtnLabel: {
    color: CAPTURE_ACCENT_LIGHT_BLUE,
    fontSize: 16,
    fontWeight: '600',
  },
});
