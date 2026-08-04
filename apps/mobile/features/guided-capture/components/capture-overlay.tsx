import { StyleSheet, View } from 'react-native';

import { CaptureOverflowMenu } from '@/features/guided-capture/components/capture-overflow-menu';
import { ProgressRing } from '@/features/guided-capture/components/progress-ring';
import { StatusPill } from '@/features/guided-capture/components/status-pill';
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

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.topRow}>
        <ProgressRing current={capturedCount} total={totalExpected} />
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
  statusRow: {
    marginTop: 14,
    alignItems: 'center',
  },
});
