import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as IntentLauncher from 'expo-intent-launcher';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Icon } from '@components/ui/icon';
import { CaptureButton } from '@/features/guided-capture/components/capture-button';
import { ResetCaptureDialog } from '@/features/guided-capture/components/reset-capture-dialog';
import {
  deleteDrunkTestVideo,
  loadDrunkTestState,
  saveDrunkTestState,
} from '@/features/drunk-test/storage/drunk-test-store';
import { loadDrunkTestEntryMeta, saveDrunkTestEntryMeta } from '@/features/drunk-test/storage/drunk-test-entry-store';
import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_SOFT,
  CAPTURE_REC_BADGE_BG,
  CAPTURE_TYPE_HEADLINE_SIZE,
  CAPTURE_TYPE_HEADLINE_WEIGHT,
  GRAY_900,
  INSURANCE_BORDER,
  INSURANCE_CAMERA_PLACEHOLDER_BG,
  INSURANCE_CTA_LINK,
  INSURANCE_PERMISSION_BLUE,
  INSURANCE_SCREEN_BG,
  INSURANCE_SHADOW_COLOR,
  INSURANCE_TEXT,
  INSURANCE_TEXT_DIM,
  INSURANCE_TEXT_MUTED,
  INSURANCE_VIDEO_TILE_BG,
  INSURANCE_VIDEO_TILE_SUBTEXT,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';
import { captureLocationSnapshot } from '@/lib/location-snapshot-store';
import { savePhotoGps } from '@/lib/photo-gps-store';
import { getCachedMyUser, getMyUser } from '@/lib/vehicleApi';

/** Matches on-screen “Recording N seconds left” and `recordAsync.maxDuration`. */
const RECORD_DURATION_SEC = 40;

const READ_ALOUD_SCRIPT_TEMPLATE =
  'My name is (Full Name). Licence number (Licence Number). I am driving a (Vehicle Type). Today is (Date). The time is (Time), and I am at (Location). I am recording this after the accident to confirm I am conscious and not under the influence of alcohol or drugs. The accident happened because (brief description).';

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

/** Pulsing red dot shown next to "Recording" while active. */
function RecordingDot() {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0, { duration: 500 })), -1, true);
  }, [pulse]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * 0.55,
  }));

  return <Animated.View style={[styles.recordingDot, dotStyle]} />;
}

