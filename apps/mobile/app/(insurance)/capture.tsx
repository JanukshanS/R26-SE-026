import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import {
  BLACK,
  BORDER_LIGHT,
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_SOFT,
  CAPTURE_RESET_CANCEL_BORDER,
  CAPTURE_SCREEN_BG,
  CAPTURE_SCREEN_DARK_BG,
  CAPTURE_SURFACE_WHITE,
  CAPTURE_TEXT_WHITE,
  CAPTURE_THUMBNAIL_BG,
  CAPTURE_TYPE_HEADLINE_SIZE,
  CAPTURE_TYPE_HEADLINE_WEIGHT,
  GRAY_900,
  INSURANCE_BORDER,
  INSURANCE_SCREEN_BG,
  INSURANCE_TEXT,
  INSURANCE_TEXT_MUTED,
  INSURANCE_THUMBNAIL_BG,
} from '@/features/guided-capture/capture-ui-theme';
import {
  CaptureModalBackdrop,
  captureModalBackdropStyles,
  useCaptureModalOverlaySize,
} from '@/features/guided-capture/components/capture-modal-backdrop';
import { CaptureButton } from '@/features/guided-capture/components/capture-button';
import { CaptureFooter } from '@/features/guided-capture/components/capture-footer';
import { CaptureInstructions } from '@/features/guided-capture/components/capture-instructions';
import { CaptureOverlay } from '@/features/guided-capture/components/capture-overlay';
import { GuidanceBoundary } from '@/features/guided-capture/components/guidance-boundary';
import { OrbitProgress } from '@/features/guided-capture/components/orbit-progress';
import { PoseIllustration } from '@/features/guided-capture/components/pose-illustration';
import { ResetCaptureDialog } from '@/features/guided-capture/components/reset-capture-dialog';
import { STOP_TRANSITION_TARGET_DEG } from '@/features/guided-capture/constants';
import { useGuidedCapture } from '@/features/guided-capture/hooks/use-guided-capture';
import { useStopTransition } from '@/features/guided-capture/hooks/use-stop-transition';
import { captureStatusFor } from '@/features/guided-capture/tilt-status';
import { HEIGHT_STEPS, type HeightStep } from '@/features/guided-capture/types';
import { useT } from '@/lib/i18n';

const HEIGHT_STEP_LOWER_KEYS: Record<HeightStep, string> = {
  overhead: 'insurance.capture.poseOverheadLower',
  chest: 'insurance.capture.poseChestLower',
  waist: 'insurance.capture.poseWaistLower',
};

