import { Text, View } from "react-native";
import { palette, radii, spacing, typography } from "@theme/index";

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

type Props = {
  label: string;
  tone?: Tone;
  withDot?: boolean;
  /** Defaults to uppercase labels; set false for sentence case (e.g. “Good”). */
  uppercase?: boolean;
};

export function Badge({ label, tone = "neutral", withDot, uppercase = true }: Props) {
  const colors = colorsFor(tone);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: 4,
        borderRadius: radii.pill,
        backgroundColor: colors.bg,
      }}
    >
      {withDot ? (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.fg,
          }}
        />
      ) : null}
      <Text
        style={{
          color: colors.fg,
          ...typography.micro,
          fontWeight: "600",
          textTransform: uppercase ? "uppercase" : "none",
        }}
      >
        {uppercase ? label.toUpperCase() : label}
      </Text>
    </View>
  );
}

function colorsFor(tone: Tone) {
  switch (tone) {
    case "success":
      return { bg: palette.successSoft, fg: palette.success };
    case "warning":
      return { bg: palette.warningSoft, fg: palette.warning };
    case "danger":
      return { bg: palette.dangerSoft, fg: palette.danger };
    case "brand":
      return { bg: palette.brandSoft, fg: palette.brand };
    default:
      return { bg: palette.surfaceMuted, fg: palette.textMuted };
  }
}
