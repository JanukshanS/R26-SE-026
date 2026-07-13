import { useEffect } from 'react';
import {
  BackHandler,
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
  CAPTURE_SURFACE_WHITE,
  CAPTURE_TEXT_WHITE,
  GRAY_900,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';
import {
  CaptureModalBackdrop,
  captureModalBackdropStyles,
  useCaptureModalOverlaySize,
} from '@/features/guided-capture/components/capture-modal-backdrop';

type SweepDirectionCallbacks = {
  onChooseLeft: () => void;
  onChooseRight: () => void;
  onDismiss: () => void;
};

/**
 * In-screen overlay (not `Modal`) so `CameraView` is never under a native modal layer —
 * that combination often leaves a blank preview on first launch.
 */
export function SweepDirectionOverlay({
  visible,
  onChooseLeft,
  onChooseRight,
  onDismiss,
}: SweepDirectionCallbacks & { visible: boolean }) {
  const overlaySize = useCaptureModalOverlaySize();

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, onDismiss]);

  if (!visible) {
    return null;
  }

  return (
    <View
      style={styles.overlayRoot}
      accessibilityViewIsModal
      accessibilityLabel="Choose walk direction">
      <View
        style={[
          captureModalBackdropStyles.root,
          Platform.OS === 'web'
            ? captureModalBackdropStyles.rootWeb
            : { width: overlaySize.width, height: overlaySize.height },
        ]}>
        <CaptureModalBackdrop width={overlaySize.width} height={overlaySize.height} />
        <Pressable style={styles.backdropPressable} onPress={onDismiss}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>Which way will you walk?</Text>
            <Text style={styles.message}>
              Pick left or right — the app will then guide how far to move between photos.
            </Text>
            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [styles.leftButton, pressed && styles.pressed]}
                onPress={onChooseLeft}
                accessibilityRole="button"
                accessibilityLabel="Walk to the left around the vehicle">
                <Text style={styles.leftLabel}>Left</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.rightButton, pressed && styles.pressed]}
                onPress={onChooseRight}
                accessibilityRole="button"
                accessibilityLabel="Walk to the right around the vehicle">
                <Text style={styles.rightLabel}>Right</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </View>
    </View>
  );
}

/** Optional: same UI in a native `Modal` (e.g. screens without an underlying camera). */
export function SweepDirectionDialog({
  visible,
  onChooseLeft,
  onChooseRight,
  onDismiss,
}: SweepDirectionCallbacks & { visible: boolean }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onDismiss}>
      <View style={styles.modalRoot}>
        <SweepDirectionOverlay
          visible={visible}
          onChooseLeft={onChooseLeft}
          onChooseRight={onChooseRight}
          onDismiss={onDismiss}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    ...(Platform.OS === 'android' ? { elevation: 2000 } : {}),
  },
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
    borderColor: BORDER_LIGHT,
    ...(Platform.OS === 'android' ? { elevation: 12 } : {}),
  },
  title: {
    color: BLACK,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  message: {
    color: GRAY_900,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  leftButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 5,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: CAPTURE_ACTION_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightButton: {
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
  leftLabel: {
    color: CAPTURE_ACTION_BLUE,
    fontWeight: '700',
    fontSize: 15,
  },
  rightLabel: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '800',
    fontSize: 15,
  },
});
