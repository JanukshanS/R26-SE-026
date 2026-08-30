import { Text, View } from "react-native";
import { palette, typography } from "@theme/index";
import { useT } from "@lib/i18n";

type Props = {
  size?: "sm" | "md" | "lg";
};

export function Logo({ size = "md" }: Props) {
  const t = useT();
  const fontSize = size === "lg" ? 36 : size === "md" ? 24 : 18;
  const subtleSize = size === "lg" ? 12 : 10;
  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <Text
        style={{
          ...typography.display,
          fontSize,
          color: palette.text,
          letterSpacing: -0.5,
        }}
      >
        Kaduna<Text style={{ color: palette.brand }}>.lk</Text>
      </Text>
      <Text
        style={{
          ...typography.micro,
          fontSize: subtleSize,
          color: palette.textMuted,
          letterSpacing: 2,
        }}
      >
        {t("components.logo.tagline")}
      </Text>
    </View>
  );
}
