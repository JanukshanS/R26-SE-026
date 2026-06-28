import { useState } from "react";
import { Pressable, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Button } from "@components/ui/button";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, spacing, typography } from "@theme/index";
import * as authApi from "@lib/authApi";
import { tokenStore } from "@lib/tokenStore";

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
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError("");
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
      const res =
        mode === "register"
          ? await authApi.register({
              name: name.trim(),
              email: email.trim(),
              password,
              phone: phone.trim() || undefined,
            })
          : await authApi.login(email.trim(), password);
      await tokenStore.setTokens({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      router.replace(
        mode === "register" ? "/(onboarding)/add-vehicle" : "/(driver)/home"
      );
    } catch (err) {
      setError((err as Error).message ?? "Something went wrong");
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
          {/* Frictionless: never block entry — continue as a guest. */}
          <Button
            title="Continue as guest"
            variant="ghost"
            onPress={() => router.replace("/(driver)/home")}
          />
        </>
      }
    >
      <HeaderBar />
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
