import { View, type StyleProp, type ViewStyle } from "react-native";
import { palette, radii, spacing } from "@theme/index";

type Props = {
  children: React.ReactNode;
  variant?: "default" | "muted" | "outlined";
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, variant = "default", style }: Props) {
  return (
    <View
      style={[
        {
          backgroundColor:
            variant === "muted" ? palette.surfaceMuted : palette.surface,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          padding: spacing.lg,
          gap: spacing.md,
          ...(variant === "outlined"
            ? { borderWidth: 1, borderColor: palette.border }
            : {}),
          boxShadow: "0 1px 2px rgba(15, 15, 15, 0.04)",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
