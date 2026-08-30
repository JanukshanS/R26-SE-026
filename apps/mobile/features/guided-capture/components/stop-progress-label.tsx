import { StyleSheet, Text, View } from 'react-native';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_SOFT,
  CAPTURE_TYPE_LABEL_SIZE,
  CAPTURE_TYPE_LABEL_WEIGHT,
} from '@/features/guided-capture/capture-ui-theme';
import type { HeightStep } from '@/features/guided-capture/types';
import { useT } from '@/lib/i18n';

const POSE_LABEL_KEYS: Record<HeightStep, string> = {
  overhead: 'insurance.capture.poseOverhead',
  chest: 'insurance.capture.poseChest',
  waist: 'insurance.capture.poseWaist',
};

type StopProgressLabelProps = {
  stopIndex: number;
  stopCount: number;
  heightStep?: HeightStep;
};

/** "Stop N of M" pill, optionally with the current pose — shared by the pose-ready
 * and walk-to-next-stop screens so both use one progress-indicator system. Once past
 * the required stopCount (extra stops beyond the required set), "of M" is dropped —
 * there's no fixed total to be "of" any more, so it just reads "Stop N". */
export function StopProgressLabel({ stopIndex, stopCount, heightStep }: StopProgressLabelProps) {
  const t = useT();
  const displayNumber = stopIndex + 1;
  const isExtraStop = displayNumber > stopCount;
  const pose = heightStep ? t(POSE_LABEL_KEYS[heightStep]) : null;
  return (
    <View style={styles.pill}>
      <Text style={styles.text}>
        {isExtraStop
          ? pose
            ? t('insurance.capture.stopWithPose', { number: displayNumber, pose })
            : t('insurance.capture.stop', { number: displayNumber })
          : pose
            ? t('insurance.capture.stopOfWithPose', {
                number: displayNumber,
                total: stopCount,
                pose,
              })
            : t('insurance.capture.stopOf', { number: displayNumber, total: stopCount })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    backgroundColor: CAPTURE_ACTION_BLUE_SOFT,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  text: {
    color: CAPTURE_ACTION_BLUE,
    fontSize: CAPTURE_TYPE_LABEL_SIZE,
    fontWeight: CAPTURE_TYPE_LABEL_WEIGHT,
  },
});
