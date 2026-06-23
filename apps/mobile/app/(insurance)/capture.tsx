import { CameraView, useCameraPermissions } from 'expo-camera';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';
import {
  Dimensions,
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
  CAPTURE_ACTION_BLUE,
  CAPTURE_SCREEN_BG,
  CAPTURE_SCREEN_DARK_BG,
  CAPTURE_SURFACE_WHITE,
  CAPTURE_TEXT_WHITE,
  CAPTURE_THUMBNAIL_BG,
} from '@/features/guided-capture/capture-ui-theme';
import {
  CaptureModalBackdrop,
  captureModalBackdropStyles,
  useCaptureModalOverlaySize,
} from '@/features/guided-capture/components/capture-modal-backdrop';
import { CaptureFooter } from '@/features/guided-capture/components/capture-footer';
import { CaptureOverlay } from '@/features/guided-capture/components/capture-overlay';
import { GuidanceBoundary } from '@/features/guided-capture/components/guidance-boundary';
import { ResetCaptureDialog } from '@/features/guided-capture/components/reset-capture-dialog';
import { SweepDirectionOverlay } from '@/features/guided-capture/components/sweep-direction-dialog';
import { useGuidedCapture } from '@/features/guided-capture/hooks/use-guided-capture';

export default function GuidedCaptureScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const params = useLocalSearchParams<{ sweep?: string | string[] }>();
  const sweepRaw = params.sweep;
  const sweepStr = Array.isArray(sweepRaw) ? sweepRaw[0] : sweepRaw;
  const initialSweepDirection =
    sweepStr === 'left' || sweepStr === 'right' ? sweepStr : null;

  const {
    capturedCount,
    capturedPhotoUris,
    motionBarFill01,
    motionBarComplete,
    motionBarAnchorStart,
    motionBarCaption,
    overlapGuideOffsetPx,
    overlapGuideProgressPct,
    isVerticalMovementWithinLimit,
    isDirectionValid,
    isUprightForCapture,
    shutterUnlocked,
    submitEnabled,
    statusMessage,
    isPreviewVisible,
    captureButtonLabel,
    onCapture,
    autoCaptureEnabled,
    onToggleAutoCapture,
    resetEnabled,
    onSubmitPhotos,
    onResetCapture,
    isResetDialogVisible,
    onCancelResetDialog,
    onConfirmResetDialog,
    onClosePreview,
    isStoreHydrated,
    chooseSweepDirection,
    sweepDirection,
  } = useGuidedCapture(cameraRef, { initialSweepDirection });

  const showSweepDirectionModal =
    isStoreHydrated &&
    initialSweepDirection == null &&
    sweepDirection == null &&
    capturedCount === 0;

  const overlaySize = useCaptureModalOverlaySize();

  const previewGrid = useMemo(() => {
    const screenW = Dimensions.get('window').width;
    const modalPadding = 16;
    const cols = 4;
    const gap = 8;
    const inner = screenW - modalPadding * 2;
    const thumb = Math.max(56, Math.floor((inner - gap * (cols - 1)) / cols));
    return { thumb, gap, cols };
  }, []);

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
        title="Reset Guided Capture"
        message="If cancelled, all photos will be deleted and you will start from the beginning."
        onCancel={onCancelResetDialog}
        onConfirm={onConfirmResetDialog}
      />
      <CameraView style={styles.camera} facing="back" ref={cameraRef} />
      <GuidanceBoundary
        isUprightForCapture={isUprightForCapture}
        shutterUnlocked={shutterUnlocked}
        overlapGuideOffsetPx={overlapGuideOffsetPx}
        overlapGuideProgressPct={overlapGuideProgressPct}
        isVerticalMovementWithinLimit={isVerticalMovementWithinLimit}
        isDirectionValid={isDirectionValid}
      />
      <CaptureOverlay
        capturedCount={capturedCount}
        isUprightForCapture={isUprightForCapture}
        motionBarFill01={motionBarFill01}
        motionBarComplete={motionBarComplete}
        motionBarAnchorStart={motionBarAnchorStart}
        motionBarCaption={motionBarCaption}
        statusMessage={statusMessage}
        submitEnabled={submitEnabled}
        autoCaptureEnabled={autoCaptureEnabled}
        onToggleAutoCapture={onToggleAutoCapture}
        resetEnabled={resetEnabled}
        onSubmitPhotos={onSubmitPhotos}
        onBackPress={() => router.back()}
        onResetCapture={onResetCapture}
        onVideoPress={() => router.push('/(insurance)/scene-video' as Href)}
      />
      <CaptureFooter
        label={captureButtonLabel}
        disabled={!shutterUnlocked}
        onCapture={() => void onCapture()}
      />

      <SweepDirectionOverlay
        visible={showSweepDirectionModal}
        onChooseLeft={() => chooseSweepDirection('left')}
        onChooseRight={() => chooseSweepDirection('right')}
        onDismiss={() => router.back()}
      />

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
                <Text style={styles.modalCount}>({capturedPhotoUris.length})</Text>
              </View>

              <FlatList
                data={capturedPhotoUris}
                keyExtractor={(item, index) => `${item}-${index}`}
                numColumns={previewGrid.cols}
                columnWrapperStyle={styles.thumbnailRow}
                contentContainerStyle={styles.thumbnailList}
                renderItem={({ item, index }) => (
                  <Image
                    source={{ uri: item }}
                    style={[
                      styles.thumbnail,
                      {
                        width: previewGrid.thumb,
                        height: previewGrid.thumb,
                        marginRight: (index + 1) % previewGrid.cols === 0 ? 0 : previewGrid.gap,
                      },
                    ]}
                  />
                )}
              />

              <View style={styles.modalActions}>
                <Pressable
                  style={({ pressed }) => [styles.closeButtonOutlined, pressed && styles.closeButtonPressed]}
                  onPress={onClosePreview}>
                  <Text style={styles.closeButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
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
    color: '#111111',
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
  thumbnailRow: {
    justifyContent: 'flex-start',
    marginBottom: 8,
  },
  thumbnail: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#111111',
    backgroundColor: CAPTURE_THUMBNAIL_BG,
  },
  modalActions: {
    marginTop: 16,
    width: '100%',
  },
  closeButtonOutlined: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c4c4c4',
    marginBottom: 20
  },
  closeButtonPressed: {
    opacity: 0.85,
    backgroundColor: '#f5f5f5',
  },
  closeButtonText: {
    color: '#111111',
    fontWeight: '700',
    fontSize: 16,
  },
});
