import { useState } from "react";
import {
  TextInput as RNTextInput,
  Text,
  View,
  type TextInputProps as RNTextInputProps,
} from "react-native";
import { palette, radii, spacing, typography } from "@theme/index";

type Props = RNTextInputProps & {
  label?: string;
  error?: string;
  helperText?: string;
};

export function TextField({ label, error, helperText, style, ...rest }: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: spacing.sm }}>
      {label ? (
        <Text style={{ color: palette.text, ...typography.body, fontWeight: "500" }}>
          {label}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: palette.surface,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: error
            ? palette.danger
            : focused
            ? palette.brand
            : palette.border,
          paddingHorizontal: spacing.lg,
          paddingVertical: 14,
        }}
      >
        <RNTextInput
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          placeholderTextColor={palette.textMuted}
          style={[
            { color: palette.text, ...typography.body, padding: 0 },
            style,
          ]}
        />
      </View>
      {error || helperText ? (
        <Text
          style={{
            ...typography.caption,
            color: error ? palette.danger : palette.textMuted,
          }}
        >
          {error ?? helperText}
        </Text>
      ) : null}
    </View>
  );
}
