import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  BLACK,
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_DISABLED,
  CAPTURE_OVERLAY_BG,
  CAPTURE_TEXT_WHITE,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';

type CaptureOverlayProps = {
  capturedCount: number;
  totalExpected: number;
  statusMessage: string;
  submitEnabled: boolean;
  autoCaptureEnabled: boolean;
  onToggleAutoCapture: () => void;
  onSubmitPhotos: () => void;
  /** Before any photos: first pill is Back and calls this (e.g. leave capture). */
  onBackPress: () => void;
  onResetCapture: () => void;
};

export function CaptureOverlay({
  capturedCount,
  totalExpected,
  statusMessage,
  submitEnabled,
  autoCaptureEnabled,
  onToggleAutoCapture,
  onSubmitPhotos,
  onBackPress,
  onResetCapture,
}: CaptureOverlayProps) {
  const showBackInsteadOfReset = capturedCount === 0;

  return (
    <View style={styles.overlay}>
      <View style={styles.header}>
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [styles.actionPill, pressed && styles.actionPillPressed]}
            onPress={showBackInsteadOfReset ? onBackPress : onResetCapture}
            accessibilityRole="button"
            accessibilityLabel={showBackInsteadOfReset ? 'Go back to previous screen' : 'Reset capture'}>
            <Text style={styles.actionPillText}>{showBackInsteadOfReset ? 'Back' : 'Reset'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionPill, pressed && styles.actionPillPressed]}
            onPress={onToggleAutoCapture}
            accessibilityRole="button"
            accessibilityState={{ selected: autoCaptureEnabled }}
            accessibilityLabel={autoCaptureEnabled ? 'Auto capture on. Switch to manual.' : 'Manual capture. Switch to auto.'}>
            <Text style={styles.actionPillText}>{autoCaptureEnabled ? 'Auto' : 'Manual'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionPill,
              pressed && submitEnabled && styles.actionPillPressed,
              !submitEnabled && styles.actionPillDisabled,
            ]}
            onPress={onSubmitPhotos}
            disabled={!submitEnabled}>
            <Text style={styles.actionPillText}>View Images</Text>
          </Pressable>
        </View>
        <View style={styles.progressChip}>
          <Text style={styles.actionPillText}>
            {capturedCount}/{totalExpected}
          </Text>
        </View>
      </View>
      <Text style={styles.statusMessage}>{statusMessage}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    paddingTop: 38,
    top: 0,
    left: 0,
    right: 0,
    borderRadius: 8,
    backgroundColor: CAPTURE_OVERLAY_BG,
    borderWidth: 1,
    borderColor: WHITE,
    padding: 10,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  actionPill: {
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillPressed: {
    opacity: 0.9,
  },
  actionPillDisabled: {
    backgroundColor: CAPTURE_ACTION_BLUE_DISABLED,
  },
  actionPillText: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '700',
    fontSize: 15,
  },
  progressChip: {
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusMessage: {
    color: BLACK,
    fontSize: 16,
    lineHeight: 21,
  },
});
