import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useMemo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@components/ui/icon';
import { CaptureButton } from '@/features/guided-capture/components/capture-button';
import { ResetCaptureDialog } from '@/features/guided-capture/components/reset-capture-dialog';
import {
  deleteDrivingLicencePhotos,
  loadDrivingLicenceState,
  persistDrivingLicencePhoto,
  saveDrivingLicenceState,
} from '@/features/driving-licence/storage/driving-licence-store';
import { snapAndSavePhotoGps } from '@/lib/snap-photo-gps';
import { appendUniqueUri } from '@/lib/uri-utils';
import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_SOFT,
  CAPTURE_TYPE_HEADLINE_SIZE,
  CAPTURE_TYPE_HEADLINE_WEIGHT,
  CAPTURE_TYPE_LABEL_SIZE,
  CAPTURE_TYPE_LABEL_WEIGHT,
  CAPTURE_VALID_BORDER,
  GRAY_900,
  INSURANCE_BORDER,
  INSURANCE_CAMERA_PLACEHOLDER_BG,
  INSURANCE_CTA_LINK,
  INSURANCE_PRIMARY,
  INSURANCE_SCREEN_BG,
  INSURANCE_SHADOW_COLOR,
  INSURANCE_TEXT,
  INSURANCE_TEXT_DIM,
  INSURANCE_TEXT_MUTED,
  INSURANCE_THUMBNAIL_BG,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';

type LicenceSide = 'front' | 'back' | 'selfie';

const SIDE_STOP_INDEX: Record<LicenceSide, number> = { front: 0, back: 1, selfie: 2 };
const SIDE_LABELS: Record<LicenceSide, string> = { front: 'Front', back: 'Back', selfie: 'Selfie' };

/** Small "Step N of M" pill, local to this screen only — deliberately not shared with the
 * Guided Capture flow's own progress component so this screen stays self-contained. Switches
 * to a distinct completed/review look once every photo is captured, instead of still reading
 * "Step 3 of 3" as if mid-step. */
function StepProgressPill({ side, completed }: { side: LicenceSide; completed: boolean }) {
  if (completed) {
    return (
      <View style={[styles.stepPill, styles.stepPillDone]}>
        <Icon name="Check" size={13} color={WHITE} />
        <Text style={[styles.stepPillText, styles.stepPillDoneText]}>Done</Text>
      </View>
    );
  }
  return (
    <View style={styles.stepPill}>
      <Text style={styles.stepPillText}>{`Step ${SIDE_STOP_INDEX[side] + 1} of 3 • ${SIDE_LABELS[side]}`}</Text>
    </View>
  );
}

