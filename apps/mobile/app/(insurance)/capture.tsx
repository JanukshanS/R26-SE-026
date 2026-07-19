import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  BLACK,
  BORDER_LIGHT,
  CAPTURE_ACTION_BLUE,
  CAPTURE_RESET_CANCEL_BORDER,
  CAPTURE_SCREEN_BG,
  CAPTURE_SCREEN_DARK_BG,
  CAPTURE_SURFACE_WHITE,
  CAPTURE_TEXT_WHITE,
  CAPTURE_THUMBNAIL_BG,
  GRAY_900,
} from '@/features/guided-capture/capture-ui-theme';
import {
  CaptureModalBackdrop,
  captureModalBackdropStyles,
  useCaptureModalOverlaySize,
} from '@/features/guided-capture/components/capture-modal-backdrop';
import { CaptureFooter } from '@/features/guided-capture/components/capture-footer';
import { CaptureOverlay } from '@/features/guided-capture/components/capture-overlay';
import { GuidanceBoundary } from '@/features/guided-capture/components/guidance-boundary';
import { OrbitProgress } from '@/features/guided-capture/components/orbit-progress';
import { PoseIllustration } from '@/features/guided-capture/components/pose-illustration';
import { ResetCaptureDialog } from '@/features/guided-capture/components/reset-capture-dialog';
import { STOP_TRANSITION_TARGET_DEG } from '@/features/guided-capture/constants';
import { useGuidedCapture } from '@/features/guided-capture/hooks/use-guided-capture';
import { useStopTransition } from '@/features/guided-capture/hooks/use-stop-transition';
import { tiltHintFor } from '@/features/guided-capture/tilt-status';
import { HEIGHT_STEPS } from '@/features/guided-capture/types';

export default function GuidedCaptureScreen() {
  const router = useRouter();
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
    tiltAligned,
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
    router.replace('/(insurance)');
  };

  const [deleteConfirmStopIndex, setDeleteConfirmStopIndex] = useState<number | null>(null);

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

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Checking camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera access is required for guided capture.</Text>
        <Pressable style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Camera Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ResetCaptureDialog
        visible={isResetDialogVisible}
        title="Reset This Claim"
        message="This will delete all photos and reset Guided Capture, Driving Licence, User Verification, and 3rd Party Details. You'll start the whole claim over."
        onCancel={onCancelResetDialog}
        onConfirm={onConfirmResetDialog}
      />

      {phase.kind === 'posing' ? (
        <PoseIllustration
          heightStep={phase.heightStep}
          stopIndex={phase.stopIndex}
          stopCount={Math.max(stopCount, phase.stopIndex + 1)}
          isRetake={isRetake}
          onReady={onPoseReady}
        />
      ) : null}

      {phase.kind === 'moveNext' ? (
        <OrbitProgress
          completedStopIndex={phase.completedStopIndex}
          stopCount={stopCount}
          progress01={stopTransitionProgress01}
          onManualContinue={onMoveNextConfirmed}
        />
      ) : null}

      {phase.kind === 'aiming' ? (
        <>
          <CameraView style={styles.camera} facing="back" ref={cameraRef} />
          <GuidanceBoundary tiltAligned={tiltAligned} tiltHint={tiltHintFor(pitchDeg, phase.heightStep)} />
          <CaptureOverlay
            capturedCount={photos.length}
            totalExpected={totalPhotosExpected}
            statusMessage={statusMessage}
            submitEnabled={submitEnabled}
            autoCaptureEnabled={autoCaptureEnabled}
            onToggleAutoCapture={onToggleAutoCapture}
            onSubmitPhotos={onSubmitPhotos}
            onBackPress={() => router.back()}
            onResetCapture={onResetCapture}
          />
          <CaptureFooter
            label={captureButtonLabel}
            disabled={!shutterUnlocked}
            isCapturing={isCapturing}
            onCapture={() => void onCapture()}
          />
        </>
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
                <Text style={styles.modalTitle}>Captured Photos</Text>
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
                        <Text style={styles.stopRowLabel}>STOP {stopIndex + 1}</Text>
                        {stopPhotos && stopPhotos.length > 0 ? (
                          <Pressable
                            style={styles.deleteIconBtn}
                            onPress={() => onDeleteStopPress(stopIndex)}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete all photos for stop ${stopIndex + 1}`}>
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
                              accessibilityLabel={`Retake ${h} photo, stop ${stopIndex + 1}`}>
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
                  <Text style={styles.closeButtonText}>Close</Text>
                </Pressable>
                {allCaptured ? (
                  <Pressable
                    style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed]}
                    onPress={onSubmitFinal}
                    accessibilityRole="button"
                    accessibilityLabel="Submit photos">
                    <Text style={styles.submitButtonText}>Submit</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {deleteConfirmStopIndex != null ? (
              <View style={styles.deleteConfirmScrim}>
                <View style={styles.deleteConfirmCard}>
                  <Text style={styles.deleteConfirmTitle}>Delete Stop</Text>
                  <Text style={styles.deleteConfirmMessage}>
                    {`Delete all photos for Stop ${deleteConfirmStopIndex + 1}? This can't be undone.`}
                  </Text>
                  <View style={styles.deleteConfirmActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.deleteConfirmCancelBtn,
                        pressed && styles.deleteConfirmPressed,
                      ]}
                      onPress={onCancelDeleteStop}>
                      <Text style={styles.deleteConfirmCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.deleteConfirmDeleteBtn,
                        pressed && styles.deleteConfirmPressed,
                      ]}
                      onPress={onConfirmDeleteStop}>
                      <Text style={styles.deleteConfirmDeleteText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
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
    width: '100%',
    borderColor: BORDER_LIGHT,
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
    borderRadius: 5,
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
});