export default function DrunkTestScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { locked } = useLocalSearchParams<{ locked?: string }>();
  const isLocked = locked === '1';
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
  // Seeded from whatever profile was already fetched earlier this session (almost
  // always available by the time a driver reaches this step) so the licence number
  // doesn't flash a placeholder before this screen's own fresh fetch below resolves.
  const [licenceNumber, setLicenceNumber] = useState<string | null>(
    () => getCachedMyUser()?.licenceNumber ?? null
  );

  // useFocusEffect (not useEffect) so the licence number refreshes if the
  // driver sets/edits it elsewhere (e.g. Add Insurer) and comes back here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getMyUser()
        .then((u) => {
          if (!cancelled) setLicenceNumber(u?.licenceNumber ?? null);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const readAloudScript = READ_ALOUD_SCRIPT_TEMPLATE.replace(
    '(Licence Number)',
    licenceNumber ? licenceNumber : '(Licence Number)'
  );

  const hasVideo = videoUri !== null;

  const headline = hasVideo
    ? 'All set — review your video below.'
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

    // Fire-and-forget GPS at the moment recording starts, first take only — persists
    // across retakes (same pattern as report-accident's entry location in
    // app/(insurance)/index.tsx). Not awaited: recording shouldn't wait on a GPS fix.
    void loadDrunkTestEntryMeta().then((existing) => {
      if (existing) return;
      void captureLocationSnapshot().then((meta) => {
        void saveDrunkTestEntryMeta(meta);
      });
    });

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
          // Persist directly, not via the videoUri effect — that effect never runs
          // if the screen was left mid-recording, and the take would be lost.
          await saveDrunkTestState({ videoUri: storedUri });
          setVideoUri(storedUri);
          if (previousUri && previousUri !== storedUri) {
            void deleteDrunkTestVideo(previousUri);
          }
          // Tag the stored video file with the same start-of-recording location saved
          // above, keyed by its final URI — postOriginalMedia's existing loadPhotoGps(uri)
          // call picks this up automatically and includes it as R2 object metadata, same
          // as guided-capture photos. Without this, the location only ever reached the
          // captures row (drunk_test_start_*), never the R2 object itself.
          void loadDrunkTestEntryMeta().then((meta) => {
            if (meta && meta.latitude !== null && meta.longitude !== null) {
              void savePhotoGps(storedUri, {
                lat: meta.latitude,
                lng: meta.longitude,
                accuracy: meta.accuracyMeters,
                capturedAt: meta.capturedAtIso,
              });
            }
          });
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

  if (isLocked) {
    // Already submitted — no camera/mic needed at all, just let the driver replay
    // the video that was actually sent with the claim.
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
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

          <Text style={styles.headline}>Already submitted with your claim</Text>
          <Text style={styles.subtitle}>This video was sent with your claim and can&apos;t be re-recorded.</Text>

          {videoUri ? (
            <Pressable
              style={({ pressed }) => [styles.lockedVideoTile, pressed && styles.pressed]}
              onPress={() => void playSavedVideo()}
              accessibilityRole="button"
              accessibilityLabel="Play saved video">
              <Icon name="Play" size={28} color={WHITE} />
              <Text style={styles.cornerVideoLabel}>Play video</Text>
              <Text style={styles.cornerVideoSub}>{RECORD_DURATION_SEC}s clip</Text>
            </Pressable>
          ) : null}

          <View style={styles.buttonRow}>
            <View style={styles.primaryButtonWrap}>
              <CaptureButton title="Close" variant="primary" onPress={() => router.back()} />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

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
          {/* Once the OS refuses to ask again, requestPermission() resolves without showing
              anything — the button has to send the driver to Settings instead of doing nothing. */}
          <Pressable
            style={styles.permissionButton}
            onPress={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings())}>
            <Text style={styles.permissionButtonText}>
              {permission.canAskAgain ? 'Grant Camera Permission' : 'Open Settings'}
            </Text>
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
            <Pressable
              style={styles.permissionButton}
              onPress={() =>
                void (micPermission.canAskAgain ? requestMicPermission() : Linking.openSettings())
              }>
              <Text style={styles.permissionButtonText}>
                {micPermission.canAskAgain ? 'Grant Microphone Permission' : 'Open Settings'}
              </Text>
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

  const takeVideoDisabled =
    isRecording ||
    !isCameraReady ||
    Platform.OS === 'web' ||
    (Platform.OS === 'android' && !micPermission?.granted);

  const primaryTitle = isRecording
    ? ' '
    : hasVideo
      ? 'Continue'
      : !isCameraReady
        ? 'Preparing camera…'
        : Platform.OS === 'web'
          ? 'Video (device only)'
          : 'Take Video';

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
              <Text style={styles.readAloudText}>{readAloudScript}</Text>
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.cameraSquare}>
          <CameraView
            style={styles.camera}
            facing="front"
            mode="video"
            // Without this, the live preview shows the natural mirrored
            // ("looking in a mirror") view while recording, but the saved file
            // itself comes out un-mirrored — flipped relative to what the
            // driver actually saw and expects when they play it back.
            mirror={true}
            mute={!recordWithMic}
            ref={cameraRef}
            onCameraReady={() => setIsCameraReady(true)}
          />
          {isRecording && remainingSeconds !== null ? (
            <View style={styles.recordingBar} pointerEvents="none">
              <View style={styles.recordingBadgeRow}>
                <RecordingDot />
                <Text style={styles.recordingBadgeText}>Recording</Text>
              </View>
              <Text style={styles.recordingBarText}>{remainingSeconds}s left</Text>
              <Text style={styles.recordingBarHint}>Stay in frame till the countdown finishes.</Text>
            </View>
          ) : null}
          {hasVideo ? (
            <View style={styles.cornerAnchor}>
              <View style={styles.cornerPreviewTile}>
                <Pressable
                  style={({ pressed }) => [StyleSheet.absoluteFill, pressed && styles.pressed]}
                  accessibilityLabel="Play saved video"
                  onPress={() => void playSavedVideo()}>
                  <View style={styles.cornerPreviewTileContent}>
                    <Text style={styles.cornerVideoLabel}>Play</Text>
                    <Text style={styles.cornerVideoSub}>{RECORD_DURATION_SEC}s clip</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.retakeBadge, pressed && styles.retakeBadgePressed]}
                  onPress={() => setIsResetDialogVisible(true)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Retake video">
                  <Icon name="RotateCcw" size={12} color={CAPTURE_ACTION_BLUE} />
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.buttonRow}>
          <View style={styles.primaryButtonWrap}>
            <CaptureButton
              title={primaryTitle}
              variant="primary"
              disabled={hasVideo ? false : takeVideoDisabled}
              onPress={() => {
                if (hasVideo) {
                  // dismissTo, not replace — returns to the existing Insurance screen
                  // instead of stacking a new duplicate on top of it.
                  router.dismissTo('/(insurance)');
                } else {
                  void startRecording();
                }
              }}
            />
            {isRecording ? <ActivityIndicator style={styles.buttonSpinner} color={WHITE} /> : null}
          </View>
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
    paddingBottom: 8,
    gap: 5,
  },
  header: {
    paddingTop: 8,
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
    fontSize: CAPTURE_TYPE_HEADLINE_SIZE,
    fontWeight: CAPTURE_TYPE_HEADLINE_WEIGHT,
    color: COLORS.text,
    lineHeight: 28,
    marginTop: 12,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textMuted,
    lineHeight: 22,
    marginBottom: 8,
  },
  readAloudBox: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 15,
    padding: 15,
    backgroundColor: CAPTURE_ACTION_BLUE_SOFT,
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
  lockedVideoTile: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: INSURANCE_VIDEO_TILE_BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 12,
  },
  cameraSquare: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: INSURANCE_CAMERA_PLACEHOLDER_BG,
    position: 'relative',
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
    backgroundColor: 'rgba(255, 255, 255, 0.60)',
    gap: 4,
  },
  recordingBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: CAPTURE_REC_BADGE_BG,
  },
  recordingBadgeText: {
    color: CAPTURE_REC_BADGE_BG,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
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
    fontWeight: '700',
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
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GRAY_900,
    backgroundColor: INSURANCE_VIDEO_TILE_BG,
    position: 'relative',
    shadowColor: INSURANCE_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  cornerPreviewTileContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  retakeBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: WHITE,
    shadowColor: INSURANCE_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retakeBadgePressed: {
    opacity: 0.8,
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
  primaryButtonWrap: {
    width: '100%',
    position: 'relative',
  },
  buttonSpinner: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
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
