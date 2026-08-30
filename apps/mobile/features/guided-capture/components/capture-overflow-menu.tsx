import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { Icon } from '@components/ui/icon';
import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_DISABLED,
  CAPTURE_STATUS_ALIGNING_BG,
  CAPTURE_SURFACE_WHITE,
  CAPTURE_TEXT_WHITE,
  GRAY_900,
} from '@/features/guided-capture/capture-ui-theme';
import { useT } from '@/lib/i18n';

type CaptureOverflowMenuProps = {
  showBackInsteadOfReset: boolean;
  onBackPress: () => void;
  onResetCapture: () => void;
  autoCaptureEnabled: boolean;
  onToggleAutoCapture: () => void;
  submitEnabled: boolean;
  onSubmitPhotos: () => void;
  onShowInstructions: () => void;
};

/** ⋮ button housing the debug/secondary controls (Reset/Back, Manual/Auto, View Images),
 * hidden by default so the live camera view stays uncluttered. */
export function CaptureOverflowMenu({
  showBackInsteadOfReset,
  onBackPress,
  onResetCapture,
  autoCaptureEnabled,
  onToggleAutoCapture,
  submitEnabled,
  onSubmitPhotos,
  onShowInstructions,
}: CaptureOverflowMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);
  const runAndClose = (fn: () => void) => {
    close();
    fn();
  };

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('insurance.capture.moreOptions')}>
        <Icon name="EllipsisVertical" size={20} color={CAPTURE_TEXT_WHITE} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.menu} onPress={(e) => e.stopPropagation()}>
            <MenuItem
              icon={showBackInsteadOfReset ? 'ArrowLeft' : 'RotateCcw'}
              label={
                showBackInsteadOfReset
                  ? t('insurance.capture.menuBack')
                  : t('insurance.capture.menuReset')
              }
              onPress={() => runAndClose(showBackInsteadOfReset ? onBackPress : onResetCapture)}
            />
            <MenuItem
              icon="RefreshCw"
              label={
                autoCaptureEnabled
                  ? t('insurance.capture.menuAutoOn')
                  : t('insurance.capture.menuAutoOff')
              }
              onPress={() => runAndClose(onToggleAutoCapture)}
            />
            <MenuItem
              icon="Images"
              label={t('insurance.capture.menuViewImages')}
              disabled={!submitEnabled}
              onPress={() => runAndClose(onSubmitPhotos)}
            />
            <MenuItem
              icon="CircleHelp"
              label={t('insurance.capture.menuHowTo')}
              onPress={() => runAndClose(onShowInstructions)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'ArrowLeft' | 'RotateCcw' | 'RefreshCw' | 'Images' | 'CircleHelp';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.item, pressed && !disabled && styles.itemPressed]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Icon name={icon} size={18} color={disabled ? CAPTURE_ACTION_BLUE_DISABLED : CAPTURE_ACTION_BLUE} />
      <Text style={[styles.itemText, disabled && styles.itemTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CAPTURE_STATUS_ALIGNING_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerPressed: {
    opacity: 0.85,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  menu: {
    position: 'absolute',
    top: 84,
    right: 14,
    backgroundColor: CAPTURE_SURFACE_WHITE,
    borderRadius: 15,
    paddingVertical: 6,
    minWidth: 200,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  itemPressed: {
    opacity: 0.7,
  },
  itemText: {
    color: GRAY_900,
    fontSize: 15,
    fontWeight: '600',
  },
  itemTextDisabled: {
    color: CAPTURE_ACTION_BLUE_DISABLED,
  },
});
