import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@components/ui/icon';
import { CaptureButton } from '@/features/guided-capture/components/capture-button';
import { ResetCaptureDialog } from '@/features/guided-capture/components/reset-capture-dialog';
import {
  deleteThirdPartyPhotos,
  loadThirdPartyState,
  nextStepAfterCapture,
  persistThirdPartyPhoto,
  saveThirdPartyState,
  type ThirdPartyCaptureStep,
} from '@/features/third-party/storage/third-party-store';
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

const STEP_INDEX: Record<ThirdPartyCaptureStep, number> = { driverFront: 0, driverBack: 1, revenue: 2 };
const STEP_LABELS: Record<ThirdPartyCaptureStep, string> = {
  driverFront: 'Driver Licence (Front)',
  driverBack: 'Driver Licence (Back)',
  revenue: 'Revenue Licence',
};
const STEP_SHORT_LABELS: Record<ThirdPartyCaptureStep, string> = {
  driverFront: 'Front',
  driverBack: 'Back',
  revenue: 'Revenue',
};

/** Small "Step N of M" pill, local to this screen only — same visual system as the Driving
 * Licence flow's step pill, kept self-contained rather than shared to leave the Guided Capture
 * flow's own components untouched. */
function StepProgressPill({ step, completed }: { step: ThirdPartyCaptureStep; completed: boolean }) {
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
      <Text style={styles.stepPillText}>{`Step ${STEP_INDEX[step] + 1} of 3 • ${STEP_LABELS[step]}`}</Text>
    </View>
  );
}

