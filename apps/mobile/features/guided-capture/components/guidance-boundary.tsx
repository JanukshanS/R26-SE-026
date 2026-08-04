import { StyleSheet, View } from 'react-native';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_GUIDE_BORDER,
  CAPTURE_VALID_BORDER,
  CAPTURE_VIGNETTE_TINT,
} from '@/features/guided-capture/capture-ui-theme';
import type { CaptureStatus } from '@/features/guided-capture/tilt-status';

type GuidanceBoundaryProps = {
  status: CaptureStatus;
};

const FRAME_COLOR: Record<CaptureStatus, string> = {
  aligning: CAPTURE_GUIDE_BORDER,
  almost: CAPTURE_ACTION_BLUE,
  steady: CAPTURE_VALID_BORDER,
};

/** Static framing guide (no object detection): a vignette with a cut-out
 * viewfinder frame whose corner brackets recolor with capture status. */
export function GuidanceBoundary({ status }: GuidanceBoundaryProps) {
  const color = FRAME_COLOR[status];
  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={styles.vignetteTop} />
      <View style={styles.middleRow}>
        <View style={styles.vignetteSide} />
        <View style={styles.frame}>
          <View style={[styles.corner, styles.cornerTL, { borderColor: color }]} />
          <View style={[styles.corner, styles.cornerTR, { borderColor: color }]} />
          <View style={[styles.corner, styles.cornerBL, { borderColor: color }]} />
          <View style={[styles.corner, styles.cornerBR, { borderColor: color }]} />
        </View>
        <View style={styles.vignetteSide} />
      </View>
      <View style={styles.vignetteBottom} />
    </View>
  );
}

const CORNER_SIZE = 26;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  vignetteTop: {
    flex: 0.16,
    backgroundColor: CAPTURE_VIGNETTE_TINT,
  },
  vignetteBottom: {
    flex: 0.16,
    backgroundColor: CAPTURE_VIGNETTE_TINT,
  },
  middleRow: {
    flex: 0.68,
    flexDirection: 'row',
  },
  vignetteSide: {
    flex: 1,
    backgroundColor: CAPTURE_VIGNETTE_TINT,
  },
  frame: {
    height: '100%',
    aspectRatio: 0.62,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: 10,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: 10,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: 10,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: 10,
  },
});
