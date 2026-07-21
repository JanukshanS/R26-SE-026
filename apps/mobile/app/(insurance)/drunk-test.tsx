import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as IntentLauncher from 'expo-intent-launcher';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ResetCaptureDialog } from '@/features/guided-capture/components/reset-capture-dialog';
import {
  deleteDrunkTestVideo,
  loadDrunkTestState,
  saveDrunkTestState,
} from '@/features/drunk-test/storage/drunk-test-store';
import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_RESET_CANCEL_BORDER,
  INSURANCE_BORDER,
  INSURANCE_CAMERA_PLACEHOLDER_BG,
  INSURANCE_CTA_LINK,
  INSURANCE_PERMISSION_BLUE,
  INSURANCE_PRIMARY,
  INSURANCE_RECORDING_BAR_BG,
  INSURANCE_SCREEN_BG,
  INSURANCE_SCRIPT_BOX_BG,
  INSURANCE_SHADOW_COLOR,
  INSURANCE_TEXT,
  INSURANCE_TEXT_DIM,
  INSURANCE_TEXT_MUTED,
  INSURANCE_VIDEO_TILE_BG,
  INSURANCE_VIDEO_TILE_SUBTEXT,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';

/** Matches on-screen “Recording N seconds left” and `recordAsync.maxDuration`. */
const RECORD_DURATION_SEC = 40;

const READ_ALOUD_SCRIPT =
  'My name is (Full Name). Licence number (Licence Number). I am driving a (Vehicle Type). Today is (Date). The time is (Time), and I am at (Location). I am recording this after the accident to confirm I am conscious and not under the influence of alcohol or drugs. The accident happened because (brief description).'
  
const DRUNK_TEST_VIDEO_DIR = (FileSystem.documentDirectory ?? '') + 'drunk-test-videos/';

function getVideoExtension(uri: string): string {
  const path = uri.split('?')[0] ?? uri;
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index + 1) : 'mp4';
}