export default function ThirdPartyDetailsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { locked } = useLocalSearchParams<{ locked?: string }>();
  const isLocked = locked === '1';
  const cameraRef = useRef<CameraView>(null);
  const hydratedStoreRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<ThirdPartyCaptureStep>('driverFront');
  const [driverLicenceFrontUri, setDriverLicenceFrontUri] = useState<string | null>(null);
  const [driverLicenceBackUri, setDriverLicenceBackUri] = useState<string | null>(null);
  const [revenueLicenceUri, setRevenueLicenceUri] = useState<string | null>(null);
  const [notApplicable, setNotApplicable] = useState(false);
  const [libraryUris, setLibraryUris] = useState<string[]>([]);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [retakeConfirmTarget, setRetakeConfirmTarget] = useState<ThirdPartyCaptureStep | null>(null);
  const [notApplicableConfirmVisible, setNotApplicableConfirmVisible] = useState(false);
  // Facing is always 'back' on this screen and the CameraView below is never remounted
  // (no `key`), so this only needs to flip true once, the first time the camera signals
  // ready — calling takePictureAsync before that throws "Camera is not ready yet", which is
  // what was surfacing as "Capture failed. Please try again." on later steps.
  const [isCameraReady, setIsCameraReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const thirdState = await loadThirdPartyState();
      if (cancelled) {
        return;
      }
      setStep(thirdState.step);
      setDriverLicenceFrontUri(thirdState.driverLicenceFrontUri);
      setDriverLicenceBackUri(thirdState.driverLicenceBackUri);
      setRevenueLicenceUri(thirdState.revenueLicenceUri);
      setNotApplicable(thirdState.notApplicable);
      setLibraryUris(thirdState.libraryUris);
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
    void saveThirdPartyState({
      step,
      driverLicenceFrontUri,
      driverLicenceBackUri,
      revenueLicenceUri,
      notApplicable,
      libraryUris,
    });
  }, [step, driverLicenceFrontUri, driverLicenceBackUri, revenueLicenceUri, notApplicable, libraryUris]);

  const allImagesCaptured =
    driverLicenceFrontUri != null && driverLicenceBackUri != null && revenueLicenceUri != null;

  const headline = useMemo(() => {
    if (allImagesCaptured) {
      return 'All set — review your photos below.';
    }
    if (step === 'driverFront') {
      return "Take an image of the 3rd party vehicle's Driver Licence.";
    }
    if (step === 'driverBack') {
      return "Take an image of the other side of the 3rd party vehicle's Driver Licence.";
    }
    return "Take an image of the 3rd party vehicle's revenue licence.";
  }, [allImagesCaptured, step]);

  const hasAnyPhoto =
    driverLicenceFrontUri != null || driverLicenceBackUri != null || revenueLicenceUri != null;

  /** Retake a single already-captured document: clear just that slot and its file, leave the
   * others untouched, and reopen the camera on that step — same pattern as the Driving
   * Licence flow's per-thumbnail retake. */
  const retakeStep = (target: ThirdPartyCaptureStep) => {
    const uriToDelete =
      target === 'driverFront'
        ? driverLicenceFrontUri
        : target === 'driverBack'
          ? driverLicenceBackUri
          : revenueLicenceUri;
    if (target === 'driverFront') {
      setDriverLicenceFrontUri(null);
    } else if (target === 'driverBack') {
      setDriverLicenceBackUri(null);
    } else {
      setRevenueLicenceUri(null);
    }
    if (uriToDelete) {
      setLibraryUris((prev) => prev.filter((u) => u !== uriToDelete));
      void deleteThirdPartyPhotos([uriToDelete]);
    }
    setStep(target);
  };

  const onTakePhoto = async () => {
    const cam = cameraRef.current;
    if (!cam || isTakingPhoto || !isCameraReady) {
      return;
    }
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
        storedUri = await persistThirdPartyPhoto(uri);
      } catch {
        storedUri = uri;
      }
      void snapAndSavePhotoGps(storedUri, capturedAt);
      setNotApplicable(false);
      setLibraryUris((prev) => appendUniqueUri(prev, storedUri));

      if (step === 'driverFront') {
        setDriverLicenceFrontUri(storedUri);
        setStep(nextStepAfterCapture('driverFront'));
      } else if (step === 'driverBack') {
        setDriverLicenceBackUri(storedUri);
        setStep(nextStepAfterCapture('driverBack'));
      } else {
        setRevenueLicenceUri(storedUri);
      }
    } catch {
      Alert.alert('Capture failed', 'Please try again.');
    } finally {
      setIsTakingPhoto(false);
    }
  };

  const onNotApplicable = () => {
    if (hasAnyPhoto) {
      return;
    }
    setNotApplicableConfirmVisible(true);
  };

  const confirmNotApplicable = () => {
    setNotApplicableConfirmVisible(false);
    void (async () => {
      await saveThirdPartyState({
        step: 'driverFront',
        driverLicenceFrontUri: null,
        driverLicenceBackUri: null,
        revenueLicenceUri: null,
        notApplicable: true,
        libraryUris: [],
      });
      router.back();
    })();
  };

  const primaryLabel = allImagesCaptured ? 'Continue' : 'Take Photo';
  // Hides the "Not Applicable" option once any document is captured, rather than leaving a
  // dead, greyed-out button on screen — the underlying guard (onNotApplicable's early return
  // when hasAnyPhoto) is unchanged; this only affects whether we render it at all.
  const showNotApplicable = !hasAnyPhoto && !notApplicable;

  if (isLocked) {
    const lockedPhotos: { uri: string; label: string }[] = [];
    if (driverLicenceFrontUri) lockedPhotos.push({ uri: driverLicenceFrontUri, label: 'Driver Licence (Front)' });
    if (driverLicenceBackUri) lockedPhotos.push({ uri: driverLicenceBackUri, label: 'Driver Licence (Back)' });
    if (revenueLicenceUri) lockedPhotos.push({ uri: revenueLicenceUri, label: 'Revenue Licence' });
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
                <Text style={styles.headerTitle}>3rd Party Details</Text>
              </Pressable>
            ) : (
              <Text style={styles.headerTitle}>3rd Party Details</Text>
            )}
          </View>

          <Text style={styles.headline}>Already submitted with your claim</Text>
          <Text style={styles.subtitle}>
            {notApplicable
              ? 'This step was marked not applicable for this claim.'
              : "These photos were sent with your claim and can't be retaken."}
          </Text>

          {lockedPhotos.length > 0 ? (
            <View style={styles.lockedPhotoRow}>
              {lockedPhotos.map((p) => (
                <View key={p.label} style={styles.lockedPhotoTile}>
                  <Image source={{ uri: p.uri }} style={styles.lockedPhotoImage} resizeMode="cover" />
                  <Text style={styles.lockedPhotoLabel}>{p.label}</Text>
                </View>
              ))}
            </View>
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
          <Text style={styles.centerText}>
            Camera access is required to photograph the third party&apos;s licence and revenue licence.
          </Text>
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

  const renderCornerThumb = (uri: string, target: ThirdPartyCaptureStep) => (
    <View style={styles.cornerThumbWrap}>
      <View style={styles.cornerPreviewTile} accessibilityLabel={`${STEP_LABELS[target]} preview`}>
        <Image source={{ uri }} style={styles.cornerPreviewImage} resizeMode="cover" />
        <Pressable
          style={({ pressed }) => [styles.retakeBadge, pressed && styles.retakeBadgePressed]}
          onPress={() => setRetakeConfirmTarget(target)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Retake ${STEP_LABELS[target].toLowerCase()}`}>
          <Icon name="RotateCcw" size={12} color={CAPTURE_ACTION_BLUE} />
        </Pressable>
      </View>
      <View style={styles.cornerThumbLabelPill}>
        <Text style={styles.cornerThumbLabelText}>{STEP_SHORT_LABELS[target]}</Text>
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
            ? `Clear the captured ${STEP_LABELS[retakeConfirmTarget]} photo and take it again?`
            : ''
        }
        confirmLabel="Retake"
        onCancel={() => setRetakeConfirmTarget(null)}
        onConfirm={() => {
          const target = retakeConfirmTarget;
          setRetakeConfirmTarget(null);
          if (target) {
            retakeStep(target);
          }
        }}
      />
      <ResetCaptureDialog
        visible={notApplicableConfirmVisible}
        title="Not Applicable?"
        message="Use this only if there is no third-party vehicle or documents to photograph. You can complete these photos later from this step."
        confirmLabel="Confirm"
        icon="Ban"
        onCancel={() => setNotApplicableConfirmVisible(false)}
        onConfirm={confirmNotApplicable}
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
              <Text style={styles.headerTitle}>3rd Party Details</Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTitle}>3rd Party Details</Text>
          )}
        </View>

        <StepProgressPill step={step} completed={allImagesCaptured} />

        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.subtitle}>This step is required by the insurance company for all third-party cases.</Text>

        <View style={styles.cameraFrame}>
          <CameraView
            ref={cameraRef}
            style={styles.cameraFill}
            facing="back"
            onCameraReady={() => setIsCameraReady(true)}
          />
          {step === 'driverBack' && driverLicenceFrontUri ? (
            <View style={styles.cornerAnchor}>{renderCornerThumb(driverLicenceFrontUri, 'driverFront')}</View>
          ) : null}
          {step === 'revenue' && driverLicenceFrontUri && driverLicenceBackUri ? (
            <View style={styles.cornerAnchor}>
              <View style={styles.cornerThumbsRow}>
                {renderCornerThumb(driverLicenceBackUri, 'driverBack')}
                {renderCornerThumb(driverLicenceFrontUri, 'driverFront')}
                {revenueLicenceUri ? renderCornerThumb(revenueLicenceUri, 'revenue') : null}
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
                  void onTakePhoto();
                }
              }}
            />
            {isTakingPhoto ? <ActivityIndicator style={styles.buttonSpinner} color={WHITE} /> : null}
          </View>
        </View>

        {showNotApplicable ? (
          <Pressable
            style={({ pressed }) => [styles.notApplicableWrap, pressed && styles.pressed]}
            onPress={onNotApplicable}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Not applicable — no third-party vehicle or documents">
            <Text style={styles.notApplicableText}>Not Applicable</Text>
          </Pressable>
        ) : null}
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
    paddingTop: 50,
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
    marginTop: 2,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textMuted,
    lineHeight: 22,
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
  notApplicableWrap: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  notApplicableText: {
    color: INSURANCE_CTA_LINK,
    fontSize: 15,
    fontWeight: '600',
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
  lockedPhotoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  lockedPhotoTile: {
    width: '31%',
    gap: 6,
  },
  lockedPhotoImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: INSURANCE_THUMBNAIL_BG,
  },
  lockedPhotoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