export default function DrivingLicencePhotoScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const cameraRef = useRef<CameraView>(null);
  const hydratedStoreRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [side, setSide] = useState<LicenceSide>('front');
  const [frontPreviewUri, setFrontPreviewUri] = useState<string | null>(null);
  const [backPreviewUri, setBackPreviewUri] = useState<string | null>(null);
  const [selfiePreviewUri, setSelfiePreviewUri] = useState<string | null>(null);
  const [libraryUris, setLibraryUris] = useState<string[]>([]);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [retakeConfirmTarget, setRetakeConfirmTarget] = useState<LicenceSide | null>(null);

  const cameraFacing = side === 'selfie' ? 'front' : 'back';

  // The native camera needs a moment to reinitialize when it actually switches physical
  // lens (front vs back) — calling takePictureAsync before it fires `onCameraReady` throws
  // "Camera is not ready yet", which is what surfaces as "Capture failed. Please try again."
  // The CameraView below stays mounted across steps (no `key`) so only a real facing change
  // needs a new ready signal, and the view itself never gets torn down and recreated.
  useEffect(() => {
    setIsCameraReady(false);
  }, [cameraFacing]);

  const allImagesCaptured =
    side === 'selfie' && selfiePreviewUri !== null && frontPreviewUri !== null && backPreviewUri !== null;

  const instructionHeadline = useMemo(() => {
    if (allImagesCaptured) {
      return 'All set — review your photos below.';
    }
    if (side === 'front') {
      return 'Take a photo of the front of your Driving Licence.';
    }
    if (side === 'back') {
      return 'Take a photo of the other side of your Driving Licence.';
    }
    return 'Take a selfie of yourself with holding the Driving Licence';
  }, [allImagesCaptured, side]);

  const showSelfieHint = side === 'selfie' && !selfiePreviewUri;

  const primaryLabel = allImagesCaptured ? 'Continue' : 'Take Photo';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await loadDrivingLicenceState();
      if (cancelled) {
        return;
      }
      setSide(state.side);
      setFrontPreviewUri(state.frontUri);
      setBackPreviewUri(state.backUri);
      setSelfiePreviewUri(state.selfieUri);
      setLibraryUris(state.libraryUris);
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
    void saveDrivingLicenceState({
      side,
      frontUri: frontPreviewUri,
      backUri: backPreviewUri,
      selfieUri: selfiePreviewUri,
      libraryUris,
    });
  }, [side, frontPreviewUri, backPreviewUri, selfiePreviewUri, libraryUris]);

  /** Retake a single already-captured photo: clear just that slot and its file, leave the
   * other two untouched, and reopen the camera on that step. */
  const retakeSide = (target: LicenceSide) => {
    const uriToDelete =
      target === 'front' ? frontPreviewUri : target === 'back' ? backPreviewUri : selfiePreviewUri;
    if (target === 'front') {
      setFrontPreviewUri(null);
    } else if (target === 'back') {
      setBackPreviewUri(null);
    } else {
      setSelfiePreviewUri(null);
    }
    if (uriToDelete) {
      setLibraryUris((prev) => prev.filter((u) => u !== uriToDelete));
      void deleteDrivingLicencePhotos([uriToDelete]);
    }
    setSide(target);
  };

  const takePhoto = async () => {
    const cam = cameraRef.current;
    if (!cam || isTakingPhoto || !isCameraReady) return;
    try {
      setIsTakingPhoto(true);
      const capturedAt = new Date().toISOString();
      const photo = await cam.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });
      const uri = photo?.uri;
      if (!uri) {
        Alert.alert('Capture failed', 'No image was saved. Please try again.');
        return;
      }
      let storedUri = uri;
      try {
        storedUri = await persistDrivingLicencePhoto(uri);
      } catch {
        storedUri = uri;
      }
      void snapAndSavePhotoGps(storedUri, capturedAt);

      if (side === 'front') {
        setFrontPreviewUri(storedUri);
        setLibraryUris((prev) => appendUniqueUri(prev, storedUri));
        setSide('back');
      } else if (side === 'back') {
        setBackPreviewUri(storedUri);
        setLibraryUris((prev) => appendUniqueUri(prev, storedUri));
        setSide('selfie');
      } else if (side === 'selfie') {
        setSelfiePreviewUri(storedUri);
        setLibraryUris((prev) => appendUniqueUri(prev, storedUri));
      }
    } catch {
      Alert.alert('Capture failed', 'Please try again.');
    } finally {
      setIsTakingPhoto(false);
    }
  };

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
          <Text style={styles.centerText}>Camera access is required to photograph your licence.</Text>
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

  const renderCornerThumb = (uri: string, target: LicenceSide) => (
    <View style={styles.cornerThumbWrap}>
      <View style={styles.cornerPreviewTile} accessibilityLabel={`${SIDE_LABELS[target]} of licence preview`}>
        <Image source={{ uri }} style={styles.cornerPreviewImage} resizeMode="cover" />
        <Pressable
          style={({ pressed }) => [styles.retakeBadge, pressed && styles.retakeBadgePressed]}
          onPress={() => setRetakeConfirmTarget(target)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Retake ${SIDE_LABELS[target].toLowerCase()} photo`}>
          <Icon name="RotateCcw" size={12} color={CAPTURE_ACTION_BLUE} />
        </Pressable>
      </View>
      <View style={styles.cornerThumbLabelPill}>
        <Text style={styles.cornerThumbLabelText}>{SIDE_LABELS[target]}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ResetCaptureDialog
        visible={retakeConfirmTarget != null}
        title="Retake Photo"
        message={
          retakeConfirmTarget
            ? `Clear the captured ${SIDE_LABELS[retakeConfirmTarget]} photo and take it again?`
            : ''
        }
        confirmLabel="Retake"
        onCancel={() => setRetakeConfirmTarget(null)}
        onConfirm={() => {
          const target = retakeConfirmTarget;
          setRetakeConfirmTarget(null);
          if (target) {
            retakeSide(target);
          }
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
              <Text style={styles.headerTitle}>Driving Licence Photo</Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTitle}>Driving Licence Photo</Text>
          )}
        </View>

        <StepProgressPill side={side} completed={allImagesCaptured} />

        <Animated.View key={side} entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)}>
          <Text style={styles.headline}>{instructionHeadline}</Text>
          <Text style={styles.subtitle}>
            This step is required by the insurance company. This will help us to validate you and your vehicle.
          </Text>
          {showSelfieHint ? (
            <Text style={styles.selfieHint}>
              Hold your driving licence up next to your face, both clearly visible.
            </Text>
          ) : null}
        </Animated.View>

        {/* Deliberately outside the keyed/fading block above: that `key={side}` makes React
            tear down and recreate everything inside it on every step, which was silently
            destroying and recreating the CameraView too (black preview + "camera not ready"
            capture failures). The camera frame must stay mounted for the whole flow. */}
        <View style={styles.cameraFrame}>
          <CameraView
            style={styles.cameraFill}
            facing={cameraFacing}
            mirror={true}
            ref={cameraRef}
            onCameraReady={() => setIsCameraReady(true)}
          />
          {side === 'back' && frontPreviewUri ? (
            <View style={styles.cornerAnchor}>{renderCornerThumb(frontPreviewUri, 'front')}</View>
          ) : null}
          {side === 'selfie' && frontPreviewUri && backPreviewUri ? (
            <View style={styles.cornerAnchor}>
              <View style={styles.cornerThumbsRow}>
                {renderCornerThumb(backPreviewUri, 'back')}
                {renderCornerThumb(frontPreviewUri, 'front')}
                {selfiePreviewUri ? renderCornerThumb(selfiePreviewUri, 'selfie') : null}
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.buttonRow}>
          <View style={styles.primaryButtonWrap}>
            <CaptureButton
              title={isTakingPhoto ? ' ' : primaryLabel}
              variant="primary"
              disabled={isTakingPhoto || (!allImagesCaptured && !isCameraReady)}
              onPress={() => {
                if (allImagesCaptured) {
                  // dismissTo, not replace — returns to the existing Insurance screen
                  // instead of stacking a new duplicate on top of it.
                  router.dismissTo('/(insurance)');
                } else {
                  void takePhoto();
                }
              }}
            />
            {isTakingPhoto ? (
              <ActivityIndicator style={styles.buttonSpinner} color={WHITE} />
            ) : null}
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
    paddingBottom: 28,
    gap: 14,
  },
  header: {
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
  stepPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: CAPTURE_ACTION_BLUE_SOFT,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  stepPillDone: {
    backgroundColor: CAPTURE_VALID_BORDER,
  },
  stepPillText: {
    color: CAPTURE_ACTION_BLUE,
    fontSize: CAPTURE_TYPE_LABEL_SIZE,
    fontWeight: CAPTURE_TYPE_LABEL_WEIGHT,
  },
  stepPillDoneText: {
    color: WHITE,
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
  selfieHint: {
    color: CAPTURE_ACTION_BLUE,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  cameraFrame: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    backgroundColor: INSURANCE_CAMERA_PLACEHOLDER_BG,
    position: 'relative',
    shadowColor: INSURANCE_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  cameraFill: {
    width: '100%',
    height: '100%',
  },
  cornerAnchor: {
    position: 'absolute',
    bottom: 10,
    right: 10,
  },
  cornerThumbsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cornerThumbWrap: {
    alignItems: 'center',
    gap: 4,
  },
  cornerThumbLabelPill: {
    backgroundColor: 'rgba(17, 17, 17, 0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cornerThumbLabelText: {
    color: WHITE,
    fontSize: 11,
    fontWeight: '600',
  },
  cornerPreviewTile: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GRAY_900,
    backgroundColor: INSURANCE_THUMBNAIL_BG,
    shadowColor: INSURANCE_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  cornerPreviewImage: {
    width: '100%',
    height: '100%',
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
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
    alignItems: 'center',
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
    backgroundColor: INSURANCE_PRIMARY,
    borderRadius: 8,
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
