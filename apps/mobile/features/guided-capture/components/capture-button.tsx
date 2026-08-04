import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_ACTION_BLUE_DISABLED,
  CAPTURE_TEXT_WHITE,
  CAPTURE_TYPE_HEADLINE_WEIGHT,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';

type CaptureButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Standard button for the Guided Capture flow: rounded-rect (~15px radius),
 * orange fill for primary actions, white + orange-border for secondary/
 * de-emphasized ones — the convention already used by ResetCaptureDialog and
 * the delete-stop confirm, now shared everywhere in this flow.
 */
export function CaptureButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  fullWidth = true,
  accessibilityLabel,
  style,
}: CaptureButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : styles.secondary,
        fullWidth && styles.fullWidth,
        disabled && (isPrimary ? styles.primaryDisabled : styles.secondaryDisabled),
        pressed && !disabled && styles.pressed,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}>
      <View pointerEvents="none">
        <Text style={[styles.text, isPrimary ? styles.primaryText : styles.secondaryText]}>{title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 15,
    paddingHorizontal: 28,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  fullWidth: {
    width: '100%',
  },
  primary: {
    backgroundColor: CAPTURE_ACTION_BLUE,
    borderWidth: 2,
    borderColor: CAPTURE_ACTION_BLUE,
  },
  primaryDisabled: {
    backgroundColor: CAPTURE_ACTION_BLUE_DISABLED,
    borderColor: CAPTURE_ACTION_BLUE_DISABLED,
    shadowOpacity: 0,
    elevation: 0,
  },
  secondary: {
    backgroundColor: WHITE,
    borderWidth: 2,
    borderColor: CAPTURE_ACTION_BLUE,
    shadowOpacity: 0.1,
  },
  secondaryDisabled: {
    borderColor: CAPTURE_ACTION_BLUE_DISABLED,
    shadowOpacity: 0,
    elevation: 0,
  },
  pressed: {
    opacity: 0.88,
  },
  text: {
    fontSize: 17,
    fontWeight: CAPTURE_TYPE_HEADLINE_WEIGHT,
  },
  primaryText: {
    color: CAPTURE_TEXT_WHITE,
  },
  secondaryText: {
    color: CAPTURE_ACTION_BLUE,
  },
});
