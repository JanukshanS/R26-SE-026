import { StyleSheet, Text, View } from 'react-native';

import {
  CAPTURE_GUIDE_BORDER,
  CAPTURE_GUIDE_FILL,
  CAPTURE_INVALID_BG,
  CAPTURE_INVALID_BORDER,
  CAPTURE_INVALID_BORDER_SOFT,
  CAPTURE_TEXT_WHITE,
  CAPTURE_VALID_BG,
  CAPTURE_VALID_BORDER,
  CAPTURE_VALID_BORDER_SOFT,
} from '@/features/guided-capture/capture-ui-theme';

type GuidanceBoundaryProps = {
  tiltAligned: boolean;
  tiltHint: string;
};

/** Static framing guide (no object detection) + a single tilt status badge. */
export function GuidanceBoundary({ tiltAligned, tiltHint }: GuidanceBoundaryProps) {
  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={styles.boundary}>
        <View style={styles.frameContainer}>
          <View style={[styles.frame, tiltAligned ? styles.frameValid : styles.frameInvalid]} />
        </View>
        <View style={[styles.badge, tiltAligned ? styles.badgeOk : styles.badgeWarn]}>
          <Text style={styles.badgeText}>{tiltHint}</Text>
        </View>
        <Text style={styles.guideLabel}>Keep the vehicle inside this boundary</Text>
      </View>
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
    paddingTop: 45,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boundary: {
    height: '75%',
    aspectRatio: 0.59,
    borderWidth: 2,
    borderColor: CAPTURE_GUIDE_BORDER,
    borderStyle: 'dashed',
    borderRadius: 3,
    justifyContent: 'space-between',
    paddingBottom: 8,
    paddingHorizontal: 10,
    paddingTop: 5,
    backgroundColor: CAPTURE_GUIDE_FILL,
  },
  frameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 8,
  },
  frame: {
    position: 'absolute',
    width: '84%',
    height: '64%',
    borderRadius: 5,
    borderWidth: 2,
  },
  frameValid: {
    borderColor: CAPTURE_VALID_BORDER,
  },
  frameInvalid: {
    borderColor: CAPTURE_INVALID_BORDER,
  },
  badge: {
    alignSelf: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    marginBottom: 10,
  },
  badgeOk: {
    backgroundColor: CAPTURE_VALID_BG,
    borderColor: CAPTURE_VALID_BORDER_SOFT,
  },
  badgeWarn: {
    backgroundColor: CAPTURE_INVALID_BG,
    borderColor: CAPTURE_INVALID_BORDER_SOFT,
  },
  badgeText: {
    color: CAPTURE_TEXT_WHITE,
    fontSize: 14,
    fontWeight: '600',
  },
  guideLabel: {
    color: CAPTURE_TEXT_WHITE,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 3,
    borderRadius: 10,
  },
});
