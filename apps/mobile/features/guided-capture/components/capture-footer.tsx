import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_DISABLED,
  CAPTURE_TEXT_WHITE,
} from '@/features/guided-capture/capture-ui-theme';

type CaptureFooterProps = {
  label: string;
  disabled: boolean;
  isCapturing?: boolean;
  onCapture: () => void;
};

export function CaptureFooter({ label, disabled, isCapturing, onCapture }: CaptureFooterProps) {
  return (
    <View style={styles.footer}>
      <Pressable
        style={[styles.captureButton, disabled && styles.captureButtonDisabled]}
        onPress={onCapture}
        disabled={disabled}>
        {isCapturing ? (
          <ActivityIndicator color={CAPTURE_TEXT_WHITE} />
        ) : (
          <Text style={styles.captureButtonText} numberOfLines={4}>
            {label}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  captureButton: {
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginBottom: 10,
    minHeight: 52,
    maxWidth: '100%',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonDisabled: {
    backgroundColor: CAPTURE_ACTION_BLUE_DISABLED,
  },
  captureButtonText: {
    color: CAPTURE_TEXT_WHITE,
    fontWeight: '700',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 18,
  },
});
