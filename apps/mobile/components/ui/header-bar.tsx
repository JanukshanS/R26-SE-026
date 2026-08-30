import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "@components/ui/icon";
import { LanguagePicker } from "@components/ui/language-picker";
import { palette, radii, spacing, typography } from "@theme/index";
import { useT } from "@lib/i18n";

type Props = {
  title?: string;
  showBack?: boolean;
  /** Show a one-tap "home" shortcut on the right (so multi-step flows don't
   *  force back-spamming all the way out). Suppressed when `right` is given. */
  showHome?: boolean;
  /** Offer the language switch here. On for the screens someone reaches before
   *  they have an account, off elsewhere so it does not crowd every header. */
  showLanguage?: boolean;
  right?: React.ReactNode;
};

export function HeaderBar({
  title,
  showBack = true,
  showHome = true,
  showLanguage = false,
  right,
}: Props) {
  const t = useT();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: spacing.md,
      }}
    >
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        {showBack ? (
          <Pressable
            onPress={() => router.canGoBack() && router.back()}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingVertical: 6,
              paddingHorizontal: spacing.md,
              borderRadius: radii.pill,
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
            })}
          >
            <Icon name="ChevronLeft" size={14} color={palette.text} />
            <Text style={{ color: palette.text, ...typography.caption, fontWeight: "600" }}>
              {t("components.header.back")}
            </Text>
          </Pressable>
        ) : (
          <View style={{ height: 32 }} />
        )}
      </View>
      <View style={{ flex: 2, alignItems: "center" }}>
        {title ? (
          <Text style={{ color: palette.text, ...typography.h3 }}>{title}</Text>
        ) : null}
      </View>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.sm }}>
        {showLanguage && <LanguagePicker />}
        {right ?? (showHome ? (
          <Pressable
            onPress={() => router.replace("/(driver)/home")}
            accessibilityRole="button"
            accessibilityLabel={t("components.header.goHome")}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingVertical: 6,
              paddingHorizontal: spacing.md,
              borderRadius: radii.pill,
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
            })}
          >
            <Icon name="House" size={14} color={palette.text} />
            <Text style={{ color: palette.text, ...typography.caption, fontWeight: "600" }}>
              {t("components.header.home")}
            </Text>
          </Pressable>
        ) : null)}
      </View>
    </View>
  );
}
