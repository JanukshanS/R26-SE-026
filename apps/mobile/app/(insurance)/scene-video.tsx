import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CAPTURE_ACCENT_LIGHT_BLUE,
  CAPTURE_ACTION_BLUE,
  CAPTURE_BORDER_SUBTLE,
  CAPTURE_REC_BADGE_BG,
  CAPTURE_SCREEN_BG,
  CAPTURE_SCREEN_DARK_BG,
  CAPTURE_STOP_DANGER_BG,
  CAPTURE_TEXT_EMPHASIS_ON_DARK,
  CAPTURE_TEXT_PARAGRAPH_ON_DARK,
  CAPTURE_TEXT_SILVER,
  CAPTURE_TEXT_WHITE,
} from '@/features/guided-capture/capture-ui-theme';

/** Max length for a single scene clip (seconds). Recording stops automatically or when you tap Stop. */
const SCENE_RECORD_MAX_SEC = 120;

export default function SceneVideoScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const hasVideo = videoUri !== null;
  const recordWithMic = Platform.OS === 'android';

  useEffect(() => {
    const ref = cameraRef;
    return () => {
      ref.current?.stopRecording();
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not supported', 'Video recording runs on a physical device.');
      return;
    }
    const cam = cameraRef.current;
    if (!cam || isRecording || !isCameraReady) return;
    if (Platform.OS === 'android' && !micPermission?.granted) {
      Alert.alert('Microphone required', 'Grant microphone access to record video with sound on Android.');
      return;
    }

    setIsRecording(true);
    try {
      const recorded = await cam.recordAsync({
        maxDuration: SCENE_RECORD_MAX_SEC,
      });
      if (recorded?.uri) {
        setVideoUri(recorded.uri);
      } else {
        Alert.alert('Recording failed', 'No video file was produced. Please try again.');
      }
    } catch {
      Alert.alert('Recording failed', 'Please try again.');
    } finally {
      setIsRecording(false);
    }
  }, [isCameraReady, isRecording, micPermission?.granted]);

  const stopRecording = useCallback(() => {
    cameraRef.current?.stopRecording();
  }, []);

  const retake = () => {
    setVideoUri(null);
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.centerText}>Checking camera permission…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.centerText}>Camera access is required to record scene video.</Text>
          <Pressable style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Grant camera</Text>
          </Pressable>
          <Pressable style={styles.textBtn} onPress={() => router.back()}>
            <Text style={styles.textBtnLabel}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (Platform.OS === 'android') {
    if (!micPermission) {
      return (
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          <View style={styles.center}>
            <Text style={styles.centerText}>Checking microphone permission…</Text>
          </View>
        </SafeAreaView>
      );
    }
    if (!micPermission.granted) {
      return (
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          <View style={styles.center}>
            <Text style={styles.centerText}>
              Microphone access is required on Android so scene video can include sound.
            </Text>
            <Pressable style={styles.primaryBtn} onPress={requestMicPermission}>
              <Text style={styles.primaryBtnText}>Grant microphone</Text>
            </Pressable>
            <Pressable style={styles.textBtn} onPress={() => router.back()}>
              <Text style={styles.textBtnLabel}>Go back</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backHit}>
          <Text style={styles.backLabel}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Accident Video</Text>
        <View style={styles.topBarSpacer} />
      </View>
      <Text style={styles.subtitle}>
        {hasVideo
          ? 'Video saved on this device. Tap Retake to record again, or Back to return to capture.'
          : isRecording
            ? 'Recording… Tap Stop when you are done (or wait for the time limit).'
            : 'Film the accident scene. Use the rear camera and keep the phone steady.'}
      </Text>

      <View style={styles.cameraWrap}>
        <CameraView
          style={styles.camera}
          facing="back"
          mode="video"
          mute={!recordWithMic}
          ref={cameraRef}
          onCameraReady={() => setIsCameraReady(true)}
        />
        {isRecording ? (
          <View style={styles.recBadge} pointerEvents="none">
            <Text style={styles.recText}>REC</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        {!hasVideo ? (
          <>
            {isRecording ? (
              <Pressable style={({ pressed }) => [styles.stopBtn, pressed && styles.pressed]} onPress={stopRecording}>
                <Text style={styles.stopBtnText}>Stop Recording</Text>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.recordBtn,
                  pressed && styles.pressed,
                  (!isCameraReady || Platform.OS === 'web' || (Platform.OS === 'android' && !micPermission?.granted)) &&
                    styles.btnDisabled,
                ]}
                disabled={
                  !isCameraReady || Platform.OS === 'web' || (Platform.OS === 'android' && !micPermission?.granted)
                }
                onPress={() => void startRecording()}>
                {!isCameraReady ? (
                  <ActivityIndicator color={CAPTURE_TEXT_WHITE} />
                ) : (
                  <Text style={styles.recordBtnText}>
                    {Platform.OS === 'web' ? 'Video (device only)' : 'Start Recording'}
                  </Text>
                )}
              </Pressable>
            )}
          </>
        ) : (
          <Pressable style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]} onPress={retake}>
            <Text style={styles.secondaryBtnText}>Retake</Text>
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={() => router.back()}>
          <Text style={styles.secondaryBtnText}>{hasVideo ? 'Done — Return to Capture' : 'Cancel'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: CAPTURE_SCREEN_DARK_BG,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backHit: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    minWidth: 72,
  },
  backLabel: {
    color: CAPTURE_ACCENT_LIGHT_BLUE,
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    color: CAPTURE_TEXT_WHITE,
    fontSize: 17,
    fontWeight: '700',
  },
  topBarSpacer: {
    minWidth: 72,
  },
  subtitle: {
    color: CAPTURE_TEXT_SILVER,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  cameraWrap: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: CAPTURE_SCREEN_BG,
  },
  camera: {
    flex: 1,
  },
  recBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: CAPTURE_REC_BADGE_BG,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 5,
  },
  recText: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1,
  },
  actions: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 10,
  },
  recordBtn: {
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderRadius: 5,
    paddingVertical: 16,
    alignItems: 'center',
  },
  recordBtnText: {
    color: CAPTURE_TEXT_WHITE,
    fontSize: 17,
    fontWeight: '700',
  },
  stopBtn: {
    backgroundColor: CAPTURE_STOP_DANGER_BG,
    borderRadius: 5,
    paddingVertical: 16,
    alignItems: 'center',
  },
  stopBtnText: {
    color: CAPTURE_TEXT_WHITE,
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: CAPTURE_BORDER_SUBTLE,
    borderRadius: 5,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: CAPTURE_TEXT_EMPHASIS_ON_DARK,
    fontSize: 16,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.88,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 14,
  },
  centerText: {
    color: CAPTURE_TEXT_PARAGRAPH_ON_DARK,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
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
});
