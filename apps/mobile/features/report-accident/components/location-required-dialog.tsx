import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@components/ui/icon';
import {
  BLACK,
  BORDER_LIGHT,
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_SOFT,
  CAPTURE_RESET_CANCEL_BORDER,
  CAPTURE_SURFACE_WHITE,
  CAPTURE_TEXT_WHITE,
  GRAY_900,
} from '@/features/guided-capture/capture-ui-theme';
import {
  CaptureModalBackdrop,
  captureModalBackdropStyles,
  useCaptureModalOverlaySize,
} from '@/features/guided-capture/components/capture-modal-backdrop';
import { useT } from '@/lib/i18n';

type LocationRequiredDialogProps = {
  visible: boolean;
  onOpenSettings: () => void;
  onTryAgain: () => void;
  onNotNow: () => void;
};

/** Same visual system as ResetCaptureDialog (icon-circle card over the app's
 * frosted modal backdrop), but with three stacked actions instead of two —
 * replaces the OS-native Alert.alert() previously used for this prompt, which
 * looked out of place against the rest of the app's custom dialogs. */
export function LocationRequiredDialog({
  visible,
  onOpenSettings,
  onTryAgain,
  onNotNow,
}: LocationRequiredDialogProps) {
  const t = useT();
  const overlaySize = useCaptureModalOverlaySize();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onNotNow}>
      <View style={styles.modalRoot}>
        <View
          style={[
            captureModalBackdropStyles.root,
            Platform.OS === 'web'
              ? captureModalBackdropStyles.rootWeb
              : { width: overlaySize.width, height: overlaySize.height },
          ]}>
          <CaptureModalBackdrop width={overlaySize.width} height={overlaySize.height} />
          <Pressable style={styles.backdropPressable} onPress={onNotNow}>
            <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
              <View style={styles.iconCircle}>
                <Icon name="MapPinOff" size={32} color={CAPTURE_ACTION_BLUE} />
              </View>
              <Text style={styles.title}>{t('insurance.location.title')}</Text>
              <Text style={styles.message}>{t('insurance.location.body')}</Text>
              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                  onPress={onOpenSettings}
                  accessibilityRole="button"
                  accessibilityLabel={t('insurance.camera.openSettings')}>
                  <Text style={styles.primaryLabel}>{t('insurance.camera.openSettings')}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                  onPress={onTryAgain}
                  accessibilityRole="button"
                  accessibilityLabel={t('insurance.action.tryAgain')}>
                  <Text style={styles.secondaryLabel}>{t('insurance.action.tryAgain')}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
                  onPress={onNotNow}
                  accessibilityRole="button"
                  accessibilityLabel={t('insurance.action.notNow')}>
                  <Text style={styles.textLabel}>{t('insurance.action.notNow')}</Text>
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
    borderColor: BORDER_LIGHT,
  },
  iconCircle: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: CAPTURE_ACTION_BLUE_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
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
    gap: 10,
  },
  primaryButton: {
    paddingVertical: 12,
    borderRadius: 15,
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderWidth: 2,
    borderColor: CAPTURE_ACTION_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    paddingVertical: 12,
    borderRadius: 15,
    backgroundColor: CAPTURE_SURFACE_WHITE,
    borderWidth: 1,
    borderColor: CAPTURE_RESET_CANCEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.88,
  },
  primaryLabel: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryLabel: {
    color: CAPTURE_ACTION_BLUE,
    fontWeight: '700',
    fontSize: 15,
  },
  textLabel: {
    color: GRAY_900,
    fontWeight: '600',
    fontSize: 14,
  },
});
