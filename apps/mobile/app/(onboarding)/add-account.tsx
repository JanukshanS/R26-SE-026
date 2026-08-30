import { useState } from "react";
import { Platform, Pressable, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, spacing, typography } from "@theme/index";
import * as authApi from "@lib/authApi";
import { getMyUser } from "@lib/vehicleApi";
import { useT } from "@lib/i18n";

/**
 * Where a freshly signed-in account belongs. Both handlers below used to send
 * everyone to /(driver)/home, so a service provider signing in through the main
 * Login button landed in the driver UI and only reached their job feed after a
 * cold restart — app/index.tsx routes by providerId, this screen did not.
 * Reads the profile directly rather than from context: context state updates
 * asynchronously via onAuthStateChange and still holds the pre-sign-in value here.
 */
async function routeAfterAuth() {
  const me = await getMyUser().catch(() => null);
  router.replace(me?.providerId ? "/(provider)/available" : "/(driver)/home");
}

export default function AddAccountScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<"register" | "login">(
    params.mode === "login" ? "login" : "register"
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError("");
    setNotice("");
    if (mode === "register" && !name.trim()) {
      setError(t("onboarding.account.nameRequired"));
      return;
    }
    if (!email.trim() || !password) {
      setError(t("onboarding.account.credentialsRequired"));
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "register") {
        const { needsConfirmation } = await authApi.signUpEmail({
          name: name.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
        });
        if (needsConfirmation) {
          setMode("login");
          setNotice(t("onboarding.account.confirmEmailNotice"));
          return;
        }
        router.replace("/(onboarding)/add-vehicle");
      } else {
        await authApi.signInEmail(email.trim(), password);
        await routeAfterAuth();
      }
    } catch (err) {
      setError((err as Error).message ?? t("onboarding.account.genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const signedIn = await authApi.signInWithGoogle();
      // Web navigates away to Google and back; native returns here signed in.
      if (Platform.OS === "web") return;
      if (!signedIn) {
        setError(t("onboarding.account.googleCancelled"));
        return;
      }
      await routeAfterAuth();
    } catch (err) {
      setError((err as Error).message ?? t("onboarding.account.googleFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button
            title={
              submitting
                ? t("onboarding.account.submitting")
                : mode === "register"
                  ? t("onboarding.account.submitRegister")
                  : t("onboarding.account.submitLogin")
            }
            disabled={submitting}
            onPress={handleSubmit}
          />
          <Button
            title={t("onboarding.account.google")}
            variant="secondary"
            disabled={submitting}
            onPress={handleGoogle}
          />
        </>
      }
    >
      <HeaderBar showLanguage showHome={false} />
      <Text style={{ ...typography.h1, color: palette.text }}>
        {mode === "register"
          ? t("onboarding.account.titleRegister")
          : t("onboarding.account.titleLogin")}
      </Text>

      {mode === "register" && (
        <TextField
          label={t("onboarding.account.nameLabel")}
          value={name}
          onChangeText={setName}
          placeholder={t("onboarding.account.namePlaceholder")}
          autoCapitalize="words"
        />
      )}
      <TextField
        label={t("onboarding.account.emailLabel")}
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label={t("onboarding.account.passwordLabel")}
        value={password}
        onChangeText={setPassword}
        placeholder={t("onboarding.account.passwordPlaceholder")}
        secureTextEntry
      />
      {mode === "register" && (
        <TextField
          label={t("onboarding.account.phoneLabel")}
          value={phone}
          onChangeText={setPhone}
          placeholder="+94 77 123 4567"
          keyboardType="phone-pad"
        />
      )}

      {notice ? (
        <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.brand, gap: spacing.sm }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>{t("onboarding.account.noticeTitle")}</Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{notice}</Text>
        </Card>
      ) : null}

      {error ? (
        <ErrorState
          title={
            mode === "register"
              ? t("onboarding.account.registerFailedTitle")
              : t("onboarding.account.loginFailedTitle")
          }
          message={error}
        />
      ) : null}

      <Pressable
        onPress={() => {
          setMode(mode === "register" ? "login" : "register");
          setError("");
          setNotice("");
        }}
        style={{ alignItems: "center", paddingVertical: spacing.sm }}
      >
        <Text style={{ ...typography.body, color: palette.textMuted }}>
          {mode === "register"
            ? t("onboarding.account.haveAccount")
            : t("onboarding.account.noAccount")}
          <Text style={{ color: palette.brand, fontWeight: "700" }}>
            {mode === "register"
              ? t("onboarding.account.signInLink")
              : t("onboarding.account.registerLink")}
          </Text>
        </Text>
      </Pressable>
    </Screen>
  );
}
