import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CaptureOverflowMenu } from '@/features/guided-capture/components/capture-overflow-menu';
import { ProgressRing } from '@/features/guided-capture/components/progress-ring';
import { StatusPill } from '@/features/guided-capture/components/status-pill';
import { CAPTURE_ACTION_BLUE, CAPTURE_TEXT_WHITE } from '@/features/guided-capture/capture-ui-theme';
import type { CaptureStatus } from '@/features/guided-capture/tilt-status';

type CaptureOverlayProps = {
  capturedCount: number;
  totalExpected: number;
  status: CaptureStatus;
  statusMessage: string;
  submitEnabled: boolean;
  autoCaptureEnabled: boolean;
  onToggleAutoCapture: () => void;
  onSubmitPhotos: () => void;
  /** Before any photos: overflow menu shows Back instead of Reset and calls this. */
  onBackPress: () => void;
  onResetCapture: () => void;
};

export function CaptureOverlay({
  capturedCount,
  totalExpected,
  status,
  statusMessage,
  submitEnabled,
  autoCaptureEnabled,
  onToggleAutoCapture,
  onSubmitPhotos,
  onBackPress,
  onResetCapture,
}: CaptureOverlayProps) {
  const showBackInsteadOfReset = capturedCount === 0;
  const allCaptured = totalExpected > 0 && capturedCount >= totalExpected;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.topRow}>
        <View style={styles.progressGroup}>
          <ProgressRing current={capturedCount} total={totalExpected} />
          {allCaptured ? (
            <Pressable
              style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed]}
              onPress={onSubmitPhotos}
              accessibilityRole="button"
              accessibilityLabel="Submit photos">
              <Text style={styles.submitButtonText}>View and Submit</Text>
            </Pressable>
          ) : null}
        </View>
        <CaptureOverflowMenu
          showBackInsteadOfReset={showBackInsteadOfReset}
          onBackPress={onBackPress}
          onResetCapture={onResetCapture}
          autoCaptureEnabled={autoCaptureEnabled}
          onToggleAutoCapture={onToggleAutoCapture}
          submitEnabled={submitEnabled}
          onSubmitPhotos={onSubmitPhotos}
        />
      </View>
      {statusMessage ? (
        <View style={styles.statusRow} pointerEvents="none">
          <StatusPill state={status} label={statusMessage} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 46,
    paddingHorizontal: 14,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  submitButton: {
    marginLeft: 15,
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonPressed: {
    opacity: 0.88,
  },
  submitButtonText: {
    color: CAPTURE_TEXT_WHITE,
    fontSize: 15,
    fontWeight: '700',
  },
  statusRow: {
    marginTop: 14,
    alignItems: 'center',
  },
});
