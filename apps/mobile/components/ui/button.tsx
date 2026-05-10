import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { palette, radii, spacing, typography } from "@theme/index";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "lg";

type Props = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "lg",
  disabled,
  fullWidth = true,
  leftIcon,
  rightIcon,
  style,
}: Props) {
  const handlePress = () => {
    if (disabled) return;
    if (process.env.EXPO_OS === "ios") {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start",
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
          paddingVertical: size === "lg" ? 16 : 12,
          paddingHorizontal: spacing.xl,
          borderRadius: radii.pill,
          borderCurve: "continuous",
          ...backgroundFor(variant),
        }}
      >
        {leftIcon}
        <Text
          style={{
            color: textColorFor(variant),
            ...typography.bodyStrong,
            fontSize: size === "lg" ? 16 : 15,
          }}
        >
          {title}
        </Text>
        {rightIcon}
      </View>
    </Pressable>
  );
}

function backgroundFor(variant: Variant) {
  switch (variant) {
    case "primary":
      return { backgroundColor: palette.brand };
    case "secondary":
      return {
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.border,
      };
    case "danger":
      return { backgroundColor: palette.danger };
    case "ghost":
      return { backgroundColor: "transparent" };
  }
}

function textColorFor(variant: Variant) {
  switch (variant) {
    case "primary":
    case "danger":
      return palette.textOnBrand;
    case "secondary":
    case "ghost":
      return palette.text;
  }
}
