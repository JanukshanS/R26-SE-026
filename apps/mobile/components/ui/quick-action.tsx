import { Pressable, Text, View } from "react-native";
import { palette, radii, spacing, typography } from "@theme/index";

type Props = {
  icon: string;
  label: string;
  onPress?: () => void;
};

export function QuickAction({ icon, label, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: spacing.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          backgroundColor: palette.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 28 }}>{icon}</Text>
      </View>
      <Text style={{ ...typography.caption, color: palette.text, fontWeight: "500" }}>
        {label}
      </Text>
    </Pressable>
  );
}
