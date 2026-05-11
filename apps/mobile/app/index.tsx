import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { Logo } from "@components/ui/logo";
import { Screen } from "@components/ui/screen";
import { palette, spacing, typography } from "@theme/index";

export default function WelcomeScreen() {
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

          {/*
            Service provider entry. For the demo this routes straight to the
            provider dashboard with no auth — when JWT lands (Phase 3) it will
            be a real login form against POST /api/v1/auth/login with
            role=PROVIDER.
          */}
          <Pressable
            onPress={() => router.replace("/(provider)/available")}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              alignItems: "center",
              paddingVertical: spacing.sm,
            })}
          >
            <Text
              style={{
                ...typography.caption,
                color: palette.brand,
                fontWeight: "700",
                textDecorationLine: "underline",
              }}
            >
              Login as a Service Provider
            </Text>
          </Pressable>
        </>
      }
    >
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
