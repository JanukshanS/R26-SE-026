import { StyleSheet, Text, View } from 'react-native';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_SOFT,
  CAPTURE_TYPE_LABEL_SIZE,
  CAPTURE_TYPE_LABEL_WEIGHT,
} from '@/features/guided-capture/capture-ui-theme';
import type { HeightStep } from '@/features/guided-capture/types';

const POSE_LABELS: Record<HeightStep, string> = {
  overhead: 'Overhead',
  chest: 'Chest',
  waist: 'Waist',
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
  const displayNumber = stopIndex + 1;
  const isExtraStop = displayNumber > stopCount;
  return (
    <View style={styles.pill}>
      <Text style={styles.text}>
        {isExtraStop ? `Stop ${displayNumber}` : `Stop ${displayNumber} of ${stopCount}`}
        {heightStep ? ` • ${POSE_LABELS[heightStep]}` : ''}
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
