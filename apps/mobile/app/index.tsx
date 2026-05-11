import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@components/ui/button";
import { Icon } from "@components/ui/icon";
import { Logo } from "@components/ui/logo";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <Screen
      footer={
        <>
          <Button
            title="Create an Account"
            onPress={() => router.push("/(onboarding)/add-vehicle")}
          />
          <Button
            title="Login"
            variant="secondary"
            onPress={() => router.push("/(onboarding)/add-account")}
          />
        </>
      }
    >
      {/*
        Service provider entry — top-right pill button. For the demo this
        routes straight to the provider dashboard with no auth; when JWT
        lands (Phase 3) it'll be a real login form with role=PROVIDER.
      */}
      <Pressable
        onPress={() => router.replace("/(provider)/available")}
        style={({ pressed }) => ({
          position: "absolute",
          top: insets.top + spacing.md,
          right: spacing.xl,
          opacity: pressed ? 0.85 : 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radii.pill,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.brand,
          zIndex: 10,
        })}
      >
        <Icon name="Wrench" size={14} color={palette.brand} />
        <Text
          style={{
            ...typography.caption,
            color: palette.brand,
            fontWeight: "700",
          }}
        >
          Service Provider
        </Text>
      </Pressable>

      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.xxxl }}>
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <Text style={{ ...typography.h1, color: palette.text }}>Welcome</Text>
          <Text
            style={{
              ...typography.body,
              color: palette.textMuted,
              textAlign: "center",
              maxWidth: 260,
            }}
          >
            On the Road Again, Anytime, Anywhere
          </Text>
        </View>
        <Logo size="lg" />
      </View>
    </Screen>
  );
}