async function persistRecordedVideo(sourceUri: string): Promise<string> {
  const sourceInfo = await FileSystem.getInfoAsync(sourceUri);
  if (!sourceInfo.exists) return sourceUri;
  await FileSystem.makeDirectoryAsync(DRUNK_TEST_VIDEO_DIR, { intermediates: true });
  const ext = getVideoExtension(sourceUri);
  const destUri = DRUNK_TEST_VIDEO_DIR + `drunk-test-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destUri });
  const destInfo = await FileSystem.getInfoAsync(destUri);
  if (!destInfo.exists) throw new Error('Stored video file was not created.');
  return destUri;
}

export default function DrunkTestScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const cameraRef = useRef<CameraView>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hydratedStoreRef = useRef(false);
  const videoUriRef = useRef<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isResetDialogVisible, setIsResetDialogVisible] = useState(false);

  const hasVideo = videoUri !== null;

  const headline = hasVideo
    ? 'User Verification Test video captured'
    : 'Tap Take Video and Read this aloud facing the camera';

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    videoUriRef.current = videoUri;
  }, [videoUri]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await loadDrunkTestState();
      if (cancelled) {
        return;
      }
      setVideoUri(state.videoUri);
      hydratedStoreRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedStoreRef.current) {
      return;
    }
    void saveDrunkTestState({ videoUri });
  }, [videoUri]);

  useEffect(() => {
    const ref = cameraRef;
    return () => {
      clearCountdownTimer();
      ref.current?.stopRecording();
    };
  }, [clearCountdownTimer]);

  const startRecording = async () => {
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
    setRemainingSeconds(RECORD_DURATION_SEC);

    countdownTimerRef.current = setInterval(() => {
      setRemainingSeconds((s) => {
        if (s === null || s <= 0) return 0;
        return s - 1;
      });
    }, 1000);

    try {
      const recorded = await cam.recordAsync({
        maxDuration: RECORD_DURATION_SEC,
      });
      if (recorded?.uri) {
        const previousUri = videoUriRef.current;
        try {
          const storedUri = await persistRecordedVideo(recorded.uri);
          setVideoUri(storedUri);
          if (previousUri && previousUri !== storedUri) {
            void deleteDrunkTestVideo(previousUri);
          }
        } catch {
          // Fallback to the raw recorded URI so user can still play it until Retake.
          setVideoUri(recorded.uri);
          Alert.alert('Saved temporarily', 'Video saved in temporary storage for this session.');
        }
      } else {
        Alert.alert('Recording failed', 'No video file was produced. Please try again.');
      }
    } catch {
      Alert.alert('Recording failed', 'Please try again.');
    } finally {
      clearCountdownTimer();
      setIsRecording(false);
      setRemainingSeconds(null);
    }
  };

  const retake = () => {
    void deleteDrunkTestVideo(videoUriRef.current);
    setVideoUri(null);
  };

  // Guards against a second tap while the previous IntentLauncher/Linking call is still
  // in flight — Android rejects a second startActivityAsync before the first returns a
  // result ("activity is already started"), which otherwise surfaces as an uncaught error.
  const isOpeningVideoRef = useRef(false);

  const playSavedVideo = useCallback(async () => {
    if (!videoUri || isOpeningVideoRef.current) {
      return;
    }
    isOpeningVideoRef.current = true;
    try {
      const localInfo = await FileSystem.getInfoAsync(videoUri);
      if (!localInfo.exists) {
        Alert.alert('Video not found', 'Saved video is missing. Please record again.');
        return;
      }
      const uriToOpen =
        Platform.OS === 'android' && videoUri.startsWith('file://')
          ? await FileSystem.getContentUriAsync(videoUri)
          : videoUri;
      if (Platform.OS === 'android') {
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: uriToOpen,
          flags: 1,
          type: 'video/*',
        });
        return;
      }
      const canOpen = await Linking.canOpenURL(uriToOpen);
      if (!canOpen) {
        Alert.alert('Unable to play video', 'No app available to open the saved video on this device.');
        return;
      }
      await Linking.openURL(uriToOpen);
    } catch {
      // Best-effort: e.g. a rapid double-tap racing the same launch, or no video app installed.
    } finally {
      isOpeningVideoRef.current = false;
    }
  }, [videoUri]);

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.centerText}>Checking camera permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.centerText}>Camera access is required for the drunk test.</Text>
          <Pressable style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Camera Permission</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={() => router.back()}>
            <Text style={styles.textButtonLabel}>Go back</Text>
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
            <Text style={styles.centerText}>Checking microphone permission...</Text>
          </View>
        </SafeAreaView>
      );
    }
    if (!micPermission.granted) {
      return (
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          <View style={styles.center}>
            <Text style={styles.centerText}>
              Microphone access is required on Android so your drunk test video can include sound.
            </Text>
            <Pressable style={styles.permissionButton} onPress={requestMicPermission}>
              <Text style={styles.permissionButtonText}>Grant Microphone Permission</Text>
            </Pressable>
            <Pressable style={styles.textButton} onPress={() => router.back()}>
              <Text style={styles.textButtonLabel}>Go back</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }
  }

  const recordWithMic = true;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ResetCaptureDialog
        visible={isResetDialogVisible}
        title="Retake Video"
        message="Clear the current drunk test video and record again?"
        confirmLabel="Retake"
        icon="Video"
        onCancel={() => setIsResetDialogVisible(false)}
        onConfirm={() => {
          setIsResetDialogVisible(false);
          retake();
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {navigation.canGoBack() ? (
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.headerBack, pressed && styles.pressed]}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Go back">
              <View style={styles.headerChevronWrap} collapsable={false}>
                <Ionicons name="chevron-back" size={22} color={COLORS.text} />
              </View>
              <Text style={styles.headerTitle}>User Verification Test</Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTitle}>User Verification Test</Text>
          )}
        </View>

        <Text style={styles.headline}>{headline}</Text>

        {!hasVideo ? (
          <View style={styles.readAloudBox}>
            <ScrollView style={styles.readAloudScroll} nestedScrollEnabled showsVerticalScrollIndicator>
              <Text style={styles.readAloudText}>{READ_ALOUD_SCRIPT}</Text>
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.cameraSquare}>
          <CameraView
            style={styles.camera}
            facing="front"
            mode="video"
            mute={!recordWithMic}
            ref={cameraRef}
            onCameraReady={() => setIsCameraReady(true)}
          />
          {isRecording && remainingSeconds !== null ? (
            <View style={styles.recordingBar} pointerEvents="none">
              <Text style={styles.recordingBarHint}>Stay in frame till the countdown finishes.</Text>
              <Text style={styles.recordingBarText}>
                Recording {remainingSeconds} seconds left
              </Text>
            </View>
          ) : null}
          {hasVideo ? (
            <View style={styles.cornerAnchor}>
              <Pressable
                style={({ pressed }) => [styles.cornerPreviewTile, pressed && styles.pressed]}
                accessibilityLabel="Play saved video"
                onPress={() => void playSavedVideo()}>
                <Text style={styles.cornerVideoLabel}>Play</Text>
                <Text style={styles.cornerVideoSub}>{RECORD_DURATION_SEC}s clip</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={() => router.replace('/(insurance)')}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          {!hasVideo ? (
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
                (isRecording ||
                  !isCameraReady ||
                  Platform.OS === 'web' ||
                  (Platform.OS === 'android' && !micPermission?.granted)) &&
                  styles.buttonDisabled,
              ]}
              onPress={() => void startRecording()}
              disabled={
                isRecording ||
                !isCameraReady ||
                Platform.OS === 'web' ||
                (Platform.OS === 'android' && !micPermission?.granted)
              }>
              {isRecording ? (
                <ActivityIndicator color={WHITE} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {!isCameraReady ? 'Preparing camera…' : Platform.OS === 'web' ? 'Video (device only)' : 'Take Video'}
                </Text>
              )}
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
              onPress={() => setIsResetDialogVisible(true)}>
              <Text style={styles.primaryButtonText}>Retake</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const COLORS = {
  text: INSURANCE_TEXT,
  textMuted: INSURANCE_TEXT_MUTED,
  screen: INSURANCE_SCREEN_BG,
  border: INSURANCE_BORDER,
  scriptBg: INSURANCE_SCRIPT_BOX_BG,
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.screen,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  header: {
    marginBottom: 5,
    paddingTop: 45,
  },
  headerBack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingBottom: 4,
    paddingRight: 8,
  },
  headerChevronWrap: {
    width: 28,
    height: 28,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    flexShrink: 0,
  },
  headline: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 30,
    marginBottom: 10,
  },
  readAloudBox: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 15,
    backgroundColor: COLORS.scriptBg,
    marginBottom: 10,
  },
  readAloudScroll: {
    maxHeight: 200,
  },
  readAloudText: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.text,
    textAlign: 'left',
  },
  cameraSquare: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: INSURANCE_CAMERA_PLACEHOLDER_BG,
    position: 'relative',
    marginBottom: 10,
  },
  camera: {
    flex: 1,
  },
  recordingBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: INSURANCE_RECORDING_BAR_BG,
    gap: 6,
  },
  recordingBarHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  recordingBarText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  cornerAnchor: {
    position: 'absolute',
    bottom: 10,
    right: 10,
  },
  cornerPreviewTile: {
    width: 80,
    height: 80,
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: WHITE,
    backgroundColor: INSURANCE_VIDEO_TILE_BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    shadowColor: INSURANCE_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  cornerVideoLabel: {
    color: WHITE,
    fontSize: 15,
    fontWeight: '800',
  },
  cornerVideoSub: {
    color: INSURANCE_VIDEO_TILE_SUBTEXT,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  backButton: {
    flex: 1,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: CAPTURE_RESET_CANCEL_BORDER,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPressed: {
    opacity: 0.88,
  },
  backButtonText: {
    color: CAPTURE_ACTION_BLUE,
    fontSize: 17,
    fontWeight: '700',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: INSURANCE_PRIMARY,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.92,
  },
  primaryButtonText: {
    color: WHITE,
    fontSize: 17,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.65,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  centerText: {
    color: INSURANCE_TEXT_DIM,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
  },
  permissionButton: {
    backgroundColor: INSURANCE_PERMISSION_BLUE,
    borderRadius: 5,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  permissionButtonText: {
    color: WHITE,
    fontWeight: '700',
    fontSize: 16,
  },
  textButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  textButtonLabel: {
    color: INSURANCE_CTA_LINK,
    fontSize: 16,
    fontWeight: '600',
  },
});
