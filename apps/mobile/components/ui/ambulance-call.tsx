import { Alert, Linking, Pressable, Text, View } from "react-native";
import { Icon } from "@components/ui/icon";
import { haptics } from "@lib/haptics";
import { useT, type Translate } from "@lib/i18n";
import { palette, radii, spacing, typography } from "@theme/index";

/**
 * Opens the dialer with 1990 filled in rather than placing the call: no
 * CALL_PHONE permission, and a stray tap in a pocket cannot ring an ambulance.
 */
export function callAmbulance(t: Translate) {
  Linking.openURL("tel:1990").catch(() => {
    Alert.alert(t("emergency.safetyCheck.callFailedTitle"), t("emergency.safetyCheck.callFailedBody"));
  });
}

/** Slim 1990 strip for the top of a screen; works without an account. */
export function AmbulanceBar() {
  const t = useT();
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        callAmbulance(t);
      }}
      accessibilityRole="button"
      accessibilityLabel={t("emergency.whatsWrong.ambulanceBar")}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        backgroundColor: palette.dangerSoft,
        borderWidth: 1,
        borderColor: palette.danger,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.danger,
        }}
      >
        <Icon name="Phone" size={18} color={palette.textOnBrand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>
          {t("emergency.whatsWrong.ambulanceBar")}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {t("emergency.safetyCheck.ambulanceTitle")}
        </Text>
      </View>
      <Icon name="ChevronRight" size={20} color={palette.danger} />
    </Pressable>
  );
}
