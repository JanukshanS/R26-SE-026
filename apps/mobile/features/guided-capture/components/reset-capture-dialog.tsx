import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_PANEL_BORDER,
  CAPTURE_SURFACE_WHITE,
  CAPTURE_TEXT_BLUE,
  CAPTURE_TEXT_WHITE,
} from '@/features/guided-capture/capture-ui-theme';
import {
  CaptureModalBackdrop,
  captureModalBackdropStyles,
  useCaptureModalOverlaySize,
} from '@/features/guided-capture/components/capture-modal-backdrop';

type ResetCaptureDialogProps = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  cancelLabel?: string;
  confirmLabel?: string;
};

export function ResetCaptureDialog({
  visible,
  onCancel,
  onConfirm,
  title = 'Reset Capture',
  message = 'Clear all captured photos and start over?',
  cancelLabel = 'Cancel',
  confirmLabel = 'Reset',
}: ResetCaptureDialogProps) {
  const overlaySize = useCaptureModalOverlaySize();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onCancel}>
      <View style={styles.modalRoot}>
        <View
          style={[
            captureModalBackdropStyles.root,
            Platform.OS === 'web'
              ? captureModalBackdropStyles.rootWeb
              : { width: overlaySize.width, height: overlaySize.height },
          ]}>
          <CaptureModalBackdrop width={overlaySize.width} height={overlaySize.height} />
          <Pressable style={styles.backdropPressable} onPress={onCancel}>
            <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.message}>{message}</Text>
              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                  onPress={onCancel}>
                  <Text style={styles.cancelLabel}>{cancelLabel}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}
                  onPress={onConfirm}>
                  <Text style={styles.confirmLabel}>{confirmLabel}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    width: '100%',
  },
  backdropPressable: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 10,
    zIndex: 2,
    backgroundColor: 'transparent',
  },
  card: {
    backgroundColor: CAPTURE_SURFACE_WHITE,
    borderRadius: 15,
    padding: 20,
    borderWidth: 1,
    width: '100%',
    borderColor: '#d0d0d0',
  },
  title: {
    color: '#000000',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  message: {
    color: '#111111',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 5,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: CAPTURE_PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 5,
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderWidth: 2,
    borderColor: CAPTURE_ACTION_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.88,
  },
  cancelLabel: {
    color: CAPTURE_TEXT_BLUE,
    fontWeight: '700',
    fontSize: 15,
  },
  confirmLabel: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '800',
    fontSize: 15,
  },
});
