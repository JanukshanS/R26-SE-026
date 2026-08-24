import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

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

const CORNER_SIZE = 45;
const CORNER_THICKNESS = 7;
const CORNER_RADIUS = 8;
const S = CORNER_SIZE;
const R = CORNER_RADIUS;

// Drawn as SVG paths, not View borders: Android doesn't reliably render a
// per-corner borderRadius when only two sides of a border have width (works
// fine on iOS), which left these brackets sharp-cornered on-device.
const CORNER_PATH: Record<'TL' | 'TR' | 'BL' | 'BR', string> = {
  TL: `M 0 ${S} L 0 ${R} A ${R} ${R} 0 0 1 ${R} 0 L ${S} 0`,
  TR: `M ${S} ${S} L ${S} ${R} A ${R} ${R} 0 0 0 ${S - R} 0 L 0 0`,
  BL: `M 0 0 L 0 ${S - R} A ${R} ${R} 0 0 0 ${R} ${S} L ${S} ${S}`,
  BR: `M ${S} 0 L ${S} ${S - R} A ${R} ${R} 0 0 1 ${S - R} ${S} L 0 ${S}`,
};

function CornerBracket({ corner, color }: { corner: 'TL' | 'TR' | 'BL' | 'BR'; color: string }) {
  return (
    <Svg width={S} height={S} style={[styles.corner, styles[`corner${corner}`]]}>
      <Path d={CORNER_PATH[corner]} stroke={color} strokeWidth={CORNER_THICKNESS} fill="none" />
    </Svg>
  );
}

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
          <CornerBracket corner="TL" color={color} />
          <CornerBracket corner="TR" color={color} />
          <CornerBracket corner="BL" color={color} />
          <CornerBracket corner="BR" color={color} />
        </View>
        <View style={styles.vignetteSide} />
      </View>
      <View style={styles.vignetteBottom} />
    </View>
  );
}

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
  },
  cornerTR: {
    top: 0,
    right: 0,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
  },
});
