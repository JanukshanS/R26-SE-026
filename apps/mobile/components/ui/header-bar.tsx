import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { palette, radii, spacing, typography } from "@theme/index";

type Props = {
  title?: string;
  showBack?: boolean;
  right?: React.ReactNode;
};

export function HeaderBar({ title, showBack = true, right }: Props) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: spacing.sm,
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
              gap: spacing.xs,
              paddingVertical: 6,
              paddingHorizontal: spacing.md,
              borderRadius: radii.pill,
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
            })}
          >
            <Image
              source={"sf:chevron.left"}
              style={{ width: 14, height: 14, tintColor: palette.text }}
            />
            <Text style={{ color: palette.text, ...typography.caption, fontWeight: "600" }}>
              back
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
      <View style={{ flex: 1, alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}
