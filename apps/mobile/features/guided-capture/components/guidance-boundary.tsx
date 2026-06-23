import { StyleSheet, Text, View } from 'react-native';

import { OVERLAP_TARGET_PERCENT } from '@/features/guided-capture/constants';
import {
  CAPTURE_GUIDE_BORDER,
  CAPTURE_GUIDE_FILL,
  CAPTURE_INVALID_BG,
  CAPTURE_INVALID_BORDER,
  CAPTURE_INVALID_BORDER_SOFT,
  CAPTURE_OVERLAP_GUIDE_BORDER,
  CAPTURE_TEXT_WHITE,
  CAPTURE_VALID_BG,
  CAPTURE_VALID_BORDER,
  CAPTURE_VALID_BORDER_SOFT,
} from '@/features/guided-capture/capture-ui-theme';

type GuidanceBoundaryProps = {
  isUprightForCapture: boolean;
  shutterUnlocked: boolean;
  overlapGuideOffsetPx: number;
  overlapGuideProgressPct: number;
  isVerticalMovementWithinLimit: boolean;
  isDirectionValid: boolean;
};

export function GuidanceBoundary({
  isUprightForCapture,
  shutterUnlocked,
  overlapGuideOffsetPx,
  overlapGuideProgressPct,
  isVerticalMovementWithinLimit,
  isDirectionValid,
}: GuidanceBoundaryProps) {
  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={styles.boundary}>
        <View style={styles.overlapGuideContainer}>
          <View style={styles.overlapPrimaryFrame} />
          <View
            style={[
              styles.overlapTargetFrame,
              (!isVerticalMovementWithinLimit || !isDirectionValid) && styles.overlapTargetFrameInvalid,
              { transform: [{ translateX: overlapGuideOffsetPx }] },
            ]}
          />
          {/* <Text style={styles.overlapLabel}>
            {`Overlap target ( ${OVERLAP_TARGET_PERCENT}% ) - Movement ${Math.round(overlapGuideProgressPct)}%`}
          </Text> */}
        </View>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, isUprightForCapture ? styles.badgeOk : styles.badgeWarn]}>
            <Text style={styles.badgeText}>Upright: {isUprightForCapture ? 'OK' : 'Fix angle'}</Text>
          </View>
          <View style={[styles.badge, shutterUnlocked ? styles.badgeOk : styles.badgeWarn]}>
            <Text style={styles.badgeText}>
              {shutterUnlocked ? 'Ready to capture' : 'Capture locked'}
            </Text>
          </View>
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
    paddingTop: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boundary: {
    height: '73%',
    aspectRatio: 0.67,
    borderWidth: 2,
    borderColor: CAPTURE_GUIDE_BORDER,
    borderStyle: 'dashed',
    borderRadius: 5,
    justifyContent: 'space-between',
    paddingBottom: 8,
    paddingHorizontal: 10,
    paddingTop: 10,
    backgroundColor: CAPTURE_GUIDE_FILL,
  },
  overlapGuideContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 8,
  },
  overlapPrimaryFrame: {
    position: 'absolute',
    width: '84%',
    height: '64%',
    borderRadius: 5,
    borderWidth: 2,
    borderColor: CAPTURE_OVERLAP_GUIDE_BORDER,
  },
  overlapTargetFrame: {
    position: 'absolute',
    width: '84%',
    height: '64%',
    borderRadius: 5,
    borderWidth: 2,
    borderColor: CAPTURE_VALID_BORDER,
  },
  overlapTargetFrameInvalid: {
    borderColor: CAPTURE_INVALID_BORDER,
  },
  overlapLabel: {
    position: 'absolute',
    bottom: 8,
    color: CAPTURE_TEXT_WHITE,
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  badge: {
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
