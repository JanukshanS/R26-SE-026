import { Pressable, Text, View } from "react-native";
import { palette, radii, spacing, typography } from "@theme/index";

type Tone = "danger" | "warning" | "success" | "neutral";

type Props = {
  badge?: string;
  badgeTone?: Tone;
  title: string;
  description?: string;
  selected?: boolean;
  onPress?: () => void;
};

export function OptionCard({
  badge,
  badgeTone = "neutral",
  title,
  description,
  selected,
  onPress,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? palette.brand : palette.border,
        padding: spacing.lg,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
      })}
    >
      {badge ? (
        <View
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: 6,
            borderRadius: radii.sm,
            backgroundColor: bgFor(badgeTone),
            minWidth: 56,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              ...typography.bodyStrong,
              color: fgFor(badgeTone),
              fontSize: 14,
            }}
          >
            {badge}
          </Text>
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>{title}</Text>
        {description ? (
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function bgFor(tone: Tone) {
  switch (tone) {
    case "danger":
      return palette.danger;
    case "warning":
      return palette.warning;
    case "success":
      return palette.success;
    default:
      return palette.surfaceMuted;
  }
}

function fgFor(tone: Tone) {
  switch (tone) {
    case "danger":
    case "warning":
    case "success":
      return palette.textOnBrand;
    default:
      return palette.text;
  }
}
