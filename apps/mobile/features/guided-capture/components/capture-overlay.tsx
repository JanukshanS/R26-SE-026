import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_DISABLED,
  CAPTURE_OVERLAY_BG,
  CAPTURE_PANEL_BORDER,
  CAPTURE_PROGRESS_TRACK_BG,
  CAPTURE_TEXT_BLUE,
  CAPTURE_TEXT_WHITE,
  CAPTURE_VALID_BORDER,
} from '@/features/guided-capture/capture-ui-theme';
import { MIN_PHOTOS } from '@/features/guided-capture/constants';

type CaptureOverlayProps = {
  capturedCount: number;
  /** When false (Upright badge shows "Fix angle"), motion bar is visually disabled and shows no fill. */
  isUprightForCapture: boolean;
  motionBarFill01: number;
  motionBarComplete: boolean;
  motionBarAnchorStart: boolean;
  motionBarCaption: string;
  statusMessage: string;
  submitEnabled: boolean;
  autoCaptureEnabled: boolean;
  onToggleAutoCapture: () => void;
  resetEnabled: boolean;
  onSubmitPhotos: () => void;
  /** Before any photos: first pill is Back and calls this (e.g. leave capture). */
  onBackPress: () => void;
  onResetCapture: () => void;
  onVideoPress: () => void;
};

export function CaptureOverlay({
  capturedCount,
  isUprightForCapture,
  motionBarFill01,
  motionBarComplete,
  motionBarAnchorStart,
  motionBarCaption,
  statusMessage,
  submitEnabled,
  autoCaptureEnabled,
  onToggleAutoCapture,
  resetEnabled,
  onSubmitPhotos,
  onBackPress,
  onResetCapture,
  onVideoPress,
}: CaptureOverlayProps) {
  const showBackInsteadOfReset = capturedCount === 0;
  const motionBarEnabled = isUprightForCapture;
  const fillWidthPct = motionBarEnabled
    ? Math.max(motionBarFill01 * 100, motionBarFill01 > 0 ? 2 : 0)
    : 0;
  const fillColor = motionBarEnabled
    ? motionBarComplete
      ? CAPTURE_VALID_BORDER
      : CAPTURE_ACTION_BLUE
    : 'transparent';

  return (
    <View style={styles.overlay}>
      <View style={styles.header}>
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [
              styles.actionPill,
              pressed && (showBackInsteadOfReset || resetEnabled) && styles.actionPillPressed,
              !showBackInsteadOfReset && !resetEnabled && styles.actionPillDisabled,
            ]}
            onPress={showBackInsteadOfReset ? onBackPress : onResetCapture}
            disabled={!showBackInsteadOfReset && !resetEnabled}
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
            {capturedCount}/{MIN_PHOTOS}
          </Text>
        </View>
      </View>
      <View
        style={[styles.progressTrack, !motionBarEnabled && styles.progressTrackDisabled]}
        accessibilityRole="progressbar"
        accessibilityState={{ disabled: !motionBarEnabled }}
        accessibilityLabel={
          motionBarEnabled
            ? `Sweep progress ${Math.round(motionBarFill01 * 100)} percent`
            : 'Sweep progress bar disabled. Hold phone upright.'
        }>
        <View
          style={[
            styles.progressFillRow,
            motionBarAnchorStart ? styles.progressFillRowStart : styles.progressFillRowEnd,
          ]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${fillWidthPct}%`,
                backgroundColor: fillColor,
              },
            ]}
          />
        </View>
      </View>
      <View style={styles.progressCaptionRow}>
        <Text
          style={[styles.progressCaption, !motionBarEnabled && styles.progressCaptionDisabled]}
          numberOfLines={3}>
          {motionBarEnabled
            ? motionBarCaption
            : 'Hold the phone upright — the movement bar is paused until Upright shows OK.'}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.actionPill, styles.videoPill, pressed && styles.actionPillPressed]}
          onPress={onVideoPress}
          accessibilityRole="button"
          accessibilityLabel="Open video">
          <Text style={styles.actionPillText}>Video</Text>
        </Pressable>
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
    borderColor: CAPTURE_PANEL_BORDER,
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
    opacity: 0.90,
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
  videoPill: {
    paddingHorizontal: 14,
    flexShrink: 0,
  },
  progressTrack: {
    height: 8,
    backgroundColor: CAPTURE_PROGRESS_TRACK_BG,
    borderRadius: 10,
    overflow: 'hidden',
  },
  progressTrackDisabled: {
    opacity: 0.45,
    backgroundColor: 'rgba(158, 158, 158, 0.35)',
  },
  progressFillRow: {
    flexDirection: 'row',
    width: '100%',
    height: '100%',
  },
  progressFillRowStart: {
    justifyContent: 'flex-start',
  },
  progressFillRowEnd: {
    justifyContent: 'flex-end',
  },
  progressFill: {
    height: '100%',
    borderRadius: 10,
  },
  progressCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  progressCaption: {
    flex: 1,
    color: CAPTURE_TEXT_BLUE,
    fontSize: 14,
  },
  progressCaptionDisabled: {
    color: CAPTURE_TEXT_BLUE,
  },
  statusMessage: {
    color: CAPTURE_TEXT_BLUE,
    fontSize: 16,
    lineHeight: 21,
  },
});
