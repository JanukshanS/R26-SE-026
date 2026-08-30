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
      setError("Name is required");
      return;
    }
    if (!email.trim() || !password) {
      setError("Email and password are required");
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
          setNotice("Account created. Confirm your email address, then sign in here.");
          return;
        }
        router.replace("/(onboarding)/add-vehicle");
      } else {
        await authApi.signInEmail(email.trim(), password);
        await routeAfterAuth();
      }
    } catch (err) {
      setError((err as Error).message ?? "Something went wrong");
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
        setError("Google sign-in was cancelled. Try again, or use your email and password.");
        return;
      }
      await routeAfterAuth();
    } catch (err) {
      setError((err as Error).message ?? "Google sign-in failed");
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
                ? "Please wait…"
                : mode === "register"
                  ? "Create an Account"
                  : "Login"
            }
            disabled={submitting}
            onPress={handleSubmit}
          />
          <Button
            title="Continue with Google"
            variant="secondary"
            disabled={submitting}
            onPress={handleGoogle}
          />
        </>
      }
    >
      <HeaderBar showLanguage showHome={false} />
      <Text style={{ ...typography.h1, color: palette.text }}>
        {mode === "register" ? "Add your account" : "Welcome back"}
      </Text>

      {mode === "register" && (
        <TextField
          label="Full Name"
          value={name}
          onChangeText={setName}
          placeholder="Janukshan Perera"
          autoCapitalize="words"
        />
      )}
      <TextField
        label="Email Address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
      />
      {mode === "register" && (
        <TextField
          label="Phone (optional)"
          value={phone}
          onChangeText={setPhone}
          placeholder="+94 77 123 4567"
          keyboardType="phone-pad"
        />
      )}

      {notice ? (
        <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.brand, gap: spacing.sm }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>Check your email</Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{notice}</Text>
        </Card>
      ) : null}

      {error ? (
        <ErrorState
          title={mode === "register" ? "Registration failed" : "Sign in failed"}
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
            ? "Already have an account? "
            : "Don't have an account? "}
          <Text style={{ color: palette.brand, fontWeight: "700" }}>
            {mode === "register" ? "Sign In" : "Register"}
          </Text>
        </Text>
      </Pressable>
    </Screen>
  );
}