export default function GuidedCaptureScreen() {
  const t = useT();
  const router = useRouter();
  const navigation = useNavigation();
  const { locked } = useLocalSearchParams<{ locked?: string }>();
  const isLocked = locked === '1';
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const {
    phase,
    photos,
    photosByStop,
    stopCount,
    totalPhotosExpected,
    isRetake,
    pitchDeg,
    shutterUnlocked,
    isCapturing,
    statusMessage,
    captureButtonLabel,
    onCapture,
    onPoseReady,
    onMoveNextConfirmed,
    onRetake,
    onDeleteStop,
    autoCaptureEnabled,
    onToggleAutoCapture,
    onResetCapture,
    isResetDialogVisible,
    onCancelResetDialog,
    onConfirmResetDialog,
    isPreviewVisible,
    submitEnabled,
    onSubmitPhotos,
    onClosePreview,
  } = useGuidedCapture(cameraRef);

  const overlaySize = useCaptureModalOverlaySize();

  const stopIndices = useMemo(() => {
    const maxStopIndex = photos.reduce((m, p) => Math.max(m, p.stopIndex), stopCount - 1);
    return Array.from({ length: maxStopIndex + 1 }, (_, i) => i);
  }, [stopCount, photos]);
  const allCaptured = photos.length >= totalPhotosExpected;

  const onSubmitFinal = () => {
    onClosePreview();
    // dismissTo (not replace/push) pops back to the existing Insurance screen already
    // in the stack instead of stacking a new instance on top of it — otherwise each
    // completed step leaves a phantom duplicate that "< Insurance" has to click through.
    router.dismissTo('/(insurance)');
  };

  const [deleteConfirmStopIndex, setDeleteConfirmStopIndex] = useState<number | null>(null);
  const [instructionsVisible, setInstructionsVisible] = useState(false);

  const onDeleteStopPress = (stopIndex: number) => setDeleteConfirmStopIndex(stopIndex);
  const onCancelDeleteStop = () => setDeleteConfirmStopIndex(null);
  const onConfirmDeleteStop = () => {
    if (deleteConfirmStopIndex != null) {
      onDeleteStop(deleteConfirmStopIndex);
    }
    setDeleteConfirmStopIndex(null);
  };

  const { progress01: stopTransitionProgress01 } = useStopTransition({
    enabled: phase.kind === 'moveNext',
    targetDeg: STOP_TRANSITION_TARGET_DEG,
    onTargetReached: onMoveNextConfirmed,
  });

  const captureStatus = phase.kind === 'aiming' ? captureStatusFor(pitchDeg, phase.heightStep) : 'aligning';

  // The moment the last required stop is finished: show the intro screen once (same
  // walkthrough as the very first stop, plus a "required images captured" banner), then
  // — once the user comes back from it via the header/Next back-navigation, which returns
  // to this exact still-mounted screen instance rather than pushing a fresh one — show the
  // normal "keep walking" stops screen, now with both "I'm in position" and "Next Step".
  // State (not a ref) so the switch to the stops screen is committed to this instance's
  // render tree *before* navigating to the intro screen, not just on some later re-render —
  // otherwise coming back via router.back() would redisplay a stale "still hidden" frame.
  const requiredStopsJustDone = phase.kind === 'moveNext' && phase.completedStopIndex === stopCount - 1;
  const [shownRequiredDoneIntro, setShownRequiredDoneIntro] = useState(false);
  useEffect(() => {
    // Skipped when locked — this navigation is part of the live capture flow, not
    // relevant to a driver only viewing an already-submitted claim's photos.
    if (isLocked) return;
    if (requiredStopsJustDone && !shownRequiredDoneIntro) {
      setShownRequiredDoneIntro(true);
      router.push({ pathname: '/(insurance)/guided-capture-intro', params: { requiredDone: '1' } });
    }
  }, [requiredStopsJustDone, shownRequiredDoneIntro, router, isLocked]);
  const awaitingRequiredDoneIntro = requiredStopsJustDone && !shownRequiredDoneIntro;

  if (isLocked) {
    // Already submitted — no camera or in-flow "Captured Photos" sheet at all, just
    // a clean read-only screen matching the other three claim-step screens' own
    // locked view (driving licence / user verification / 3rd party details).
    return (
      <SafeAreaView style={styles.lockedSafe} edges={['top', 'left', 'right', 'bottom']}>
        <ScrollView
          style={styles.lockedScroll}
          contentContainerStyle={styles.lockedScrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.lockedHeader}>
            {navigation.canGoBack() ? (
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [styles.lockedHeaderBack, pressed && styles.pressed]}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('insurance.action.back')}>
                <View style={styles.lockedHeaderChevronWrap} collapsable={false}>
                  <Ionicons name="chevron-back" size={22} color={INSURANCE_TEXT} />
                </View>
                <Text style={styles.lockedHeaderTitle}>{t('insurance.captureIntro.titleShort')}</Text>
              </Pressable>
            ) : (
              <Text style={styles.lockedHeaderTitle}>{t('insurance.captureIntro.titleShort')}</Text>
            )}
          </View>

          <Text style={styles.lockedHeadline}>{t('insurance.licence.lockedTitle')}</Text>
          <Text style={styles.lockedSubtitle}>{t('insurance.licence.lockedBody')}</Text>

          {stopIndices.map((stopIndex) => {
            const stopPhotos = photosByStop.get(stopIndex);
            return (
              <View key={stopIndex} style={styles.lockedStopRow}>
                <Text style={styles.lockedStopLabel}>
                  {t('insurance.capture.stopLabel', { number: stopIndex + 1 })}
                </Text>
                <View style={styles.lockedStopTiles}>
                  {HEIGHT_STEPS.map((h) => {
                    const photo = stopPhotos?.find((p) => p.heightStep === h);
                    return (
                      <View key={h} style={styles.lockedTile}>
                        {photo ? (
                          <Image source={{ uri: photo.uri }} style={styles.lockedTileImage} />
                        ) : (
                          <View style={styles.lockedTileEmpty} />
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}

          <View style={styles.lockedButtonRow}>
            <CaptureButton
              title={t('insurance.action.close')}
              variant="primary"
              onPress={() => router.back()}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // The camera is never used in locked mode (handled above), so no permission is
  // needed at all in that case.
  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t('insurance.camera.checkingPermission')}</Text>
      </View>
    );
  }

  if (!permission.granted) {
    // Once the OS refuses to ask again, requestPermission() resolves without showing
    // anything — the button has to send the driver to Settings instead of doing nothing.
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t('insurance.capture.permissionBody')}</Text>
        <Pressable
          style={styles.permissionButton}
          onPress={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings())}>
          <Text style={styles.buttonText}>
            {permission.canAskAgain
              ? t('insurance.camera.grantPermission')
              : t('insurance.camera.openSettings')}
          </Text>
        </Pressable>
        <Pressable style={styles.textButton} onPress={() => router.back()}>
          <Text style={styles.textButtonLabel}>{t('insurance.action.back')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ResetCaptureDialog
        visible={isResetDialogVisible}
        title={t('insurance.capture.resetTitle')}
        message={t('insurance.capture.resetBody')}
        onCancel={onCancelResetDialog}
        onConfirm={onConfirmResetDialog}
      />

      {phase.kind === 'posing' ? (
        <Animated.View style={styles.phaseFill} entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)}>
          <PoseIllustration
            heightStep={phase.heightStep}
            stopIndex={phase.stopIndex}
            stopCount={stopCount}
            isRetake={isRetake}
            onReady={onPoseReady}
          />
        </Animated.View>
      ) : null}

      {phase.kind === 'moveNext' && !awaitingRequiredDoneIntro ? (
        <Animated.View style={styles.phaseFill} entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)}>
          <OrbitProgress
            completedStopIndex={phase.completedStopIndex}
            stopCount={stopCount}
            progress01={stopTransitionProgress01}
            onManualContinue={onMoveNextConfirmed}
            onNextStep={onSubmitFinal}
          />
        </Animated.View>
      ) : null}

      {phase.kind === 'aiming' ? (
        <Animated.View style={styles.phaseFill} entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)}>
          <CameraView style={styles.camera} facing="back" ref={cameraRef} />
          <GuidanceBoundary status={captureStatus} />
          <CaptureOverlay
            capturedCount={photos.length}
            totalExpected={totalPhotosExpected}
            status={captureStatus}
            statusMessage={statusMessage}
            submitEnabled={submitEnabled}
            autoCaptureEnabled={autoCaptureEnabled}
            onToggleAutoCapture={onToggleAutoCapture}
            onSubmitPhotos={onSubmitPhotos}
            onBackPress={() => router.back()}
            onResetCapture={onResetCapture}
            onShowInstructions={() => setInstructionsVisible(true)}
          />
          <CaptureFooter
            label={captureButtonLabel}
            disabled={!shutterUnlocked}
            isCapturing={isCapturing}
            onCapture={() => void onCapture()}
          />
        </Animated.View>
      ) : null}

      <Modal
        visible={isPreviewVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={onClosePreview}>
        <View
          style={[
            captureModalBackdropStyles.root,
            Platform.OS === 'web'
              ? captureModalBackdropStyles.rootWeb
              : { width: overlaySize.width, height: overlaySize.height },
          ]}>
          <CaptureModalBackdrop width={overlaySize.width} height={overlaySize.height} />
          <View style={styles.modalBackdropContent}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>{t('insurance.capture.previewTitle')}</Text>
                <Text style={styles.modalCount}>
                  ({photos.length}/{totalPhotosExpected})
                </Text>
              </View>

              <FlatList
                data={isPreviewVisible ? stopIndices : []}
                keyExtractor={(stopIndex) => `stop-${stopIndex}`}
                contentContainerStyle={styles.thumbnailList}
                renderItem={({ item: stopIndex }) => {
                  const stopPhotos = photosByStop.get(stopIndex);
                  return (
                    <View style={styles.stopRow}>
                      <View style={styles.stopRowHeader}>
                        <Text style={styles.stopRowLabel}>
                        {t('insurance.capture.stopLabel', { number: stopIndex + 1 })}
                      </Text>
                        {stopPhotos && stopPhotos.length > 0 ? (
                          <Pressable
                            style={styles.deleteIconBtn}
                            onPress={() => onDeleteStopPress(stopIndex)}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel={t('insurance.capture.deleteStopA11y', {
                              number: stopIndex + 1,
                            })}>
                            <Ionicons name="trash-outline" size={18} color={CAPTURE_ACTION_BLUE} />
                          </Pressable>
                        ) : null}
                      </View>
                      <View style={styles.stopRowTiles}>
                        {HEIGHT_STEPS.map((h) => {
                          const photo = stopPhotos?.find((p) => p.heightStep === h);
                          return (
                            <Pressable
                              key={h}
                              style={styles.tile}
                              disabled={!photo}
                              onPress={() => photo && onRetake(stopIndex, h)}
                              accessibilityRole="button"
                              accessibilityLabel={t('insurance.capture.retakePhotoA11y', {
                                pose: t(HEIGHT_STEP_LOWER_KEYS[h]),
                                number: stopIndex + 1,
                              })}>
                              {photo ? (
                                <Image source={{ uri: photo.uri }} style={styles.tileImage} />
                              ) : (
                                <View style={styles.tileEmpty} />
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                }}
              />

              <View style={styles.modalActions}>
                <Pressable
                  style={({ pressed }) => [styles.closeButtonOutlined, pressed && styles.closeButtonPressed]}
                  onPress={onClosePreview}>
                  <Text style={styles.closeButtonText}>{t('insurance.action.close')}</Text>
                </Pressable>
                {allCaptured ? (
                  <Pressable
                    style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed]}
                    onPress={onSubmitFinal}
                    accessibilityRole="button"
                    accessibilityLabel={t('insurance.capture.submitA11y')}>
                    <Text style={styles.submitButtonText}>{t('insurance.capture.submit')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {deleteConfirmStopIndex != null ? (
              <View style={styles.deleteConfirmScrim}>
                <View style={styles.deleteConfirmCard}>
                  <View style={styles.deleteConfirmIconCircle}>
                    <Ionicons name="trash-outline" size={30} color={CAPTURE_ACTION_BLUE} />
                  </View>
                  <Text style={styles.deleteConfirmTitle}>{t('insurance.capture.deleteStopTitle')}</Text>
                  <Text style={styles.deleteConfirmMessage}>
                    {t('insurance.capture.deleteStopBody', { number: deleteConfirmStopIndex + 1 })}
                  </Text>
                  <View style={styles.deleteConfirmActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.deleteConfirmCancelBtn,
                        pressed && styles.deleteConfirmPressed,
                      ]}
                      onPress={onCancelDeleteStop}>
                      <Text style={styles.deleteConfirmCancelText}>{t('insurance.action.cancel')}</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.deleteConfirmDeleteBtn,
                        pressed && styles.deleteConfirmPressed,
                      ]}
                      onPress={onConfirmDeleteStop}>
                      <Text style={styles.deleteConfirmDeleteText}>{t('insurance.action.delete')}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={instructionsVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setInstructionsVisible(false)}>
        <View style={styles.instructionsBackdrop}>
          <View style={styles.instructionsCard}>
            <View style={styles.instructionsHeaderRow}>
              <Text style={styles.instructionsTitle}>{t('insurance.capture.menuHowTo')}</Text>
              <Pressable
                style={({ pressed }) => [styles.instructionsCloseBtn, pressed && styles.closeButtonPressed]}
                onPress={() => setInstructionsVisible(false)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('insurance.capture.closeInstructionsA11y')}>
                <Ionicons name="close" size={22} color={GRAY_900} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.instructionsScrollContent} showsVerticalScrollIndicator={false}>
              <CaptureInstructions />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CAPTURE_SCREEN_BG,
  },
  camera: {
    flex: 1,
  },
  phaseFill: {
    flex: 1,
  },
  permissionButton: {
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 12,
  },
  buttonText: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '700',
    fontSize: 16,
  },
  textButton: {
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  textButtonLabel: {
    color: CAPTURE_TEXT_WHITE,
    fontSize: 16,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CAPTURE_SCREEN_DARK_BG,
    paddingHorizontal: 24,
  },
  text: {
    color: CAPTURE_TEXT_WHITE,
    textAlign: 'center',
    fontSize: 16,
  },
  modalBackdropContent: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  modalCard: {
    backgroundColor: CAPTURE_SURFACE_WHITE,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    padding: 16,
    maxHeight: '72%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#d0d0d0',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    color: CAPTURE_ACTION_BLUE,
    fontSize: 16,
    fontWeight: '600',
  },
  modalCount: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '600',
  },
  thumbnailList: {
    paddingBottom: 8,
  },
  stopRow: {
    marginBottom: 14,
  },
  stopRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  stopRowLabel: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteIconBtn: {
    padding: 2,
  },
  stopRowTiles: {
    flexDirection: 'row',
    gap: 8,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  tileImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#111111',
    backgroundColor: CAPTURE_THUMBNAIL_BG,
  },
  tileEmpty: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderStyle: 'dashed',
    backgroundColor: '#f0f0f0',
  },
  modalActions: {
    marginTop: 16,
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  submitButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CAPTURE_ACTION_BLUE,
  },
  submitButtonPressed: {
    opacity: 0.9,
  },
  submitButtonText: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '700',
    fontSize: 16,
  },
  closeButtonOutlined: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: CAPTURE_RESET_CANCEL_BORDER,
  },
  closeButtonPressed: {
    opacity: 0.85,
  },
  closeButtonText: {
    color: CAPTURE_ACTION_BLUE,
    fontWeight: '700',
    fontSize: 16,
  },
  deleteConfirmScrim: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 5,
  },
  deleteConfirmCard: {
    backgroundColor: CAPTURE_SURFACE_WHITE,
    borderRadius: 15,
    padding: 20,
    borderWidth: 1,
    width: '104%',
    borderColor: BORDER_LIGHT,
  },
  deleteConfirmIconCircle: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: CAPTURE_ACTION_BLUE_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  deleteConfirmTitle: {
    color: BLACK,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  deleteConfirmMessage: {
    color: GRAY_900,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 22,
  },
  deleteConfirmActions: {
    flexDirection: 'row',
    gap: 10,
  },
  deleteConfirmCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: CAPTURE_RESET_CANCEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteConfirmDeleteBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 5,
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderWidth: 2,
    borderColor: CAPTURE_ACTION_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteConfirmPressed: {
    opacity: 0.88,
  },
  deleteConfirmCancelText: {
    color: CAPTURE_ACTION_BLUE,
    fontWeight: '700',
    fontSize: 15,
  },
  deleteConfirmDeleteText: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '800',
    fontSize: 15,
  },
  instructionsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  instructionsCard: {
    backgroundColor: CAPTURE_SURFACE_WHITE,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    paddingTop: 16,
    paddingHorizontal: 20,
    maxHeight: '88%',
  },
  instructionsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  instructionsTitle: {
    color: GRAY_900,
    fontSize: 18,
    fontWeight: '700',
  },
  instructionsCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionsScrollContent: {
    paddingBottom: 28,
  },
  lockedSafe: {
    flex: 1,
    backgroundColor: INSURANCE_SCREEN_BG,
  },
  lockedScroll: {
    flex: 1,
  },
  lockedScrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  lockedHeader: {
    paddingTop: 45,
  },
  lockedHeaderBack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingBottom: 4,
    paddingRight: 8,
  },
  lockedHeaderChevronWrap: {
    width: 28,
    height: 28,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  lockedHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: INSURANCE_TEXT,
    flexShrink: 0,
  },
  pressed: {
    opacity: 0.65,
  },
  lockedHeadline: {
    fontSize: CAPTURE_TYPE_HEADLINE_SIZE,
    fontWeight: CAPTURE_TYPE_HEADLINE_WEIGHT,
    color: INSURANCE_TEXT,
    lineHeight: 28,
    marginTop: 2,
  },
  lockedSubtitle: {
    fontSize: 16,
    color: INSURANCE_TEXT_MUTED,
    lineHeight: 22,
  },
  lockedStopRow: {
    gap: 8,
  },
  lockedStopLabel: {
    color: INSURANCE_TEXT,
    fontSize: 14,
    fontWeight: '700',
  },
  lockedStopTiles: {
    flexDirection: 'row',
    gap: 8,
  },
  lockedTile: {
    flex: 1,
  },
  lockedTileImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INSURANCE_BORDER,
    backgroundColor: INSURANCE_THUMBNAIL_BG,
  },
  lockedTileEmpty: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INSURANCE_BORDER,
    borderStyle: 'dashed',
    backgroundColor: INSURANCE_THUMBNAIL_BG,
  },
  lockedButtonRow: {
    marginTop: 8,
  },
});
