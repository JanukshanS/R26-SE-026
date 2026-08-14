import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";

type Props = {
  icon: IconName;
  label: string;
  onPress?: () => void;
  /** Small unread-style dot on the icon's corner — e.g. an unfinished claim upload. */
  badge?: boolean;
  /** Swaps the icon for a spinner and ignores taps — for an action whose onPress does
   * async work (e.g. a server check) before it can navigate anywhere. */
  loading?: boolean;
};

export function QuickAction({ icon, label, onPress, badge, loading }: Props) {
  return (
    <Pressable
      onPress={loading ? undefined : onPress}
      disabled={loading}
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
        {loading ? (
          <ActivityIndicator size="small" color={palette.brand} />
        ) : (
          <Icon name={icon} size={26} color={palette.brand} />
        )}
        {badge ? (
          <View
            accessibilityElementsHidden
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: palette.danger,
              borderWidth: 2,
              borderColor: palette.homeBackground,
            }}
          />
        ) : null}
      </View>
      <Text style={{ ...typography.caption, color: palette.text, fontWeight: "500" }}>
        {label}
      </Text>
    </Pressable>
  );
}
