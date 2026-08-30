import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@components/ui/button";
import { Icon } from "@components/ui/icon";
import { LanguagePicker } from "@components/ui/language-picker";
import { Logo } from "@components/ui/logo";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { getMyUser } from "@lib/vehicleApi";
import { isPendingGoogleProviderFlow } from "@lib/pending-google-provider-flow";
import { useT } from "@lib/i18n";

export default function WelcomeScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [checkingSession, setCheckingSession] = useState(true);

  /**
   * The session is persisted, so a returning user is already signed in —
   * sending them to the sign-in wall would make them re-enter a password they
   * never needed. Providers go to their job feed, drivers home; anything that
   * fails (no session, offline, no profile row) falls through to Welcome.
   *
   * A provider's Google sign-in redirects through this exact route (see
   * pending-google-provider-flow.ts) — if that flow is still completing,
   * defer to it entirely instead of guessing a destination from a profile
   * that may not have its providerId linked yet.
   */
  useEffect(() => {
    let cancelled = false;
    if (isPendingGoogleProviderFlow()) {
      router.replace("/(provider)/onboarding");
      return;
    }
    getMyUser()
      .then((user) => {
        if (cancelled) return;
        if (!user) {
          setCheckingSession(false);
          return;
        }
        router.replace(user.providerId ? "/(provider)/available" : "/(driver)/home");
      })
      .catch(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checkingSession) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={palette.brand} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <>
          <Button
            title={t("common.welcome.createAccount")}
            onPress={() => router.push("/(onboarding)/add-account?mode=register")}
          />
          <Button
            title={t("common.welcome.login")}
            variant="secondary"
            onPress={() => router.push("/(onboarding)/add-account?mode=login")}
          />
        </>
      }
    >
      {/* Language first, before the app has asked for anything — someone who
          cannot read the English buttons has to be able to fix that here. */}
      <View
        style={{
          position: "absolute",
          top: insets.top + spacing.md,
          left: spacing.xl,
          zIndex: 10,
        }}
      >
        <LanguagePicker />
      </View>

      {/*
        Service provider entry — top-right pill button. Routes to the provider
        onboarding flow (register or sign in); the provider record is created
        there and linked to the auth account via providerId.
      */}
      <Pressable
        onPress={() => router.push("/(provider)/onboarding")}
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
          {t("common.welcome.serviceProvider")}
        </Text>
      </Pressable>

      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.xxxl }}>
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <Text style={{ ...typography.h1, color: palette.text }}>
            {t("common.welcome.title")}
          </Text>
          <Text
            style={{
              ...typography.body,
              color: palette.textMuted,
              textAlign: "center",
              maxWidth: 260,
            }}
          >
            {t("common.welcome.tagline")}
          </Text>
        </View>
        <Logo size="lg" />
      </View>
    </Screen>
  );
}
