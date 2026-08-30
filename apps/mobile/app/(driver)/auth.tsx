import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { ErrorState } from "@components/ui/error-state";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import { useT } from "@lib/i18n";

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { login, register, loginWithGoogle, authLoading } = useVehicle();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit() {
    setError("");
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        if (!name.trim()) { setError(t("driver.auth.nameRequired")); return; }
        await register(name.trim(), email.trim(), password, phone.trim() || undefined);
      }
      router.replace("/(driver)/home");
    } catch (err: any) {
      setError(err.message ?? t("driver.auth.genericError"));
    }
  }

  async function handleGoogle() {
    setError("");
    try {
      await loginWithGoogle();
      // Web redirects to Google and back; native returns here signed in.
      if (Platform.OS !== "web") router.replace("/(driver)/home");
    } catch (err: any) {
      setError(err.message ?? t("driver.auth.googleError"));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      <View
        style={{
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          backgroundColor: palette.surface,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("driver.auth.back")}>
          <Icon name="ChevronLeft" size={24} color={palette.text} />
        </Pressable>
        <Text style={{ ...typography.h3, color: palette.text }}>
          {mode === "login" ? t("driver.auth.headingLogin") : t("driver.auth.headingRegister")}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + spacing.xxxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand mark */}
        <View style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.md }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: palette.brandSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="Car" size={36} color={palette.brand} />
          </View>
          <Text style={{ ...typography.h2, color: palette.text }}>
            {mode === "login" ? t("driver.auth.welcomeLogin") : t("driver.auth.welcomeRegister")}
          </Text>
          <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
            {mode === "login"
              ? t("driver.auth.subtitleLogin")
              : t("driver.auth.subtitleRegister")}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          {mode === "register" && (
            <Field label={t("driver.auth.fieldName")} value={name} onChangeText={setName} placeholder={t("driver.auth.fieldNamePlaceholder")} autoCapitalize="words" />
          )}
          <Field label={t("driver.auth.fieldEmail")} value={email} onChangeText={setEmail} placeholder={t("driver.auth.fieldEmailPlaceholder")} keyboardType="email-address" autoCapitalize="none" />
          <Field label={t("driver.auth.fieldPassword")} value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
          {mode === "register" && (
            <Field label={t("driver.auth.fieldPhone")} value={phone} onChangeText={setPhone} placeholder={t("driver.auth.fieldPhonePlaceholder")} keyboardType="phone-pad" />
          )}

          {error ? (
            <ErrorState
              title={mode === "login" ? t("driver.auth.errorTitleLogin") : t("driver.auth.errorTitleRegister")}
              message={error}
            />
          ) : null}

          <Pressable
            onPress={handleSubmit}
            disabled={authLoading}
            style={({ pressed }) => ({
              backgroundColor: authLoading ? palette.textMuted : pressed ? palette.brandPressed : palette.brand,
              borderRadius: radii.lg,
              paddingVertical: spacing.md + 2,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: spacing.sm,
              marginTop: spacing.sm,
            })}
          >
            {authLoading && <ActivityIndicator size="small" color={palette.textOnBrand} />}
            <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
              {mode === "login" ? t("driver.auth.headingLogin") : t("driver.auth.headingRegister")}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleGoogle}
            disabled={authLoading}
            style={({ pressed }) => ({
              backgroundColor: pressed ? palette.homeBackground : palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: radii.lg,
              paddingVertical: spacing.md + 2,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: spacing.sm,
            })}
          >
            <Icon name="LogIn" size={18} color={palette.text} />
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              {t("driver.auth.google")}
            </Text>
          </Pressable>
        </View>

        {/* Toggle mode */}
        <Pressable
          onPress={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
          style={{ alignItems: "center", paddingVertical: spacing.md }}
        >
          <Text style={{ ...typography.body, color: palette.textMuted }}>
            {mode === "login" ? t("driver.auth.togglePromptLogin") : t("driver.auth.togglePromptRegister")}
            <Text style={{ color: palette.brand, fontWeight: "700" }}>
              {mode === "login" ? t("driver.auth.toggleActionLogin") : t("driver.auth.toggleActionRegister")}
            </Text>
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize, secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
  secureTextEntry?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        secureTextEntry={secureTextEntry}
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: radii.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          ...typography.body,
          color: palette.text,
          backgroundColor: palette.surface,
        }}
      />
    </View>
  );
}
